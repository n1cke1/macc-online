// Server-authoritative guardrail re-evaluation — a pure-TS path that runs in Deno
// (the Edge Function), where bundling HyperFormula + JSON-import assertions is
// friction. It shares the single pure-TS AST evaluator (`eval.ts`) the whole calc
// path now uses; the guardrails (§7) only need + − × ÷ and comparisons (no PV).
//
// This module takes the library as a parameter (no JSON imports) so it is Deno-clean.
// `measure-golden` pins it against `validate()`/`compute()` so the two agree.
import { type Ast, isLeafSlot, isNode } from './ast';
import { type RefResolver as Resolver, evalAst as evalJs } from './eval';
import { bindTemplate, getTemplate } from './templates';
import type { Library, Measure } from './schema';
import type { CheckId, CheckStatus } from './validate';

function bindSlots(ast: Ast, slots: Record<string, number>): Ast {
  if (isLeafSlot(ast)) {
    const v = slots[ast.slot];
    if (v == null) throw new Error(`Unbound slot '${ast.slot}'`);
    return { const: v };
  }
  if (isNode(ast)) return { op: ast.op, args: ast.args.map((a) => bindSlots(a, slots)) };
  return ast;
}

const noRef: Resolver = () => {
  throw new Error('check formulas must not contain {ref} leaves');
};

/** Resolve a `{ref}`: `res:<id>` → resource EF; a key with a `computed` entry →
 * evaluate it (recursive); else a measure input value. */
function makeResolver(measure: Measure, library: Library): Resolver {
  const resolve: Resolver = (key) => {
    if (key.startsWith('res:')) {
      const r = library.resources[key.slice(4)];
      if (!r) throw new Error(`Unknown resource '${key}'`);
      const ef = typeof r.ef === 'number' ? r.ef : r.ef[library.globals.year ?? ''];
      if (typeof ef !== 'number') throw new Error(`Resource '${key}' has no scalar EF`);
      return ef;
    }
    const c = measure.computed?.[key];
    if (c) return evalJs(c.formula, resolve);
    const inp = measure.inputs?.[key];
    if (!inp) throw new Error(`Measure '${measure.id}' has no input '${key}'`);
    return inp.value;
  };
  return resolve;
}

/** Abatement (kt/yr) by maturity stage — pure-TS mirror of compute.ts. */
export function abatementJs(measure: Measure, library: Library): number {
  const resolve = makeResolver(measure, library);
  const a = measure.abatement;
  if (measure.maturity_stage === 'computed' && a.computed) {
    const tmpl = getTemplate(a.computed.formula_ref);
    if (!tmpl) throw new Error(`Unknown template '${a.computed.formula_ref}'`);
    return evalJs(bindTemplate(tmpl, a.computed.bindings, resolve), resolve);
  }
  const block = a.back_calc ?? a.raw;
  if (!block) throw new Error(`Measure '${measure.id}': no abatement block`);
  const baseline = library.pools[measure.potential?.pool_ref ?? '']?.baselineEmissionsKt;
  if (baseline == null) throw new Error(`Measure '${measure.id}': share path needs pool.baselineEmissionsKt`);
  return baseline * block.share;
}

/**
 * Iteration-2 economics roll-up (pure TS, shared by the HF compute() and the
 * server guardrails). CAPEX/OPEX derive from the built/retired objects and the
 * material flows; an un-migrated measure falls back to its legacy free-form
 * `economics` line items. Single source so both calc paths agree.
 */
export function economicsRollup(measure: Measure, library: Library): { capex: number; opex: number } {
  const created = measure.created_objects ?? [];
  const retired = measure.retired_objects ?? [];
  const materials = measure.materials ?? [];

  if (created.length || retired.length || materials.length) {
    const tech = (ref: string) => library.technologies[ref];
    // A bare number is either entered (the inline value) or COMPUTED by a formula in
    // `measure.computed[path]` — when present, the formula wins (single source of truth).
    const resolve = makeResolver(measure, library);
    const pick = (path: string, inline?: number): number | undefined => {
      const c = measure.computed?.[path];
      return c ? evalJs(c.formula, resolve) : inline;
    };
    const capexCreated = created.reduce((s, o, i) =>
      s + (pick(`created_objects[${i}].capex_musd`, o.capex_musd)
        ?? (pick(`created_objects[${i}].capacity`, o.capacity) ?? 0) * (tech(o.object_ref)?.capex_ud ?? 0) * (o.capex_ud_factor ?? 1) / 1e6), 0);
    const capexRetired = retired.reduce((s, r, i) =>
      s + (pick(`retired_objects[${i}].maintenance_capex_musd`, r.maintenance_capex_musd)
        ?? (pick(`retired_objects[${i}].capacity`, r.capacity) ?? 0) * (tech(r.object_ref)?.maintenance_capex_ud ?? 0) * (r.capex_ud_factor ?? 1) / 1e6), 0);
    const opexObjects = created.reduce((s, o, i) => s + (pick(`created_objects[${i}].opex_musd`, o.opex_musd) ?? 0), 0)
      - retired.reduce((s, r, i) => s + (pick(`retired_objects[${i}].opex_musd`, r.opex_musd) ?? 0), 0);
    const opexMaterials = materials.reduce((s, m, i) => {
      const cost = m.cost_musd ?? (pick(`materials[${i}].qty`, m.qty) ?? 0) * (pick(`materials[${i}].price`, m.price) ?? 0) / 1e6;
      return s + (m.side === 'retired' ? -cost : cost);
    }, 0);
    return { capex: capexCreated - capexRetired, opex: opexObjects + opexMaterials };
  }

  // Legacy fallback.
  const e = measure.economics;
  const sum = (xs?: { value: number }[]) => (xs ?? []).reduce((s, x) => s + x.value, 0);
  return { capex: sum(e?.capex), opex: sum(e?.opex) - sum(e?.revenue) };
}

const ECON_BAND: [number, number] = [0.5, 2.0];

export interface GuardrailResult {
  checks: Record<CheckId, CheckStatus>;
  eligible: boolean;
  abatementKt: number;
}

/**
 * Re-run the four guardrails (§7) against the stored check ASTs in `library.checks`,
 * with `peers` for the pool sum. Eligibility = a published pool + no failing check.
 * (Panel completeness is a UI concern; promotion only gates on the guardrails.)
 */
export function runGuardrails(measure: Measure, library: Library, peers: Measure[] = []): GuardrailResult {
  const abatementKt = abatementJs(measure, library);
  const run = (id: CheckId, slots: Record<string, number>): CheckStatus => {
    const def = library.checks[id];
    const value = evalJs(bindSlots(def.quantity, slots), noRef);
    return evalJs(bindSlots(def.predicate, { ...slots, value }), noRef) === 1 ? 'ok' : 'warn';
  };
  const checks: Record<CheckId, CheckStatus> = { factor: 'na', economics: 'na', pool: 'na', sector: 'na' };

  const bc = measure.abatement.back_calc;
  const ref = bc ? library.references[bc.reference_ref] : undefined;
  if (measure.maturity_stage === 'back_calc' && bc && ref) {
    checks.factor = run('factor', { abatement: abatementKt, activity: bc.activity_scalar.qty, min: ref.range[0], max: ref.range[1] });
  }

  const tech = measure.technology_ref ? library.technologies[measure.technology_ref] : undefined;
  const denom = measure.inputs?.capex_denominator?.value;
  if (tech?.capex_ud && denom) {
    const { capex } = economicsRollup(measure, library);
    // §7 economics: corridor from the capex_ud indicator's reference; else a ±band.
    const r = tech.capex_ud_reference_ref ? library.references[tech.capex_ud_reference_ref] : undefined;
    const [min, max] = r ? r.range : [ECON_BAND[0] * tech.capex_ud, ECON_BAND[1] * tech.capex_ud];
    checks.economics = run('economics', { capex, denominator: denom, min, max });
  }

  const poolRef = measure.potential?.pool_ref;
  const pool = poolRef ? library.pools[poolRef] : undefined;
  if (pool) {
    const peerSum = peers
      .filter((p) => p.potential?.pool_ref === poolRef)
      .reduce((s, p) => s + abatementJs(p, library), 0);
    checks.pool = run('pool', { sum_pool: abatementKt + peerSum, ceiling: pool.annual_flow });
  }
  if (pool?.baselineEmissionsKt != null) {
    checks.sector = run('sector', { abatement: abatementKt, baseline: pool.baselineEmissionsKt });
  }

  const eligible = !!pool && Object.values(checks).every((s) => s !== 'warn');
  return { checks, eligible, abatementKt };
}
