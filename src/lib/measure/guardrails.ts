// Server-authoritative guardrail re-evaluation — a pure-TS path that runs in Deno
// (the Edge Function), where bundling HyperFormula + JSON-import assertions is
// friction. It shares the single pure-TS AST evaluator (`eval.ts`) the whole calc
// path now uses; the guardrails (§7) only need + − × ÷ and comparisons (no PV).
//
// This module takes the library as a parameter (no JSON imports) so it is Deno-clean.
// `measure-golden` pins it against `validate()`/`compute()` so the two agree.
import { type Ast, isLeafSlot, isNode } from './ast';
import { type RefResolver as Resolver, evalAst as evalJs, economicCore } from './eval';
import { bindTemplate, getTemplate } from './templates';
import type { Library, Measure } from './schema';
import type { CheckId, CheckStatus } from './validate';
// One shared resolver: compute() and the guardrails must agree on what a {ref}
// means. Imported lazily-bound through ESM cycle (compute → guardrails for
// economicsRollup; guardrails → compute for makeResolver) — safe because both
// call sites are runtime, not module-init.
import { makeResolver, unboxNumber } from './compute';

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

/** Abatement (kt/yr) by maturity stage — pure-TS mirror of compute.ts. */
export function abatementJs(measure: Measure, library: Library): number {
  const resolve = makeResolver(measure, library);
  const a = measure.abatement;
  // §3/§10 — inline abatement AST wins (pure-TS mirror of compute.ts).
  if (a.formula) return evalJs(a.formula, resolve);
  if (measure.maturity_stage === 'computed' && a.computed) {
    const tmpl = getTemplate(a.computed.formula_ref);
    if (!tmpl) throw new Error(`Unknown template '${a.computed.formula_ref}'`);
    return evalJs(bindTemplate(tmpl, a.computed.bindings, resolve), resolve);
  }
  if (!a.raw) throw new Error(`Measure '${measure.id}': no abatement block`);
  const baseline = library.pools[measure.potential?.pool_ref ?? '']?.baselineEmissionsKt;
  if (baseline == null) throw new Error(`Measure '${measure.id}': share path needs pool.baselineEmissionsKt`);
  return baseline * a.raw.share;
}

/**
 * Iteration-2 economics roll-up (pure TS, shared by the HF compute() and the
 * server guardrails). CAPEX/OPEX derive from the built/retired objects and the
 * material flows; an un-migrated measure falls back to its legacy free-form
 * `economics` line items. Single source so both calc paths agree.
 */
export function economicsRollup(measure: Measure, library: Library): { capex: number; opex: number } {
  const created = measure.created_technologies ?? [];
  const retired = measure.retired_technologies ?? [];
  const materials = measure.materials ?? [];

  if (created.length || retired.length || materials.length) {
    const tech = (ref: string) => library.technologies[ref];
    // A bare number is either entered (the inline value), COMPUTED by a formula in
    // `measure.computed[path]`, or a `{ref}` pointer the resolver dereferences. The
    // formula wins, then the ref/inline — single source of truth in all cases.
    const resolve = makeResolver(measure, library);
    const pick = (path: string, inline?: import('./schema').NumberOrRef): number | undefined => {
      const c = measure.computed?.[path];
      if (c) return evalJs(c.formula, resolve);
      return unboxNumber(inline, resolve);
    };
    const capexCreated = created.reduce((s, o, i) =>
      s + (pick(`created_technologies[${i}].capex_musd`, o.capex_musd)
        ?? (pick(`created_technologies[${i}].capacity`, o.capacity) ?? 0) * (tech(o.technology_ref)?.capex_ud ?? 0) * (unboxNumber(o.capex_ud_factor, resolve) ?? 1) / 1e6), 0);
    const capexRetired = retired.reduce((s, r, i) =>
      s + (pick(`retired_technologies[${i}].maintenance_capex_musd`, r.maintenance_capex_musd)
        ?? (pick(`retired_technologies[${i}].capacity`, r.capacity) ?? 0) * (tech(r.technology_ref)?.maintenance_capex_ud ?? 0) * (unboxNumber(r.capex_ud_factor, resolve) ?? 1) / 1e6), 0);
    const opexObjects = created.reduce((s, o, i) => s + (pick(`created_technologies[${i}].opex_musd`, o.opex_musd) ?? 0), 0)
      - retired.reduce((s, r, i) => s + (pick(`retired_technologies[${i}].opex_musd`, r.opex_musd) ?? 0), 0);
    const opexMaterials = materials.reduce((s, m, i) => {
      const explicit = unboxNumber(m.cost_musd, resolve);
      const cost = explicit ?? (pick(`materials[${i}].qty`, m.qty) ?? 0) * (pick(`materials[${i}].price`, m.price) ?? 0) / 1e6;
      return s + (m.side === 'retired' ? -cost : cost);
    }, 0);
    return { capex: capexCreated - capexRetired, opex: opexObjects + opexMaterials };
  }

  // Legacy fallback.
  const e = measure.economics;
  const sum = (xs?: { value: number }[]) => (xs ?? []).reduce((s, x) => s + x.value, 0);
  return { capex: sum(e?.capex), opex: sum(e?.opex) - sum(e?.revenue) };
}

/** Duration (yr) — pure-TS mirror of compute.resolveDuration. */
function durationJs(measure: Measure, library: Library): number {
  const tech = measure.technology_ref ? library.technologies[measure.technology_ref] : undefined;
  const dur = tech?.lifetimeYrs ?? measure.inputs?.lifetime?.value;
  if (dur == null) throw new Error(`Measure '${measure.id}': cannot resolve duration`);
  return dur;
}

/** MAC (USD/tCO₂) — pure-TS mirror of compute(): same rollup + economicCore, for pool ordering. */
function macJs(measure: Measure, library: Library): number {
  const { capex, opex } = economicsRollup(measure, library);
  return economicCore({
    capex, opex, abatementKt: abatementJs(measure, library),
    durationYrs: durationJs(measure, library), discountRate: library.globals.discountRate,
  }).mac;
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
  const checks: Record<CheckId, CheckStatus> = { factor: 'na', economics: 'na', pool: 'na', sector: 'na', limit: 'na' };

  const factorInput = measure.abatement.factor_ref ? measure.inputs?.[measure.abatement.factor_ref] : undefined;
  const ref = factorInput?.reference_ref ? library.references[factorInput.reference_ref] : undefined;
  if (factorInput && ref) {
    checks.factor = run('factor', { factor: factorInput.value, min: ref.range[0], max: ref.range[1] });
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
    // MAC-cumulative: only pool peers at least as cheap claim the ceiling first (mirrors
    // validate.ts + stackPools) — the measure warns iff its own share is the one clipped.
    const ownMac = macJs(measure, library);
    const cum = abatementKt + peers
      .filter((p) => p.potential?.pool_ref === poolRef && macJs(p, library) <= ownMac)
      .reduce((s, p) => s + abatementJs(p, library), 0);
    checks.pool = run('pool', { sum_pool: cum, ceiling: pool.annual_flow });
  }
  if (pool?.baselineEmissionsKt != null) {
    checks.sector = run('sector', { abatement: abatementKt, baseline: pool.baselineEmissionsKt });
  }

  // limit — §7 per-measure ceiling: this measure's consumption vs an industry indicator.
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
      checks.limit = run('limit', { consumption, ceiling });
    }
  }

  const eligible = !!pool && Object.values(checks).every((s) => s !== 'warn');
  return { checks, eligible, abatementKt };
}
