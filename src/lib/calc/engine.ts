// The v1 calc engine — the ONLY module in the app that imports HyperFormula.
//
// It seeds HyperFormula from the published `workbook.engine.json` (a faithful,
// 0-indexed dump of the Excel grid), lets the four live levers be moved, and
// re-reads the MACC sheet outputs. Output fidelity vs the Excel cached values is
// pinned by the golden test (`golden.ts`). Everything downstream (chart, KPIs,
// exports) consumes the plain `RecalcResult`, never HyperFormula itself.
//
// HyperFormula is GPLv3 — fine, this project is open (see CLAUDE.md). The whole
// workbook uses only IF/PV/SUM + arithmetic, all of which HyperFormula supports.
import { HyperFormula } from 'hyperformula';
// Relative (not @data alias) JSON imports so the golden test runs under `tsx`
// without tsconfig-path resolution. Type-only imports below keep the alias.
import engineJson from '../../../data/kz/workbook.engine.json';
import baselineJson from '../../../data/kz/model.data.json';
import type {
  Dataset,
  MaccPoint,
  DatasetTotals,
  Levers,
  WorkbookEngine,
} from '@data/schema';
import type { RecalcResult } from './types';

const baseline = baselineJson as unknown as Dataset;
const workbook = engineJson as unknown as WorkbookEngine;

export const modelVersion = baseline.modelVersion;

/** Baseline lever values (the Excel defaults) read from the dataset assumptions. */
export const BASELINE_LEVERS: Levers = (() => {
  const v = (key: string) =>
    baseline.assumptions.find((a) => a.key === key)?.value ?? 0;
  return {
    coalPrice: v('coalPrice'),
    gasPrice: v('gasPrice'),
    electricityPrice: v('electricityPrice'),
    discountRate: v('discountRate'),
  };
})();

// 0-indexed (col,row) of each lever on the MACC sheet. See CLAUDE.md / ETL.
const LEVER_CELLS: Record<keyof Levers, { col: number; row: number }> = {
  discountRate: { col: 2, row: 1 }, // C2  — WACC
  coalPrice: { col: 4, row: 35 }, // E36 — $/t
  gasPrice: { col: 4, row: 36 }, // E37 — $/1000 m³
  electricityPrice: { col: 4, row: 37 }, // E38 — $/MWh
};

// MACC output columns (0-indexed): E..K -> capex..mac.
const COL = { B: 1, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10 } as const;
const FIRST_ROW = 5; // row 6 (0-indexed 5)
const LAST_ROW = 30; // row 31

// HyperFormula's parser rejects non-ASCII sheet names in references
// (e.g. `=Расчёты!C670` → parse error). Wrap such references in quotes
// (`='Расчёты'!C670`), which HyperFormula accepts. Deterministic string rewrite;
// the workbook only ever references a sheet as `Name!`, never as a bare token.
function quoteNonAsciiSheetRefs(
  sheets: Record<string, Array<Array<string | number | boolean | null>>>,
): Record<string, Array<Array<string | number | boolean | null>>> {
  const names = Object.keys(sheets).filter((n) => /[^\x00-\x7F]/.test(n));
  if (!names.length) return sheets;
  const fix = (f: string) => {
    let s = f;
    for (const n of names) s = s.split(`${n}!`).join(`'${n}'!`);
    return s;
  };
  const out: typeof sheets = {};
  for (const [name, grid] of Object.entries(sheets)) {
    out[name] = grid.map((row) =>
      row.map((c) => (typeof c === 'string' && c.startsWith('=') ? fix(c) : c)),
    );
  }
  return out;
}

interface EngineHandle {
  hf: HyperFormula;
  sheetId: number;
  /** Measure id (MACC col B) -> 0-indexed sheet row. */
  rowById: Map<number, number>;
}

let handle: EngineHandle | null = null;

function build(): EngineHandle {
  const sheets = quoteNonAsciiSheetRefs(workbook.sheets);
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const sheetId = hf.getSheetId('MACC');
  if (sheetId === undefined) throw new Error('MACC sheet not found in engine workbook');

  const rowById = new Map<number, number>();
  for (let row = FIRST_ROW; row <= LAST_ROW; row++) {
    const id = hf.getCellValue({ sheet: sheetId, col: COL.B, row });
    if (typeof id === 'number') rowById.set(id, row);
  }
  return { hf, sheetId, rowById };
}

/** Lazily build (and memoize) the HyperFormula instance. */
function engine(): EngineHandle {
  if (!handle) handle = build();
  return handle;
}

function num(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Engine produced a non-numeric value: ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * Recompute the full curve for a given set of levers.
 *
 * Sets the four lever cells, re-reads every measure's E..K outputs, re-sorts the
 * measures ascending by MAC (curve order), recomputes cumulative abatement spans,
 * and aggregates the totals. Static per-measure metadata (names, sectors, cost
 * breakdowns, provenance cells) is carried over from the baseline dataset.
 */
export function recalc(levers: Levers): RecalcResult {
  const { hf, sheetId, rowById } = engine();

  hf.batch(() => {
    (Object.keys(LEVER_CELLS) as Array<keyof Levers>).forEach((k) => {
      const { col, row } = LEVER_CELLS[k];
      hf.setCellContents({ sheet: sheetId, col, row }, [[levers[k]]]);
    });
  });

  const read = (row: number, col: number) =>
    num(hf.getCellValue({ sheet: sheetId, col, row }));

  const projects: MaccPoint[] = baseline.projects.map((base) => {
    const row = rowById.get(base.id);
    if (row === undefined) throw new Error(`Measure id ${base.id} not in engine grid`);
    return {
      ...base,
      capex: read(row, COL.E),
      opex: read(row, COL.F),
      durationYrs: read(row, COL.G),
      abatementKt: read(row, COL.H),
      npv: read(row, COL.I),
      discCo2Kt: read(row, COL.J),
      mac: read(row, COL.K),
      // cumulative spans are filled in after the re-sort below
      cumAbatementStartKt: 0,
      cumAbatementEndKt: 0,
    };
  });

  // Curve order: ascending by MAC. Abatement (bar width) is always positive.
  projects.sort((a, b) => a.mac - b.mac);
  let cum = 0;
  for (const p of projects) {
    p.cumAbatementStartKt = cum;
    cum += p.abatementKt;
    p.cumAbatementEndKt = cum;
  }

  const totals = aggregate(projects);
  return { projects, totals, levers };
}

function aggregate(projects: MaccPoint[]): DatasetTotals {
  let capexMUsd = 0;
  let abatementKt = 0;
  let npvMUsd = 0;
  let discCo2Kt = 0;
  let noRegretsAbatementKt = 0;
  for (const p of projects) {
    capexMUsd += p.capex;
    abatementKt += p.abatementKt;
    npvMUsd += p.npv;
    discCo2Kt += p.discCo2Kt;
    if (p.mac < 0) noRegretsAbatementKt += p.abatementKt;
  }
  const weightedAvgMac = discCo2Kt === 0 ? 0 : (npvMUsd / discCo2Kt) * 1000;
  return {
    capexMUsd,
    abatementKt,
    npvMUsd,
    discCo2Kt,
    weightedAvgMac,
    noRegretsAbatementKt,
  };
}
