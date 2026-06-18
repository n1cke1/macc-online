// §0/§5 — turn a `Measure` into a plottable result.
//
// One economic core (§0) for every maturity stage; abatement is derived per stage
// (§5): `raw`/`back_calc` = baseline × share, `computed` = a formula template
// evaluated through HyperFormula (§3). The output mirrors `MaccPoint` field names
// (`data/schema.ts`) so the chart/drilldown can render a measure as one more bar.
import type { Localized, SectorCode } from '@data/schema';
import { economicCore, evalAst, type RefResolver } from './eval';
import { bindTemplate, getTemplate } from './templates';
import { economicsRollup } from './guardrails';
import type { Library, Measure } from './schema';

/** Plottable result of a measure — `MaccPoint`-compatible plus authoring extras. */
export interface ComputedMeasure {
  id: string;
  sector: SectorCode;
  name: Localized;
  maturity: Measure['maturity_stage'];
  capex: number; // mUSD
  opex: number; // mUSD/yr, signed
  durationYrs: number;
  abatementKt: number; // kt CO2eq/yr
  npv: number; // mUSD
  discCo2Kt: number;
  mac: number; // USD/tCO2
  /** back_calc only — abatement / activity, compared to a reference corridor (§7 X-axis). */
  impliedFactor?: number;
}

/**
 * Resolve a `{ref}` key: `res:<id>` → resource EF; a key with its own `computed`
 * entry → evaluate that formula (recursive drill-down to primary sources, §3);
 * otherwise a measure input value.
 */
export function makeResolver(measure: Measure, library: Library): RefResolver {
  const resolve: RefResolver = (key: string): number => {
    if (key.startsWith('res:')) {
      const r = library.resources[key.slice(4)];
      if (!r) throw new Error(`unresolved ref '${key}': resource not in the library (registry not hydrated?)`);
      const ef = typeof r.ef === 'number' ? r.ef : r.ef[library.globals.year ?? ''];
      if (typeof ef !== 'number') throw new Error(`unresolved ref '${key}': resource has no EF for the active year`);
      return ef;
    }
    const c = measure.computed?.[key];
    if (c) return evalAst(c.formula, resolve);
    const inp = measure.inputs?.[key];
    if (!inp) throw new Error(`unresolved ref '${key}': measure '${measure.id}' has no such input`);
    return inp.value;
  };
  return resolve;
}

/** Sub-category baseline (kt CO₂eq/yr) the share path scales — taken from the measure's pool. */
function poolBaselineKt(measure: Measure, library: Library): number {
  const ref = measure.potential?.pool_ref;
  const pool = ref ? library.pools[ref] : undefined;
  if (pool?.baselineEmissionsKt == null) {
    throw new Error(`Measure '${measure.id}': share path needs a pool with baselineEmissionsKt`);
  }
  return pool.baselineEmissionsKt;
}

function computeAbatement(
  measure: Measure,
  library: Library,
  resolve: RefResolver,
): { abatementKt: number; impliedFactor?: number } {
  const a = measure.abatement;
  // Guard a malformed by-document doc: no abatement block at all → clear error, never a
  // `Cannot read 'formula' of undefined` TypeError (the tools surface this as advisory).
  if (!a) throw new Error(`Measure '${measure.id}': no 'abatement' block (provide abatement.formula, .computed, .back_calc or .raw)`);
  // §3/§10 — an inline abatement AST wins over the maturity-stage block. It ports the
  // Excel «Расчёты» formula directly (physics or share×baseline), evaluated by eval.ts.
  if (a.formula) {
    const abatementKt = evalAst(a.formula, resolve);
    const act = a.back_calc?.activity_scalar.qty;
    return { abatementKt, impliedFactor: act ? abatementKt / act : undefined };
  }
  switch (measure.maturity_stage) {
    case 'computed': {
      if (!a.computed) throw new Error(`Measure '${measure.id}': maturity=computed but no computed block`);
      const tmpl = getTemplate(a.computed.formula_ref);
      if (!tmpl) throw new Error(`Unknown formula template '${a.computed.formula_ref}'`);
      const ast = bindTemplate(tmpl, a.computed.bindings, resolve);
      return { abatementKt: evalAst(ast, resolve) };
    }
    case 'back_calc': {
      if (!a.back_calc) throw new Error(`Measure '${measure.id}': maturity=back_calc but no back_calc block`);
      const abatementKt = poolBaselineKt(measure, library) * a.back_calc.share;
      const qty = a.back_calc.activity_scalar.qty;
      return { abatementKt, impliedFactor: qty ? abatementKt / qty : undefined };
    }
    case 'raw': {
      if (!a.raw) throw new Error(`Measure '${measure.id}': maturity=raw but no raw block`);
      return { abatementKt: poolBaselineKt(measure, library) * a.raw.share };
    }
    // Total by construction: an unknown/absent maturity_stage with no inline formula
    // gets a descriptive error (never `undefined`), so the caller's destructure can't
    // crash — the tools surface this as an advisory message, not a hard failure.
    default:
      throw new Error(
        `Measure '${measure.id}': cannot derive abatement — provide an inline 'abatement.formula' or a valid stage block (maturity_stage='${String(measure.maturity_stage)}')`,
      );
  }
}

function resolveDuration(measure: Measure, library: Library): number {
  const tech = measure.technology_ref ? library.technologies[measure.technology_ref] : undefined;
  const dur = tech?.lifetimeYrs ?? measure.inputs?.lifetime?.value;
  if (dur == null) throw new Error(`Measure '${measure.id}': cannot resolve duration (technology.lifetimeYrs or inputs.lifetime)`);
  return dur;
}

/** Compute a measure's plottable outputs from its inputs + the library. */
export function compute(measure: Measure, library: Library): ComputedMeasure {
  const resolve = makeResolver(measure, library);
  const { abatementKt, impliedFactor } = computeAbatement(measure, library, resolve);
  const { capex, opex } = economicsRollup(measure, library);
  const durationYrs = resolveDuration(measure, library);
  const { npv, discCo2Kt, mac } = economicCore({
    capex,
    opex,
    abatementKt,
    durationYrs,
    discountRate: library.globals.discountRate,
  });
  return {
    id: measure.id,
    sector: measure.sector_ref,
    name: measure.name,
    maturity: measure.maturity_stage,
    capex,
    opex,
    durationYrs,
    abatementKt,
    npv,
    discCo2Kt,
    mac,
    impliedFactor,
  };
}
