// §7 — `validate()`: the guardrails that gate automatic promotion, plus the §4
// per-panel completeness the authoring UI and MCP `validate` tool surface.
//
// The four guardrails are stored as AST notation in the library (`checks.json`), not
// hardcoded here: validate() binds their slots from measure-derived values,
// evaluates the quantity + predicate through HyperFormula, and returns enough
// (status, value, bound slots) for the UI to render each check's formula.
//   factor    — physics: per-unit factor vs reference corridor (X-axis)
//   economics — implied unit CAPEX vs technology band (Y-axis)
//   pool      — Σ by pool ≤ ceiling, via MAC-order stacking (order-independent)
//   sector    — reduction ≤ sub-category baseline (coarse backstop)
//   limit     — this measure's own consumption ≤ an industry ceiling (per-measure)
//
// Publication is never blocked; only promotion to `published` is — and that is
// server-authoritative (Edge Function). This pure function only reports.
import { type Ast, isNode, isLeafSlot } from './ast';
import { evalAst, evalPredicate, type RefResolver } from './eval';
import { compute, makeResolver, type ComputedMeasure } from './compute';
import { dimensionCheck, type DimensionResult } from './dimension-check';
import type { Binding, Library, CheckDef, Measure, Scope } from './schema';

export type CheckStatus = 'ok' | 'warn' | 'na';
export type PanelStatus = 'ok' | 'warn' | 'incomplete';
export type CheckId = 'factor' | 'economics' | 'pool' | 'sector' | 'limit';

export type PanelKey =
  | 'overview' | 'build' | 'baseline' | 'project' | 'reduction' | 'economics' | 'potential';

/** Everything the UI needs to render one guardrail's stored formula + verdict. */
export interface CheckDetail {
  status: CheckStatus;
  value: number | null; // the computed quantity (null when na)
  slots: Record<string, number>; // bound slot values (for rendering the formula)
}

/** §6 drift entry — a `binding.mode='reuse'` whose local value disagrees with the source it claims. */
export interface DriftEntry {
  path: string; // where the local number lives in the measure (e.g. "created_technologies[0].capacity")
  ref: string; // the binding.ref the local value claims to mirror
  local: number; // the number stored on the measure
  bound: number; // the number resolved through ref
}

export interface ValidateResult {
  missing: string[];
  /** §3/§6 notation rule: taggable numbers that are neither an input (sources) nor computed. */
  untagged: string[];
  /** Paths declared computed but without a (valid) formula. */
  computedNoFormula: string[];
  /** §6 reuse-drift: binding.mode='reuse' but local value ≠ bound source. Gates eligibility. */
  drift: DriftEntry[];
  maturity: Measure['maturity_stage'];
  /** Recommended scope (advisory). Actual `published` promotion is server-side. */
  scope: Scope;
  eligibleForModel: boolean;
  mac: number;
  /** Annual potential after pool stacking (kt CO₂eq/yr). */
  potential: number;
  /** Render-time: this measure's share is clipped by cheaper peers competing for the
   *  same pool ceiling. NOT a quality verdict — a `published` (готово) measure can be
   *  displaced. Scenario-dependent (re-derived per assumptions), never persisted. */
  displaced: boolean;
  panels: Record<PanelKey, PanelStatus>;
  checks: Record<CheckId, CheckStatus>;
  details: Record<CheckId, CheckDetail | null>;
  /** L3 slice 2 — dimensional verdict on the abatement formula (gates the reduction panel). */
  dimension: DimensionResult;
}

/** Economics tolerance: implied unit cost within [0.5×, 2×] of the technology point estimate. */
const ECON_BAND: [number, number] = [0.5, 2.0];

// ── AST slot binding + evaluation ─────────────────────────────────────────────

/** Replace `{slot}` leaves with bound numeric constants, leaving a slot-free AST. */
function bindSlots(ast: Ast, slots: Record<string, number>): Ast {
  if (isLeafSlot(ast)) {
    const v = slots[ast.slot];
    if (v == null) throw new Error(`Unbound slot '${ast.slot}'`);
    return { const: v };
  }
  if (isNode(ast)) return { op: ast.op, args: ast.args.map((a) => bindSlots(a, slots)) };
  return ast;
}

const noRef = () => {
  throw new Error('Check formulas must not contain {ref} leaves — only slots/consts');
};

/** Evaluate a stored check: compute its quantity, then its predicate over `value`. */
function runCheck(def: CheckDef, slots: Record<string, number>): CheckDetail {
  const value = evalAst(bindSlots(def.quantity, slots), noRef);
  const pass = evalPredicate(bindSlots(def.predicate, { ...slots, value }), noRef);
  return { status: pass ? 'ok' : 'warn', value, slots };
}

// ── pool stacking (§7) ────────────────────────────────────────────────────────

/**
 * Group computed measures by their pool, sort each group ascending by MAC (cheapest
 * claims the pool first — gaming-resistant) and clip each measure's potential to the
 * remaining ceiling. Order-independent: input order never changes the result.
 */
export function stackPools(
  computed: ComputedMeasure[],
  measureById: Map<string, Measure>,
  library: Library,
): Map<string, { potential: number; clipped: boolean }> {
  const out = new Map<string, { potential: number; clipped: boolean }>();
  const groups = new Map<string, ComputedMeasure[]>();
  for (const c of computed) {
    const poolRef = measureById.get(c.id)?.potential?.pool_ref;
    const pool = poolRef ? library.pools[poolRef] : undefined;
    if (!pool) {
      out.set(c.id, { potential: c.abatementKt, clipped: false });
      continue;
    }
    (groups.get(poolRef!) ?? groups.set(poolRef!, []).get(poolRef!)!).push(c);
  }
  for (const [poolRef, group] of groups) {
    let remaining = library.pools[poolRef].annual_flow;
    for (const c of [...group].sort((a, b) => a.mac - b.mac)) {
      const got = Math.max(0, Math.min(c.abatementKt, remaining));
      remaining -= got;
      out.set(c.id, { potential: got, clipped: got < c.abatementKt });
    }
  }
  return out;
}

// ── guardrails (slots bound here; formulas live in library.checks) ──────────────

function buildChecks(
  measure: Measure,
  c: ComputedMeasure,
  library: Library,
  peers: { measure: Measure; computed: ComputedMeasure }[],
): { checks: Record<CheckId, CheckStatus>; details: Record<CheckId, CheckDetail | null> } {
  const details: Record<CheckId, CheckDetail | null> = { factor: null, economics: null, pool: null, sector: null, limit: null };

  // factor — §7 X-axis: the per-unit factor the measure asserts (the `factor_ref` input)
  // vs that input's reference corridor.
  const factorInput = measure.abatement.factor_ref ? measure.inputs?.[measure.abatement.factor_ref] : undefined;
  const ref = factorInput?.reference_ref ? library.references[factorInput.reference_ref] : undefined;
  if (factorInput && ref) {
    details.factor = runCheck(library.checks.factor, {
      factor: factorInput.value, min: ref.range[0], max: ref.range[1],
    });
  }

  // economics — needs a technology unit CAPEX + a physical denominator (input).
  const tech = measure.technology_ref ? library.technologies[measure.technology_ref] : undefined;
  const denom = measure.inputs?.capex_denominator?.value;
  if (tech?.capex_ud && denom) {
    // §7 economics: corridor from the capex_ud indicator's reference; else a ±band.
    const r = tech.capex_ud_reference_ref ? library.references[tech.capex_ud_reference_ref] : undefined;
    const [min, max] = r ? r.range : [ECON_BAND[0] * tech.capex_ud, ECON_BAND[1] * tech.capex_ud];
    details.economics = runCheck(library.checks.economics, { capex: c.capex, denominator: denom, min, max });
  }

  // pool — MAC-cumulative: pool peers at least as cheap (MAC ≤ ours) claim the ceiling
  // first; this measure warns iff *its* share is the one clipped (matches stackPools and
  // checks.md), not whenever the whole group oversubscribes.
  const poolRef = measure.potential?.pool_ref;
  const pool = poolRef ? library.pools[poolRef] : undefined;
  if (pool) {
    const cheaperInPool = peers.filter(
      (p) => p.measure.potential?.pool_ref === poolRef && p.computed.mac <= c.mac,
    );
    const cum = c.abatementKt + cheaperInPool.reduce((s, p) => s + p.computed.abatementKt, 0);
    details.pool = runCheck(library.checks.pool, { sum_pool: cum, ceiling: pool.annual_flow });
  }

  // sector — reduction vs the sub-category baseline.
  if (pool?.baselineEmissionsKt != null) {
    details.sector = runCheck(library.checks.sector, { abatement: c.abatementKt, baseline: pool.baselineEmissionsKt });
  }

  // limit — §7 per-measure limiting factor: this measure's own consumption (an input/computed
  // value, resolved bottom-up) vs an industry ceiling stored as a library indicator. Independent
  // of the pool; bounds the volume, not the MAC. Skipped silently if either ref doesn't resolve.
  const limit = measure.potential?.limit;
  if (limit) {
    const ceiling = library.indicators.find((i) => i.id === limit.indicator_ref)?.value;
    let consumption: number | undefined;
    try {
      consumption = makeResolver(measure, library)(limit.consumption_ref);
    } catch {
      consumption = undefined;
    }
    if (ceiling != null && consumption != null) {
      details.limit = runCheck(library.checks.limit, { consumption, ceiling });
    }
  }

  const status = (d: CheckDetail | null): CheckStatus => d?.status ?? 'na';
  return {
    details,
    checks: {
      factor: status(details.factor), economics: status(details.economics),
      pool: status(details.pool), sector: status(details.sector), limit: status(details.limit),
    },
  };
}

// ── §3/§6 notation completeness: every bare number is input XOR computed ────────

/** The measure's bare numbers that must each be tagged (input source or computed formula).
 *  A `{ref}` form is already tagged (the ref *is* the link), so only literal numbers are listed. */
export function taggablePaths(m: Measure): string[] {
  const p: string[] = [];
  const isLit = (v: unknown) => typeof v === 'number';
  (m.created_technologies ?? []).forEach((o, i) => {
    if (isLit(o.capacity)) p.push(`created_technologies[${i}].capacity`);
    if (isLit(o.capex_musd)) p.push(`created_technologies[${i}].capex_musd`);
    if (isLit(o.opex_musd)) p.push(`created_technologies[${i}].opex_musd`);
  });
  (m.retired_technologies ?? []).forEach((o, i) => {
    if (isLit(o.capacity)) p.push(`retired_technologies[${i}].capacity`);
    if (isLit(o.maintenance_capex_musd)) p.push(`retired_technologies[${i}].maintenance_capex_musd`);
    if (isLit(o.opex_musd)) p.push(`retired_technologies[${i}].opex_musd`);
  });
  (m.materials ?? []).forEach((mt, i) => {
    if (isLit(mt.qty) || m.computed?.[`materials[${i}].qty`]) p.push(`materials[${i}].qty`);
    if (isLit(mt.price) || m.computed?.[`materials[${i}].price`]) p.push(`materials[${i}].price`);
    // §A1 — an explicit cost is a taggable number too (symmetry with qty/price); without
    // this an inline `cost_musd` is a black-box value the notation rule never flags.
    if (isLit(mt.cost_musd) || m.computed?.[`materials[${i}].cost_musd`]) p.push(`materials[${i}].cost_musd`);
  });
  if (m.abatement.raw) p.push('abatement.raw.share');
  return p;
}

/** Numbers that violate the notation rule: untagged, or declared computed w/o a formula. */
function notationGaps(m: Measure): { untagged: string[]; computedNoFormula: string[] } {
  const untagged = taggablePaths(m).filter((p) => !m.sources?.[p] && !m.computed?.[p]);
  const computedNoFormula = Object.entries(m.computed ?? {})
    .filter(([, c]) => !c || c.formula == null)
    .map(([p]) => p);
  return { untagged, computedNoFormula };
}

// ── §6 reuse-drift detector (Phase A backstop) ────────────────────────────────
//
// A measure number with `binding.mode='reuse'` claims to be taken from the
// library or another local key. Today binding is pure provenance — the engine
// reads the stored number, not the bound source — so the canonical value and
// the local copy can silently drift apart (kz-27: capacity=1500, cap_mw=1163 →
// CAPEX on one scale, abatement on another). Until binding becomes a live link
// (Phase B/C), validate compares the two and blocks promotion on a mismatch.

const DRIFT_REL_TOL = 1e-6;
const relDiff = (a: number, b: number) =>
  Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);

/** JS-style path access (`a.b[0].c`) into the measure document. */
function readPath(measure: Measure, path: string): unknown {
  let cur: unknown = measure;
  for (const seg of path.match(/[^.[\]]+/g) ?? []) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Resolve a `binding.ref` to its source value for drift comparison. The shared
 * `makeResolver` knows every prefix (`res:<id>#<key>`, `obj:<id>#<key>`,
 * `prd:<id>#<key>`, `sub:<id>#<key>`, `glb:<key>`, `in:<key>` plus bare keys);
 * what it does not know is JS paths into the measure document
 * (`created_technologies[0].capacity`), so we fall back to a path-walk for
 * refs containing `.` or `[`. Anything still unresolved returns undefined and
 * the drift check is silently skipped.
 */
function resolveBindingRef(
  ref: string,
  measure: Measure,
  resolve: RefResolver,
): number | undefined {
  try { return resolve(ref); } catch { /* fall through */ }
  if (ref.includes('.') || ref.includes('[')) {
    const v = readPath(measure, ref);
    if (typeof v === 'number') return v;
  }
  return undefined;
}

/** Find every `binding.mode='reuse'` whose local value disagrees with its bound source. */
export function findDrift(measure: Measure, library: Library): DriftEntry[] {
  const resolve = makeResolver(measure, library);
  const out: DriftEntry[] = [];
  const check = (path: string, local: number, binding?: Binding) => {
    if (binding?.mode !== 'reuse' || !binding.ref) return;
    const bound = resolveBindingRef(binding.ref, measure, resolve);
    if (bound == null) return;
    if (relDiff(local, bound) > DRIFT_REL_TOL) {
      out.push({ path, ref: binding.ref, local, bound });
    }
  };
  for (const [k, v] of Object.entries(measure.inputs ?? {})) {
    if (typeof v.value === 'number') check(`inputs.${k}`, v.value, v.binding);
  }
  for (const [p, s] of Object.entries(measure.sources ?? {})) {
    const local = readPath(measure, p);
    if (typeof local === 'number') check(p, local, s.binding);
  }
  return out;
}

// ── panels (§4) ──────────────────────────────────────────────────────────────

function buildPanels(
  measure: Measure,
  checks: Record<CheckId, CheckStatus>,
  missing: string[],
): Record<PanelKey, PanelStatus> {
  // An inline `abatement.formula` is a valid reduction definition too (the 26 migrated
  // measures use it) — recognize it so the panel isn't falsely flagged incomplete.
  const stageBlock = measure.abatement.formula ?? measure.abatement.raw ?? measure.abatement.computed;

  const req = (cond: boolean, label: string): PanelStatus => {
    if (cond) return 'ok';
    missing.push(label);
    return 'incomplete';
  };

  // §B product rule: every measure carries exactly one product except a pure removal
  // (mechanism='removal'). Advisory — a missing product warns (≠ incomplete) so it never
  // gates eligibility; it just lands on the authoring worklist.
  const productOk = !!measure.product_ref || measure.mechanism === 'removal';

  return {
    // Iteration-2 panels: build = «Что создаём» (objects), baseline = «Отрасль и
    // продукт» (sector required; product required unless pure removal — advisory warn).
    overview: req(!!measure.name && !!measure.sector_ref, 'name/sector'),
    build: req((measure.created_technologies?.length ?? 0) > 0 || !!measure.technology_ref, 'created_technologies'),
    baseline: !measure.sector_ref
      ? (missing.push('sector'), 'incomplete')
      : !measure.baseline_basis
        ? (missing.push('baseline_basis'), 'incomplete') // §B — required now all measures are authored on the axis
        : productOk ? 'ok' : (missing.push('product_ref'), 'warn'),
    project: 'ok',
    reduction: !stageBlock
      ? (missing.push('abatement'), 'incomplete')
      : checks.factor === 'warn' ? 'warn' : 'ok',
    economics:
      (measure.created_technologies?.length ?? 0) > 0 || (measure.materials?.length ?? 0) > 0 || (measure.economics?.capex?.length ?? 0) > 0
        ? (checks.economics === 'warn' ? 'warn' : 'ok')
        : (missing.push('objects/materials'), 'incomplete'),
    // pool_ref + a per-measure limit are both required (incomplete if absent now that every
    // measure is authored on the limiting factor); a limit *overflow* degrades to 'warn'.
    potential: !measure.potential?.pool_ref
      ? (missing.push('potential.pool_ref'), 'incomplete')
      : !measure.potential?.limit
        ? (missing.push('potential.limit'), 'incomplete')
        : checks.limit === 'warn' ? (missing.push('potential.limit exceeded'), 'warn') : 'ok',
  };
}

// ── entry point ────────────────────────────────────────────────────────────

/**
 * Validate one measure. `peers` (other measures) lets the pool guardrail stack
 * across a group; omit it to check the measure against its pool alone.
 */
export function validate(measure: Measure, library: Library, peers: Measure[] = []): ValidateResult {
  const c = compute(measure, library);
  const peerComputed = peers.map((m) => ({ measure: m, computed: compute(m, library) }));

  const { checks, details } = buildChecks(measure, c, library, peerComputed);

  const measureById = new Map<string, Measure>([[measure.id, measure], ...peers.map((m) => [m.id, m] as const)]);
  const alloc = stackPools([c, ...peerComputed.map((p) => p.computed)], measureById, library).get(c.id)
    ?? { potential: c.abatementKt, clipped: false };

  const poolRef = measure.potential?.pool_ref;
  const poolInLibrary = !!poolRef && !!library.pools[poolRef];

  const missing: string[] = [];
  const panels = buildPanels(measure, checks, missing);

  // §3/§6 notation rule: a black-box number (untagged) or a computed value missing its
  // formula degrades the panel that holds it to 'incomplete' (so it can't be promoted).
  const { untagged, computedNoFormula } = notationGaps(measure);
  const offenders = [...untagged, ...computedNoFormula];
  if (offenders.length) {
    const has = (...prefixes: string[]) => offenders.some((p) => prefixes.some((pre) => p.startsWith(pre)));
    const degrade = (s: PanelStatus): PanelStatus => (s === 'warn' ? s : 'incomplete');
    if (has('materials', 'created_technologies', 'retired_technologies')) panels.economics = degrade(panels.economics);
    if (has('created_technologies')) panels.build = degrade(panels.build);
    if (has('abatement')) panels.reduction = degrade(panels.reduction);
    missing.push(...offenders.map((p) => `untagged number: ${p}`));
  }

  // §6 reuse-drift: any binding.mode='reuse' whose local value disagrees with its bound
  // source is silent rot — the canonical value and the local copy have come apart. Phase A
  // surfaces every mismatch on `missing` and blocks promotion; Phase B will turn the worst
  // cases into live refs that can't drift in the first place.
  const drift = findDrift(measure, library);
  if (drift.length) {
    missing.push(...drift.map((d) =>
      `drift: ${d.path} = ${d.local} but binding.ref="${d.ref}" → ${d.bound}`));
  }

  // Non-degeneracy: a measure that declares created_technologies (claims to build capital
  // objects) but whose net CAPEX rolls to ~0 is structurally broken — its MAC rests on
  // nothing (kz-27: created_technologies present but capacity/capex_ud absent → CAPEX=0,
  // and with no capex_denominator the economics corridor check stays 'na', so without this
  // it could pass `готово`). A retirement can legitimately net the build CAPEX to ~0, so
  // that case is exempt. Surfaced on `missing` + degrades the economics panel (which gates).
  const DEGENERATE_EPS = 1e-9;
  const buildsButFree = (measure.created_technologies?.length ?? 0) > 0
    && (measure.retired_technologies?.length ?? 0) === 0
    && Math.abs(c.capex) < DEGENERATE_EPS;
  if (buildsButFree) {
    missing.push('degenerate: builds objects (created_technologies) but CAPEX rolls to 0');
    if (panels.economics !== 'warn') panels.economics = 'incomplete';
  }

  // L3 slice 2 — dimensional gate: the abatement formula must reduce to a CO₂ quantity
  // when its units are folded over the bridge vocabulary. A missing/unknown unit, an
  // add/sub of incompatible dimensions, or a final dimension that is not CO₂/year is a
  // hard gate — it degrades the reduction panel to incomplete (so the measure stays draft).
  // `na` (a raw-share measure with no foldable AST) is a pass.
  const dimension = dimensionCheck(measure, library);
  if (dimension.status === 'warn') {
    missing.push(...dimension.issues.map((s) => `dimension: ${s}`));
    if (panels.reduction !== 'warn') panels.reduction = 'incomplete';
  }

  // §7 precondition: belongs to a published pool, no failing INTRINSIC guardrail, no
  // incomplete panel, no drift. The `pool` check is EXCLUDED here — being clipped by
  // cheaper peers (pool oversubscription) is a render-time allocation outcome, not a
  // quality failure, so it never blocks promotion (it surfaces as `displaced` instead).
  // Pool *membership* still gates (poolInLibrary); pool *competition* does not.
  const GATING_CHECKS: CheckId[] = ['factor', 'economics', 'sector', 'limit'];
  const noWarn = GATING_CHECKS.every((k) => checks[k] !== 'warn');
  const panelsComplete = Object.values(panels).every((s) => s !== 'incomplete');
  const eligibleForModel = poolInLibrary && noWarn && panelsComplete && drift.length === 0;

  return {
    missing,
    untagged,
    computedNoFormula,
    drift,
    maturity: measure.maturity_stage,
    scope: eligibleForModel ? 'published' : 'draft',
    eligibleForModel,
    mac: c.mac,
    potential: alloc.potential,
    displaced: alloc.clipped,
    panels,
    checks,
    details,
    dimension,
  };
}
