// The measure-authoring data contract — the *input* side of the model.
//
// `data/schema.ts` defines the *output* (`MaccPoint`, one rendered bar). This file
// defines the *input* «measure» object (§2 of `macc-ui-concept.md`) plus the §1
// reference entities and the §6 provenance/binding wrappers. One JSON Schema
// (`measure.schema.json`) mirrors `Measure` and is the single source for the
// authoring form, the MCP contract and `validate()`. `compute(measure, library)`
// turns a measure into a `MaccPoint`-compatible output for plotting.
//
// This module is framework-free on purpose: it is imported unchanged by the
// browser UI, the Node stdio MCP server and the Deno Edge Function (see
// docs/measure-authoring-prototype.md, risk #2 «isomorphic calc core»).
import type { Localized, SectorCode } from '@data/schema';
import type { Ast } from './ast';

export type { Localized, SectorCode };

/** Current measure schema version. Bumped when the `Measure` shape changes (§7, §10). */
export const MEASURE_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Provenance & binding (cross-cutting; attached to every number)
// ─────────────────────────────────────────────────────────────────────────────

export type SourceType =
  | 'official_stat'
  | 'literature'
  | 'standard'
  | 'expert_estimate'
  | 'assumption'
  | 'placeholder';

export type Confidence = 'high' | 'medium' | 'low';

/** §6 — where a number came from. Missing source ⇒ treated as `placeholder`. */
export interface Provenance {
  source_type: SourceType;
  citation?: string;
  url?: string;
  date?: string; // ISO yyyy-mm-dd
  confidence: Confidence;
}

/**
 * §6 — assumption discipline. Every agent-supplied numeric assumption declares
 * how it relates to library, so LLMs reuse / explain divergence / admit locality
 * rather than inventing numbers.
 *  - `reuse` (default): points at a library key; `value` taken from library.
 *  - `alt`: own `value` diverging from `ref`; `divergence_reason` REQUIRED.
 *  - `new`: local value, no library analogue yet ⇒ keeps the measure draft.
 */
export interface Binding {
  mode: 'reuse' | 'alt' | 'new';
  ref?: string; // library key (reuse / alt)
  value?: number; // alt / new
  divergence_reason?: string; // required for `alt`
}

/** A single numeric input carrying its provenance and (optional) binding. */
export interface ValueWithSource {
  value: number;
  unit?: string;
  provenance: Provenance;
  binding?: Binding;
}

/**
 * §6 — provenance + binding for a bare number that lives on the measure as a plain
 * value (object capacity, material qty/price, abatement share/activity…). Attached
 * NOT inline but via `Measure.sources`, keyed by the value's path (e.g.
 * `"created_objects[0].capacity"`), so `compute()` keeps reading the plain numbers
 * and parity is untouched. This is how the measure-notation `sourcing` discipline
 * («accompany every number with a reference») is satisfied without re-shaping the data.
 */
export interface ValueSource {
  provenance: Provenance;
  binding?: Binding;
}

/**
 * §3 — a bare number that is COMPUTED by a formula, not entered. Stored in
 * `Measure.computed`, keyed by the value's path (symmetric to `Measure.sources`),
 * so the same plain numbers stay in place for parity while gaining a formula. The
 * notation rule: a derived number MUST carry its formula here — no black-box pasted
 * values; a number is either an input (`sources[path]`) or computed (`computed[path]`),
 * never neither. `economicsRollup`/`compute` evaluate it (live recompute); the «?»
 * renders it. Leaves: `{ref}` (a measure input, or `res:<id>` for a resource EF),
 * `{const}`; ops `add/sub/mul/div/sum`.
 */
export interface ComputedValue {
  formula: Ast;
  label?: Localized;
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 — The measure object (core = MCP contract)
// ─────────────────────────────────────────────────────────────────────────────

// `published` = passed every automatic guardrail and belongs to the trusted model
// curve; `draft` = a personal work-in-progress; `scenario` = a what-if. Promotion
// to `published` is server-authoritative (the «canon» jargon was dropped —
// jargon — the UI shows it as a green automatic-check status).
export type Scope = 'published' | 'draft' | 'scenario';
export type MaturityStage = 'raw' | 'back_calc' | 'computed';
export type ReviewStatus = 'open' | 'accepted' | 'rejected' | 'wontfix';

/** A flow line: how much of a resource is consumed/produced per service unit. */
export interface Flow {
  resource_ref: string;
  qty_per_unit: number;
  unit?: string;
}

// ── Iteration-2 composition: objects + materials (economics derives from these) ──

/**
 * An object we BUILD (a library `technology` instance at a measure-specific
 * `capacity`). CAPEX rolls up as `capex_musd ?? capacity × tech.capex_ud × factor / 1e6`
 * (the factor converts the capacity unit to the capex_ud denominator unit, e.g.
 * MW→kW = 1000). `opex_musd` is this object's annual OPEX line (signed).
 */
export interface BuiltObject {
  object_ref: string; // technology id (library)
  capacity?: number;
  unit?: string;
  capex_ud_factor?: number; // capacity-unit → capex_ud-unit (default 1)
  capex_musd?: number; // explicit CAPEX when it isn't capacity-driven
  opex_musd?: number; // annual OPEX line for this object (signed)
}

/** An object we CLOSE/retire — its maintenance CAPEX/OPEX become avoided (negative). */
export interface RetiredObject {
  object_ref: string;
  capacity?: number;
  unit?: string;
  capex_ud_factor?: number;
  maintenance_capex_musd?: number; // avoided maintenance CAPEX (subtracted)
  opex_musd?: number; // avoided OPEX (signed)
}

/**
 * A key raw material flow. `+` (side='new') for the new objects, `−` (side='retired')
 * for the displaced ones. Cost rolls up as `cost_musd ?? qty × price / 1e6`, signed
 * by side, so a displaced fuel is a saving and sold output (e.g. methane) is revenue.
 */
export interface Material {
  resource_ref: string;
  side: 'new' | 'retired';
  qty?: number;
  price?: number;
  cost_musd?: number; // explicit cost when qty/price aren't both known
  unit?: string;
}

/** §2 `abatement` — exactly one block, keyed by the measure's maturity stage (§5). */
export interface AbatementRaw {
  share: number; // fraction of the sector/sub-category baseline
  justification?: string;
}
export interface AbatementBackCalc {
  share: number;
  activity_scalar: { qty: number; unit: string };
  implied_factor?: number; // (ro) derived = (baseline × share) / activity_scalar.qty
  reference_ref: string; // §7 factor corridor this implied value is checked against
}
export interface AbatementComputed {
  formula_ref: string; // FormulaTemplate.id or inline-AST id
  bindings: Record<string, FormulaBinding>; // slot name → key/const it maps to
  derived_share?: number; // (ro)
}
export interface Abatement {
  raw?: AbatementRaw;
  back_calc?: AbatementBackCalc;
  computed?: AbatementComputed;
}

/** Maps a template slot to a measure input key, a resource property, or a const. */
export type FormulaBinding =
  | { ref: string } // named key (measure input / resource.ef / …)
  | { const: number };

/**
 * §2/§4 `economics` — same on every maturity stage. CAPEX/OPEX are entered where
 * they arise (build / baseline / project panels) and only *rolled up* here; each
 * line carries provenance + binding so the implied $/unit is checkable (§7 Y-axis).
 */
export interface Economics {
  capex: ValueWithSource[]; // build cost − residual value of what's retired
  opex: ValueWithSource[]; // Σ(Δflow × price) + maintenance %, signed
  revenue: ValueWithSource[];
}

/** §7 — potential ceiling: which dimension caps the measure and against which pool. */
export type CeilingDim = 'cut_resource' | 'output_product' | 'n_objects' | 'activity';
export interface Potential {
  ceiling_dim: CeilingDim;
  pool_ref: string; // §1 pool; a self-created pool ⇒ measure stays draft
  // Measures sharing a pool «combine»: their summed potential can't exceed the
  // pool ceiling, so on oversubscription the cheaper (lower-MAC) ones claim it
  // first and the rest are clipped (see stackPools in validate.ts).
  combination_group?: string;
}

/** §2 — the measure. One JSON Schema (`measure.schema.json`) mirrors this type. */
export interface Measure {
  id: string;
  schema_version: number; // MEASURE_SCHEMA_VERSION at write time
  name: Localized;
  sector_ref: SectorCode; // primary sector (curve color / filter)
  /** Iteration-2: a measure may span several sectors/subsectors (CCS/CCUS). */
  sectors?: Array<{ sector_ref: SectorCode; subsector_ref?: string }>;
  /** Product we produce (displacing conventional production); optional for practices/capture. */
  product_ref?: string;
  technology_ref?: string; // primary object (kept for the economics guardrail)

  scope: Scope; // §7/§9 — promotion to `published` is server-authoritative
  owner_ref?: string; // identity-claim from the write path (§9); required to persist
  maturity_stage: MaturityStage; // §5 — inferred, shown read-only
  review_status?: ReviewStatus; // governance; does NOT gate library at start (§7)

  // §2 comparison — A/B axis is inferred, not asked.
  comparison?: {
    service_unit_ref?: string; // A → baseline & project products validated for match
    is_substitution: boolean; // B (CCS, agro) → no product-match check
  };

  // §4 flows — steps 3–4; empty on `raw`.
  flows?: {
    baseline: Flow[];
    project: Flow[];
  };

  // §1 local indicators (IN-L): the engineering premises a measure rests on
  // (installed capacity, capacity factor, shares, …). Referenced by formula
  // bindings (`{ref: '<key>'}`) and by the economics line items.
  inputs?: Record<string, ValueWithSource>;

  // §6 — provenance + binding for the measure's INPUT bare numbers (object/material/
  // abatement values), keyed by value path (e.g. "created_objects[0].capacity",
  // "materials[1].price", "abatement.back_calc.share"). Read-only metadata: it does
  // NOT feed compute(); it powers the «?» source/binding display and the §6 rollup.
  sources?: Record<string, ValueSource>;

  // §3 — formulas for the measure's COMPUTED bare numbers, keyed by the same value
  // paths as `sources`. A path appears in `sources` (input) XOR `computed` (derived).
  // compute()/economicsRollup evaluate these (e.g. fuel qty = capacity × КИУМ × hours
  // × intensity); the «?» renders the formula. validate() flags any computed number
  // without a formula and any taggable number that is in neither map.
  computed?: Record<string, ComputedValue>;

  abatement: Abatement; // §5 — exactly one stage block populated
  // Iteration-2: economics derives from these (see economicsRollup). The legacy
  // free-form `economics` is kept only as a fallback for un-migrated measures.
  created_objects?: BuiltObject[]; // «Что создаём»
  retired_objects?: RetiredObject[]; // «Что закрываем»
  materials?: Material[]; // key raw materials (OPEX)
  economics?: Economics; // legacy free-form CAPEX/OPEX line items (fallback)
  potential?: Potential; // §7

  // (ro) §6 — weakest confidence along the whole chain; filled by the engine.
  provenance_rollup?: Confidence;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Reference entities (the library). Stratified by "is it a check, or its subject".
// ─────────────────────────────────────────────────────────────────────────────

/** §1 — energy carrier / carbon-bearing substance. `ef`/`price` validated vs a reference. */
export interface Resource {
  id: string;
  name: Localized;
  unit: string;
  /** Emission factor. Scalar, or a year/scenario time series (e.g. grid electricity). */
  ef: number | Record<string, number>;
  price?: number;
  provenance?: Provenance;
}

/**
 * §1 — technology. `kind` says what sort of thing it is, which drives the
 * descriptive rules and the economics expectation:
 *  - `capital_asset`   — a new capital-intensive object (a plant, an installation);
 *                        expects a unit CAPEX + a physical denominator.
 *  - `modernization`   — an upgrade/conversion of an existing asset.
 *  - `practice`        — an operational/organizational measure; CAPEX may be ~0.
 *  - `infrastructure`  — networks, pipelines, capture/storage systems.
 * `capex_ud` (unit CAPEX) is validated vs a reference for asset-like kinds.
 */
export type TechnologyKind = 'capital_asset' | 'modernization' | 'practice' | 'infrastructure';
export interface Technology {
  id: string;
  name: Localized;
  kind: TechnologyKind;
  description?: Localized;
  rules?: Localized; // human-readable expectations (what CAPEX/denominator look like)
  capex_ud?: number; // unit CAPEX (e.g. $/kW) — denormalized from its indicator
  capex_ud_unit?: string; // the unit CAPEX denominator (e.g. "$/kW", "$/head")
  capex_ud_reference_ref?: string; // reference the capex_ud indicator is checked against (§7 economics)
  opex_ud?: number; // unit OPEX (e.g. $/kW/yr)
  maintenance_capex_ud?: number; // unit maintenance CAPEX (for retired objects)
  eff?: number; // efficiency / COP
  lifetimeYrs?: number;
  /** Individual performance indicators (capacity factor, recovery rate, …). */
  indicators?: Array<{ key: string; label: Localized; value: number; unit?: string }>;
  opex_profile?: ValueWithSource[];
  resource_refs?: string[];
  provenance?: Provenance;
}

/** §1 — product / service; `service_unit` is the comparability anchor (axis A). */
export interface Product {
  id: string;
  name: Localized;
  unit: string;
  service_unit?: string;
  /** Carbon footprint of the conventional production this product displaces. */
  carbon_footprint?: { value: number; unit: string };
}

/** A sector subsector (e.g. Energy → coal power). Seeded from «Выбросы», extendable. */
export interface Subsector {
  id: string;
  label: Localized;
}

/**
 * The measure-notation framework (bilingual): the single runtime source for the
 * UI tooltips / «?» help, the MCP `schema://measure` descriptions and the agent
 * prompt — `data/kz/library/measure-notation.json`. Design rationale stays in
 * `macc-ui-concept.md`; structural validation in `data/measure.schema.json`; this
 * is the operational how-to-fill guidance (the only place the instruction text lives).
 */
export interface NotationEntry { help: Localized }
export interface MeasureNotation {
  /** Per-panel «what this panel is for / what to fill». */
  panels: Record<string, NotationEntry>;
  /** Per-field «how to fill it / what reference to attach». Covers EVERY authored field. */
  fields: Record<string, NotationEntry>;
  /** Per-enum-value meaning (maturity/type/scope/techKind/sourceType/confidence/bindingMode/ceilingDim/materialSide). */
  enums: Record<string, Record<string, NotationEntry>>;
  /** «What references to accompany numbers with» — the §6 provenance/binding/reference discipline. */
  sourcing: Record<string, NotationEntry>;
  /** «Requirements for writing formulas» — the §3 AST notation (operators, leaves, example). */
  formulas: Record<string, NotationEntry>;
}

/** §3 — a stored formula template: AST over named slots, compiled to HyperFormula. */
export interface FormulaTemplate {
  id: string;
  /** Human name + plain-language description of the method (shown in the UI). */
  label: Localized;
  description?: Localized;
  output: 'abatement' | 'capex' | 'opex' | 'revenue';
  expr: Ast;
  slots: Array<{ name: string; accepts: 'input' | 'resource.ef' | 'const'; label?: Localized }>;
  provenance?: Provenance;
}

/**
 * §7 — a guardrail check stored as data: the formula that computes the checked
 * quantity (AST over slots) and the predicate it must satisfy (AST over the
 * computed `value` and the corridor/ceiling slots). validate() binds the slots,
 * evaluates both through HyperFormula, and renders the formula for the UI — the
 * check lives in library notation, not in code.
 */
export interface CheckDef {
  id: 'factor' | 'economics' | 'pool' | 'sector';
  label: Localized;
  quantity: Ast; // value being checked (e.g. implied factor = abatement / activity)
  predicate: Ast; // e.g. between(value, min, max) or lte(value, ceiling)
}

// ── Iteration-3 entity graph: the Indicator is the hub ───────────────────────
export type IndicatorOwnerKind = 'object' | 'resource' | 'product' | 'global';

/**
 * §1 hub — every library number (capex_ud, ef, price, carbon_footprint, eff …) is an
 * indicator owned by an object/resource/product/global and optionally validated by a
 * reference. This is the normalized storage form (`graph.seed.json` / the Supabase
 * `indicators` table). The loader also denormalizes each value onto its owner so the
 * engine keeps reading `technology.capex_ud` / `resource.ef` unchanged (parity-safe).
 */
export interface Indicator {
  id: string;
  key: string; // capex_ud | maintenance_capex_ud | opex_ud | eff | ef | price | carbon_footprint
  owner_kind: IndicatorOwnerKind;
  owner_ref: string;
  value: number;
  unit?: string;
  reference_ref?: string;
  provenance?: Provenance;
}

/** §1/§7 — the single reference concept for both axes: a corridor a value is checked against. */
export interface Reference {
  id: string;
  type: string; // e.g. "factor:CH4/head", "capex_ud:CHP"
  range: [number, number]; // [min, max]
  unit: string;
  source?: Provenance;
}

/** §1/§7 — a resource/product/activity pool with an annual-flow ceiling. */
export interface Pool {
  id: string;
  caps_ref: string; // what it caps (Resource / Product / activity) — pins entity + unit
  annual_flow: number; // ceiling as an annual flow, NOT a stock
  unit: string;
  sector: SectorCode;
  /** Sub-category baseline emissions used by the §7 sector backstop (kt CO₂eq/yr). */
  baselineEmissionsKt?: number;
}

/** §1 — global parameters: read-only, shared across measures. */
export interface GlobalParams {
  discountRate: number;
  year?: string; // year / scenario selector for time-series EFs
  gridEf?: Record<string, number>; // grid electricity EF time series
}

/** The published bundle `compute()`/`validate()` resolve refs against. */
export interface Library {
  resources: Record<string, Resource>;
  technologies: Record<string, Technology>;
  products: Record<string, Product>;
  formulaTemplates: Record<string, FormulaTemplate>;
  references: Record<string, Reference>;
  pools: Record<string, Pool>;
  /** §7 guardrail definitions as stored AST formulas (keyed by check id). */
  checks: Record<string, CheckDef>;
  /** §1 hub — every library number as an indicator (storage form; also denormalized onto owners). */
  indicators: Indicator[];
  /** Sector → subsectors (seeded from «Выбросы», extendable). */
  subsectors: Record<string, Subsector[]>;
  /** The measure-notation framework (UI help / MCP / agent prompt). */
  notation: MeasureNotation;
  globals: GlobalParams;
}
