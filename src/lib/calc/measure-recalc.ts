// Canonical curve recompute — measure-notation path (replaces the Excel HyperFormula
// engine in the live recompute). Reads the build-time bundle (`measures.bundle.json`,
// baked from Supabase incl. drafts), applies the live levers + per-scenario overrides
// to a copy of the library/measures, and runs the SAME pure-TS calc core (`compute`)
// the bake/MCP/editor use. So a slider move recomputes from Supabase data with no Excel
// engine and no backend at runtime — and an MCP measure edit (which the bundle captured
// at build) survives a slider move instead of snapping back to the Excel curve.
//
// Override cell namespaces (keys of ProjectOverrides):
//   • `in:<measureId>#<key>`   — a per-measure input (drill-down assumption row)
//   • `obj:<techId>#<indKey>`  — a library technology indicator (the global unit-CAPEX panel)
import bundleJson from '@data/kz/measures.bundle.json';
import type { DatasetTotals, Levers, MaccPoint } from '@data/schema';
import type { Library, Measure } from '@/lib/measure/schema';
import { compute } from '@/lib/measure/compute';
import type { ProjectOverrides, RecalcResult } from './types';

interface Bundle { country: string; modelVersion: string; library: Library; measures: Measure[] }
const bundle = bundleJson as unknown as Bundle;

/** The canonical measure ids on the baked curve — used by the community overlay to avoid
 *  double-plotting a measure that is already a baked bar. */
export const canonicalMeasureIds: ReadonlySet<string> = new Set(bundle.measures.map((m) => m.id));

export const modelVersion = bundle.modelVersion;

/** The baked library + a measure-by-id lookup over the SAME baked bundle the curve uses.
 *  The read-only drill-down must resolve measures here (not the 26-measure seed mirror), or a
 *  measure added after the seed — kz-27 (R3), kz-28 (MCP) — has a curve bar but no breakdown. */
export const bundleLibrary: Library = bundle.library;
export function bundleMeasure(id: string): Measure | undefined {
  return bundle.measures.find((m) => m.id === id);
}

/** kz-N → numeric MaccPoint id (matches scripts/bake-from-supabase.ts so ids are stable
 *  between the baked snapshot and a live recompute). All canonical ids are numeric-suffixed. */
function numericId(id: string): number {
  const m = id.match(/(\d+)$/);
  if (m) return Number(m[1]);
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1_000_000;
  return 1_000_000 + h;
}

/** Apply the 4 live levers to the library (fuel-price levers → shared resource prices;
 *  WACC → the discount rate). Both the denormalized `resources[id].price` AND the matching
 *  `indicators` entry are updated, because a `res:<id>#price` ref resolves through
 *  `library.indicators` (the §1 hub), not the denormalized field. A lever whose resource is
 *  absent from the notation (electricity has no shared resource yet) is a no-op. Shallow copy. */
function leveredLibrary(library: Library, levers: Levers): Library {
  const priceById: Record<string, number> = {
    coal: levers.coalPrice,
    gas: levers.gasPrice,
    electricity: levers.electricityPrice,
  };
  const resources = { ...library.resources };
  for (const [id, price] of Object.entries(priceById)) {
    if (resources[id]) resources[id] = { ...resources[id], price };
  }
  const indicators = library.indicators.map((ind) =>
    ind.owner_kind === 'resource' && ind.key === 'price' && priceById[ind.owner_ref] !== undefined
      ? { ...ind, value: priceById[ind.owner_ref] }
      : ind,
  );
  return { ...library, resources, indicators, globals: { ...library.globals, discountRate: levers.discountRate } };
}

/** Apply the global unit-CAPEX overrides (`obj:<techId>#<indKey>`) onto a copy of the
 *  library: both the denormalized owner field (what `economicsRollup` reads) and the
 *  matching `indicators` entry (what `obj:` refs resolve through) are updated. */
function applyLibraryOverrides(library: Library, overrides: ProjectOverrides): Library {
  const entries = Object.entries(overrides).filter(([cell]) => cell.startsWith('obj:'));
  if (entries.length === 0) return library;
  const technologies = { ...library.technologies };
  let indicators = library.indicators;
  for (const [cell, value] of entries) {
    const m = cell.match(/^obj:(.+)#(.+)$/);
    if (!m) continue;
    const [, id, key] = m;
    if (technologies[id]) technologies[id] = { ...technologies[id], [key]: value };
    indicators = indicators.map((ind) =>
      ind.owner_kind === 'object' && ind.owner_ref === id && ind.key === key ? { ...ind, value } : ind,
    );
  }
  return { ...library, technologies, indicators };
}

/** Apply per-measure input overrides (`in:<measureId>#<key>`) onto copies of the measures. */
function applyMeasureOverrides(measures: Measure[], overrides: ProjectOverrides): Measure[] {
  const byMeasure = new Map<string, Array<[string, number]>>();
  for (const [cell, value] of Object.entries(overrides)) {
    const m = cell.match(/^in:(.+)#(.+)$/);
    if (!m) continue;
    const [, measureId, key] = m;
    (byMeasure.get(measureId) ?? byMeasure.set(measureId, []).get(measureId)!).push([key, value]);
  }
  if (byMeasure.size === 0) return measures;
  return measures.map((measure) => {
    const edits = byMeasure.get(measure.id);
    if (!edits || !measure.inputs) return measure;
    const inputs = { ...measure.inputs };
    for (const [key, value] of edits) {
      if (inputs[key]) inputs[key] = { ...inputs[key], value };
    }
    return { ...measure, inputs };
  });
}

function toPoint(measure: Measure, library: Library): MaccPoint {
  const c = compute(measure, library);
  return {
    id: numericId(measure.id),
    sector: c.sector,
    variant: null,
    name: c.name,
    capex: c.capex,
    opex: c.opex,
    durationYrs: c.durationYrs,
    abatementKt: c.abatementKt,
    npv: c.npv,
    discCo2Kt: c.discCo2Kt,
    mac: c.mac,
    cumAbatementStartKt: 0,
    cumAbatementEndKt: 0,
    capexItems: c.capexItems,
    opexItems: c.opexItems,
    physicalItems: c.physicalItems,
    localInputs: c.localInputs,
  };
}

function buildTotals(projects: MaccPoint[]): DatasetTotals {
  const capexMUsd = projects.reduce((s, p) => s + p.capex, 0);
  const abatementKt = projects.reduce((s, p) => s + p.abatementKt, 0);
  const npvMUsd = projects.reduce((s, p) => s + p.npv, 0);
  const discCo2Kt = projects.reduce((s, p) => s + p.discCo2Kt, 0);
  const noRegretsAbatementKt = projects.filter((p) => p.mac < 0).reduce((s, p) => s + p.abatementKt, 0);
  return {
    capexMUsd,
    abatementKt,
    npvMUsd,
    discCo2Kt,
    weightedAvgMac: discCo2Kt === 0 ? 0 : (npvMUsd / discCo2Kt) * 1000,
    noRegretsAbatementKt,
  };
}

/**
 * Recompute the canonical curve at the given levers + overrides. Drop-in replacement for
 * the Excel engine's `recalc` (same `RecalcResult` shape). A measure that throws (malformed
 * after an override) is skipped rather than breaking the whole curve.
 */
export function recalc(levers: Levers, overrides: ProjectOverrides = {}): RecalcResult {
  const library = applyLibraryOverrides(leveredLibrary(bundle.library, levers), overrides);
  const measures = applyMeasureOverrides(bundle.measures, overrides);

  const projects: MaccPoint[] = [];
  for (const m of measures) {
    try {
      projects.push(toPoint(m, library));
    } catch {
      // skip a measure that can't compute (never breaks the curve)
    }
  }
  projects.sort((a, b) => a.mac - b.mac);
  let cum = 0;
  for (const p of projects) {
    p.cumAbatementStartKt = cum;
    cum += p.abatementKt;
    p.cumAbatementEndKt = cum;
  }
  return { projects, totals: buildTotals(projects), levers };
}
