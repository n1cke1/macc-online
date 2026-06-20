// Dimensional vocabulary for the bridge registry (docs/design/dimension-bridges.md, slice 1).
//
// A library unit string → a `Dimension` (exponent vector over base dimensions) + a `scale`
// to the canonical unit of each base. POWER is DERIVED (energy·time⁻¹) on purpose, so МВт,
// МВт·ч/год and Гкал all reduce to consistent dimensions — only the scale differs. This is
// pure data + dimensional algebra; the formula checker (slice 2+) walks a measure's AST over it.
//
// Canonical unit per base: energy=MWh · mass=t · mass_co2=tCO₂e · time=h · currency=USD ·
// count=1 · area=ha · volume=m³. `scale` converts a value in the unit to the product of those
// canonical bases (value_canonical = value_unit × scale).

export type BaseDim =
  | 'energy' | 'mass' | 'mass_co2' | 'time' | 'currency' | 'count' | 'area' | 'volume';

/** Exponent vector over base dims; an absent key means exponent 0. Scalar = `{}`. */
export type Dimension = Partial<Record<BaseDim, number>>;

export interface UnitInfo { dim: Dimension; scale: number }

// ── conversion constants ──────────────────────────────────────────────────────
const YEAR_H = 8760;     // h / yr
const GJ_MWH = 1 / 3.6;  // 1 GJ in MWh (3.6 GJ = 1 MWh) ≈ 0.2778
const GCAL_MWH = 1.163;  // 1 Гкал in MWh

// ── small constructors (keep the table terse + intention-revealing) ───────────
const power = (scale: number): UnitInfo => ({ dim: { energy: 1, time: -1 }, scale }); // energy·time⁻¹
const energy = (scale: number): UnitInfo => ({ dim: { energy: 1 }, scale });
const co2 = (scale: number): UnitInfo => ({ dim: { mass_co2: 1 }, scale });
const co2Rate = (scale: number): UnitInfo => ({ dim: { mass_co2: 1, time: -1 }, scale });
const ef = (scale: number): UnitInfo => ({ dim: { mass_co2: 1, energy: -1 }, scale }); // tCO₂/MWh

/**
 * Every distinct unit string in the library data (graph.seed / measures.seed / checks).
 * RU and EN spellings of the same physical unit map to the same Dimension. Keep this in
 * lockstep with the data — an unmapped unit makes its measure fail the dimensional check.
 */
export const UNIT_TABLE: Record<string, UnitInfo> = {
  // power (energy·time⁻¹)
  'МВт': power(1),
  'кВт': power(1e-3),
  'МВт·ч/год': power(1 / YEAR_H),       // MWh per year = energy·time⁻¹
  'ГВт·ч/год': power(1000 / YEAR_H),
  // energy
  'MWh': energy(1),
  'Гкал': energy(GCAL_MWH),
  'тыс. Гкал': energy(1000 * GCAL_MWH),
  'тыс. Гкал/год': { dim: { energy: 1, time: -1 }, scale: 1000 * GCAL_MWH / YEAR_H },
  // mass
  'т': { dim: { mass: 1 }, scale: 1 },
  // mass_co2 (stock + rate)
  'kt CO₂eq/yr': co2Rate(1000 / YEAR_H),
  'Мт CO₂eq/год': co2Rate(1e6 / YEAR_H),
  // emission factor (mass_co2·energy⁻¹)
  'tCO₂/MWh': ef(1),
  'тCO₂/МВт·ч': ef(1),
  'tCO₂/MWh (coal baseline)': ef(1), // (carrier annotation parsed in a later slice)
  'тCO₂/Гкал': ef(1 / GCAL_MWH),     // boiler EF stated per Гкал of heat (1 Гкал = 1.163 MWh)
  // sequestration rate (mass_co2·area⁻¹·time⁻¹) — afforestation tCO₂ per ha per year
  'тCO₂/(га·год)': { dim: { mass_co2: 1, area: -1, time: -1 }, scale: 1 / YEAR_H },
  // energy intensity (energy·mass⁻¹ / energy·volume⁻¹)
  'ГДж/т': { dim: { energy: 1, mass: -1 }, scale: GJ_MWH },
  'ГДж/тыс. м³': { dim: { energy: 1, volume: -1 }, scale: GJ_MWH / 1000 },
  // co2 per volume / per head·yr (agriculture, fugitive)
  'kt CO₂eq/(million m³)': { dim: { mass_co2: 1, volume: -1 }, scale: 1000 / 1e6 },
  'kt CO₂eq/(млн м³)': { dim: { mass_co2: 1, volume: -1 }, scale: 1000 / 1e6 },
  'kt CO₂eq/(thousand head·yr)': { dim: { mass_co2: 1, count: -1, time: -1 }, scale: 1000 / (1000 * YEAR_H) },
  'kt CO₂eq/(тыс. голов·год)': { dim: { mass_co2: 1, count: -1, time: -1 }, scale: 1000 / (1000 * YEAR_H) },
  // currency (per unit / per yr)
  '$/kW': { dim: { currency: 1, energy: -1, time: 1 }, scale: 1000 },   // $/kW = $·(energy·time⁻¹)⁻¹, kW→MW
  '$/t': { dim: { currency: 1, mass: -1 }, scale: 1 },
  '$/head': { dim: { currency: 1, count: -1 }, scale: 1 },
  '$/farm': { dim: { currency: 1, count: -1 }, scale: 1 },
  '$/head·yr': { dim: { currency: 1, count: -1, time: -1 }, scale: 1 / YEAR_H },
  '$/thousand m³': { dim: { currency: 1, volume: -1 }, scale: 1 / 1000 },
  'mUSD/yr': { dim: { currency: 1, time: -1 }, scale: 1e6 / YEAR_H },
  // count
  'голов': { dim: { count: 1 }, scale: 1 },
  'тыс. голов': { dim: { count: 1 }, scale: 1000 },
  'хозяйств': { dim: { count: 1 }, scale: 1 },        // farms (conflated with count for now)
  // area
  'тыс. га': { dim: { area: 1 }, scale: 1000 },
  // volume
  'млн м³': { dim: { volume: 1 }, scale: 1e6 },
  'тыс. м³': { dim: { volume: 1 }, scale: 1000 },
  'усл. ед. (объём метана)': { dim: { volume: 1 }, scale: 1 }, // conventional methane volume (opaque scale)
  // time
  'лет': { dim: { time: 1 }, scale: YEAR_H },
  // scalar
  'доля': { dim: {}, scale: 1 },
  'fraction': { dim: {}, scale: 1 },
};

// ── dimensional algebra (the checker uses these to fold an AST) ────────────────

/** Drop zero exponents so equal dimensions have one canonical shape. */
function prune(d: Dimension): Dimension {
  const out: Dimension = {};
  for (const [k, v] of Object.entries(d)) if (v) out[k as BaseDim] = v;
  return out;
}

/** Multiply two dimensions = add exponents. */
export function mulDim(a: Dimension, b: Dimension): Dimension {
  const out: Dimension = { ...a };
  for (const [k, v] of Object.entries(b)) out[k as BaseDim] = (out[k as BaseDim] ?? 0) + (v ?? 0);
  return prune(out);
}

/** Divide = subtract exponents. */
export function divDim(a: Dimension, b: Dimension): Dimension {
  const neg: Dimension = {};
  for (const [k, v] of Object.entries(b)) neg[k as BaseDim] = -(v ?? 0);
  return mulDim(a, neg);
}

/** Same physical dimension (ignores scale). */
export function dimEqual(a: Dimension, b: Dimension): boolean {
  const x = prune(a), y = prune(b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if ((x[k as BaseDim] ?? 0) !== (y[k as BaseDim] ?? 0)) return false;
  return true;
}

/** Dimensionless (a pure number / fraction / scale). */
export function isScalar(d: Dimension): boolean {
  return Object.values(prune(d)).every((v) => v === 0);
}

/** Resolve a unit string to its dimension + canonical scale (trims whitespace). */
export function lookupUnit(unit: string): UnitInfo | undefined {
  return UNIT_TABLE[unit.trim()];
}

// ── library-defined units (the vocabulary is data; the algebra above stays code) ──

/** The fixed physical basis. A library unit is a vector over THESE — new bases are not authorable. */
export const BASE_DIMS: readonly BaseDim[] = [
  'energy', 'mass', 'mass_co2', 'time', 'currency', 'count', 'area', 'volume',
];

/** A unit as a library entity: the unit string + its dimension vector + canonical scale. */
export interface LibraryUnit extends UnitInfo { id: string }

/**
 * Validate a library-authored unit before it joins the vocabulary. A unit is a name, a
 * dimension over the FIXED base dims (integer exponents), and a finite non-zero scale to the
 * canonical unit. Returns the list of problems (empty = valid). Used by the upsert path so an
 * agent cannot add a unit the dimensional fold would choke on.
 */
export function validateUnit(u: { id?: string; dim?: Dimension; scale?: number }): string[] {
  const errors: string[] = [];
  if (!u.id || !u.id.trim()) errors.push('unit needs a non-empty id (the unit string)');
  if (typeof u.scale !== 'number' || !Number.isFinite(u.scale) || u.scale === 0) {
    errors.push('unit needs a finite non-zero `scale` to its canonical base unit');
  }
  if (!u.dim || typeof u.dim !== 'object') {
    errors.push('unit needs a `dim` object (exponent vector; {} for a scalar)');
  } else {
    for (const [k, v] of Object.entries(u.dim)) {
      if (!BASE_DIMS.includes(k as BaseDim)) errors.push(`unknown base dimension '${k}' (allowed: ${BASE_DIMS.join(', ')})`);
      if (!Number.isInteger(v)) errors.push(`exponent for '${k}' must be an integer, got ${v}`);
    }
  }
  return errors;
}

/** Build a unit lookup table from the code seed plus a data overlay (overlay wins by id). */
export function mergeUnits(overlay: LibraryUnit[] = []): Record<string, UnitInfo> {
  const out: Record<string, UnitInfo> = { ...UNIT_TABLE };
  for (const u of overlay) out[u.id.trim()] = { dim: u.dim, scale: u.scale };
  return out;
}
