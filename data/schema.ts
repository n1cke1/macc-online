// Universal, country-agnostic dataset schema for the open MACC tool.
// Both the v1 HyperFormula engine and the future v2 native port produce data
// conforming to these types. `scripts/etl.py` emits `model.data.json` against
// the `Dataset` shape and `workbook.engine.json` against `WorkbookEngine`.
//
// This file is the single source of truth for the data contract; keep it and
// the ETL output in lockstep.

export type SectorCode =
  | '1.A.1' // Energy industries (power & heat generation)
  | '1.A.2' // Manufacturing industries & construction
  | '1.A.3' // Transport
  | '1.A.4' // Other sectors (buildings, residential, commercial)
  | '1.B'   // Fugitive emissions (oil, gas, coal)
  | '2'     // Industrial processes & product use (IPPU)
  | '3'     // Agriculture
  | '4'     // Land use (LULUCF)
  | '5';    // Waste

/** Bilingual label. `en` falls back to `ru` when empty/missing. */
export interface Localized {
  ru: string;
  en: string;
}

/** A single CAPEX or OPEX line item, extracted from the Расчёты project block. */
export interface CostItem {
  label: Localized;
  value: number; // mUSD (CAPEX) or mUSD/yr (OPEX, signed)
  cell: string;  // provenance, e.g. "Расчёты!C511"
}

/** One abatement measure = one bar of the curve. Mirrors MACC sheet cols A..K. */
export interface MaccPoint {
  id: number;              // B — stable measure id (1..26)
  sector: SectorCode;      // A — IPCC sector code
  variant: number | null;  // C — within-sector variant index
  name: Localized;         // D
  capex: number;           // E — mUSD
  opex: number;            // F — mUSD/yr (signed; negative = net saving)
  durationYrs: number;     // G
  abatementKt: number;     // H — kt CO2eq/yr  (bar WIDTH; always positive)
  npv: number;             // I — mUSD
  discCo2Kt: number;       // J — discounted kt CO2
  mac: number;             // K — USD/tCO2 (bar HEIGHT; <0 = no-regrets, below axis)
  // Pre-computed cumulative span (ascending-MAC order) for a ready-to-plot baseline.
  cumAbatementStartKt: number;
  cumAbatementEndKt: number;
  // Provenance: the Расчёты source cell feeding each MACC output.
  sourceCells?: { capex: string; opex: string; durationYrs: string; abatementKt: string };
  // Breakdown of CAPEX / OPEX into their main line items (from the Расчёты block).
  capexItems?: CostItem[];
  opexItems?: CostItem[];
}

/** Live levers the user can move (subset of `assumptions` where isLever=true). */
export interface Levers {
  coalPrice: number;        // MACC!E36 — $/t
  gasPrice: number;         // MACC!E37 — $/1000 m³
  electricityPrice: number; // MACC!E38 — $/MWh
  discountRate: number;     // MACC!C2  — fraction (WACC)
}

/** Layer-1 "General input": price/emission/CAPEX assumptions. */
export interface Assumption {
  key: string;              // stable anchor for assumption-level comments
  cell: string;             // source cell, e.g. "MACC!E36"
  label: Localized;
  value: number;
  unit: string;
  group: 'lever' | 'emission_factor' | 'capex_unit';
  isLever: boolean;
  // present only when isLever
  min?: number;
  max?: number;
  step?: number;
}

export interface SectorMeta {
  label: Localized;
  color: string; // hex, for the chart legend
}

export interface DatasetMeta {
  sourceFile: string;
  sourceDate: string;            // ISO yyyy-mm-dd, parsed from the workbook
  discountRate: number;          // baseline WACC (MACC!C2)
  totalEmissionsMt: number;      // net incl. LULUCF (Выбросы!C33)
  totalEmissionsExclLulucfMt: number;
  emissionsSource: string;
  enTranslationStatus: 'machine-draft-pending-review' | 'reviewed';
}

export interface DatasetTotals {
  capexMUsd: number;
  abatementKt: number;
  npvMUsd: number;
  discCo2Kt: number;
  weightedAvgMac: number; // USD/tCO2 = npv/discCo2*1000
  noRegretsAbatementKt: number; // sum of abatement where mac < 0
}

/** `data/<country>/model.data.json` */
export interface Dataset {
  schemaVersion: number;
  country: string;
  modelVersion: string; // fingerprint string, also shown in the version badge
  meta: DatasetMeta;
  sectors: Record<SectorCode, SectorMeta>;
  assumptions: Assumption[];
  projects: MaccPoint[]; // sorted ascending by mac (curve order)
  totals: DatasetTotals;
}

/** `data/<country>/workbook.engine.json` — seeds HyperFormula.buildFromSheets. */
export interface WorkbookEngine {
  meta: {
    sourceFile: string;
    modelVersion: string;
    sheetOrder: string[];
  };
  // sheet name -> dense grid of cells (formula strings, literals, or null)
  sheets: Record<string, Array<Array<string | number | boolean | null>>>;
}

/** `data/<country>/fingerprint.json` — consumed by the UI version badge. */
export interface Fingerprint {
  modelVersion: string;
  sourceFile: string;
  sourceDate: string;
  sourceSha256: string;
  etlVersion: string;
  structuralSignature: string;
  display: string; // e.g. "Model v.ab12cd34 · source MACC_KZ_2026-05-29.xlsx"
}

// Sector palette + EN labels are overridden by the ETL's translation overlay,
// but this map is the canonical default used across the app.
export const SECTORS: Record<SectorCode, SectorMeta> = {
  '1.A.1': { color: '#c0392b', label: { ru: 'Энергетические отрасли', en: 'Energy industries (power & heat generation)' } },
  '1.A.2': { color: '#e67e22', label: { ru: 'Обрабатывающая промышленность', en: 'Manufacturing industries & construction' } },
  '1.A.3': { color: '#f1c40f', label: { ru: 'Транспорт', en: 'Transport' } },
  '1.A.4': { color: '#16a085', label: { ru: 'Другие секторы (ЖКХ, здания)', en: 'Other sectors (buildings, residential, commercial)' } },
  '1.B':   { color: '#8e44ad', label: { ru: 'Фугитивные выбросы', en: 'Fugitive emissions (oil, gas, coal)' } },
  '2':     { color: '#2980b9', label: { ru: 'Промышленные процессы (IPPU)', en: 'Industrial processes & product use (IPPU)' } },
  '3':     { color: '#27ae60', label: { ru: 'Сельское хозяйство', en: 'Agriculture' } },
  '4':     { color: '#2ecc71', label: { ru: 'Землепользование (LULUCF)', en: 'Land use (LULUCF)' } },
  '5':     { color: '#7f8c8d', label: { ru: 'Отходы', en: 'Waste' } },
};
