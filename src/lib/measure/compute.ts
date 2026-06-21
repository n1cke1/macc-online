// §0/§5 — turn a `Measure` into a plottable result.
//
// One economic core (§0) for every maturity stage; abatement is derived per stage
// (§5): `raw` = baseline × share, `computed` = an inline AST / formula template
// evaluated through HyperFormula (§3). The output mirrors `MaccPoint` field names
// (`data/schema.ts`) so the chart/drilldown can render a measure as one more bar.
import type { CostItem, Localized, LocalInput, PhysicalItem, SectorCode } from '@data/schema';
import { economicCore, evalAst, type RefResolver } from './eval';
import { bindTemplate, getTemplate } from './templates';
import { economicsRollup } from './guardrails';
import type { IndicatorOwnerKind, Library, Measure, NumberOrRef } from './schema';

/** §C — turn a `NumberOrRef` into a number, resolving `{ref}` through `resolve`. */
export const isRef = (v: NumberOrRef | undefined): v is { ref: string } =>
  typeof v === 'object' && v !== null && typeof (v as { ref?: unknown }).ref === 'string';

export function unboxNumber(v: NumberOrRef | undefined, resolve: RefResolver): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (isRef(v)) return resolve(v.ref);
  return undefined;
}

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
  /** §7 X-axis — the per-unit abatement factor the measure asserts (the `factor_ref`
   *  input), compared to a reference corridor. Present only when `abatement.factor_ref` is set. */
  impliedFactor?: number;
  /** Drill-down breakdown — `MaccPoint`-compatible. Derived from the §2 composition
   *  (created/retired technologies, materials, inputs) via `buildBreakdown`; the capex/opex
   *  item sums equal `capex`/`opex` by construction (same `pick()` logic as economicsRollup). */
  capexItems?: CostItem[];
  opexItems?: CostItem[];
  physicalItems?: PhysicalItem[];
  localInputs?: LocalInput[];
}

/**
 * Resolve a `{ref}` key. Phase-B syntax:
 *   • `res:<id>`            — resource EF (shortcut for `res:<id>#ef`, honors year-series EFs)
 *   • `res:<id>#<key>`      — resource indicator (price, lhv, comb_factor, …)
 *   • `obj:<id>#<key>`      — object/technology indicator (capex_ud, eff, maintenance_capex_ud, …)
 *   • `prd:<id>#<key>`      — product indicator (carbon_footprint, …)
 *   • `sub:<id>#<key>`      — subsector indicator (max_emissions, max_capacity, …)
 *   • `glb:<key>`           — `library.globals[<key>]` (discountRate, year, …)
 *   • `in:<key>`            — measure input value (explicit form of the bare key below)
 *   • bare `<key>`          — either `measure.computed[<key>]` (recurses) or `measure.inputs[<key>]`
 *
 * Indicator lookup hits `library.indicators` (the §1 hub). Unknown prefix falls
 * through to the bare-key path so legacy refs keep working.
 */
const INDICATOR_PREFIX: Record<string, IndicatorOwnerKind> = {
  res: 'resource', obj: 'object', prd: 'product', sub: 'subsector',
};

export function makeResolver(measure: Measure, library: Library): RefResolver {
  const resolve: RefResolver = (key: string): number => {
    const m = key.match(/^([a-z]+):(.+)$/);
    if (m) {
      const [, prefix, rest] = m;
      if (prefix === 'glb') {
        const v = (library.globals as unknown as Record<string, unknown>)[rest];
        if (typeof v !== 'number') throw new Error(`unresolved ref '${key}': library.globals.${rest} is not a number`);
        return v;
      }
      if (prefix === 'in') {
        const inp = measure.inputs?.[rest];
        if (!inp) throw new Error(`unresolved ref '${key}': measure '${measure.id}' has no input '${rest}'`);
        return inp.value;
      }
      const owner_kind = INDICATOR_PREFIX[prefix];
      if (owner_kind) {
        const hashAt = rest.indexOf('#');
        const id = hashAt >= 0 ? rest.slice(0, hashAt) : rest;
        const indKey = hashAt >= 0 ? rest.slice(hashAt + 1) : undefined;
        // res:<id> ≡ res:<id>#ef — keeps the year-series fast path the engine relied on.
        if (prefix === 'res' && (indKey === undefined || indKey === 'ef')) {
          const r = library.resources[id];
          if (!r) throw new Error(`unresolved ref '${key}': resource '${id}' not in library (registry not hydrated?)`);
          const ef = typeof r.ef === 'number' ? r.ef : r.ef[library.globals.year ?? ''];
          if (typeof ef !== 'number') throw new Error(`unresolved ref '${key}': resource '${id}' has no scalar EF for the active year`);
          return ef;
        }
        if (indKey === undefined) {
          throw new Error(`unresolved ref '${key}': '${prefix}:' refs require '#<indicator-key>' (e.g. '${prefix}:${id}#capex_ud')`);
        }
        const ind = library.indicators.find(
          (i) => i.owner_kind === owner_kind && i.owner_ref === id && i.key === indKey,
        );
        if (!ind) throw new Error(`unresolved ref '${key}': indicator (owner_kind=${owner_kind}, owner_ref='${id}', key='${indKey}') absent from library.indicators`);
        return ind.value;
      }
      // Unknown prefix — fall through.
    }
    const c = measure.computed?.[key];
    if (c) return evalAst(c.formula, resolve);
    const inp = measure.inputs?.[key];
    if (!inp) throw new Error(`unresolved ref '${key}': not a known prefix and measure '${measure.id}' has no input/computed '${key}'`);
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
  if (!a) throw new Error(`Measure '${measure.id}': no 'abatement' block (provide abatement.formula, .computed or .raw)`);
  // §7 X-axis — the per-unit factor the measure asserts (abatement ÷ activity), surfaced
  // for the corridor check + UI. It is the value of the input named by `abatement.factor_ref`.
  const impliedFactor = a.factor_ref ? measure.inputs?.[a.factor_ref]?.value : undefined;
  // §3/§10 — an inline abatement AST wins over the maturity-stage block. It ports the
  // Excel «Расчёты» formula directly (physics or activity×factor), evaluated by eval.ts.
  if (a.formula) {
    return { abatementKt: evalAst(a.formula, resolve), impliedFactor };
  }
  switch (measure.maturity_stage) {
    case 'computed': {
      if (!a.computed) throw new Error(`Measure '${measure.id}': maturity=computed but no computed block`);
      const tmpl = getTemplate(a.computed.formula_ref);
      if (!tmpl) throw new Error(`Unknown formula template '${a.computed.formula_ref}'`);
      const ast = bindTemplate(tmpl, a.computed.bindings, resolve);
      return { abatementKt: evalAst(ast, resolve), impliedFactor };
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

/**
 * Per-statement drill-down breakdown, mirroring `economicsRollup`'s `pick()` logic so
 * the capex/opex item sums equal the scalar `capex`/`opex` by construction. Each line's
 * `cell` carries the §6 provenance pointer (technology/resource id or `in:<key>`) in place
 * of the Excel cell the old ETL used. Empty for un-composed (legacy) measures.
 */
function buildBreakdown(
  measure: Measure,
  library: Library,
  resolve: RefResolver,
): Pick<ComputedMeasure, 'capexItems' | 'opexItems' | 'physicalItems' | 'localInputs'> {
  const created = measure.created_technologies ?? [];
  const retired = measure.retired_technologies ?? [];
  const materials = measure.materials ?? [];

  const tech = (ref: string) => library.technologies[ref];
  const pick = (path: string, inline?: NumberOrRef): number | undefined => {
    const c = measure.computed?.[path];
    if (c) return evalAst(c.formula, resolve);
    return unboxNumber(inline, resolve);
  };
  const techName = (ref: string): Localized => library.technologies[ref]?.name ?? { ru: ref, en: ref };
  const resName = (ref: string): Localized => library.resources[ref]?.name ?? { ru: ref, en: ref };

  const capexItems: CostItem[] = [];
  const opexItems: CostItem[] = [];
  const physicalItems: PhysicalItem[] = [];

  created.forEach((o, i) => {
    const capacity = pick(`created_technologies[${i}].capacity`, o.capacity);
    const capex = pick(`created_technologies[${i}].capex_musd`, o.capex_musd)
      ?? (capacity ?? 0) * (tech(o.technology_ref)?.capex_ud ?? 0) * (unboxNumber(o.capex_ud_factor, resolve) ?? 1) / 1e6;
    if (capex) capexItems.push({ label: techName(o.technology_ref), value: capex, cell: o.technology_ref });
    const opex = pick(`created_technologies[${i}].opex_musd`, o.opex_musd);
    if (opex) opexItems.push({ label: techName(o.technology_ref), value: opex, cell: o.technology_ref });
    if (capacity != null) {
      physicalItems.push({ label: techName(o.technology_ref), value: capacity, unit: o.unit ?? tech(o.technology_ref)?.capex_ud_unit ?? '', cell: o.technology_ref });
    }
  });

  retired.forEach((r, i) => {
    const capacity = pick(`retired_technologies[${i}].capacity`, r.capacity);
    const maint = pick(`retired_technologies[${i}].maintenance_capex_musd`, r.maintenance_capex_musd)
      ?? (capacity ?? 0) * (tech(r.technology_ref)?.maintenance_capex_ud ?? 0) * (unboxNumber(r.capex_ud_factor, resolve) ?? 1) / 1e6;
    if (maint) capexItems.push({ label: techName(r.technology_ref), value: -maint, cell: r.technology_ref });
    const opex = pick(`retired_technologies[${i}].opex_musd`, r.opex_musd);
    if (opex) opexItems.push({ label: techName(r.technology_ref), value: -opex, cell: r.technology_ref });
    if (capacity != null) {
      physicalItems.push({ label: techName(r.technology_ref), value: capacity, unit: r.unit ?? '', cell: r.technology_ref });
    }
  });

  materials.forEach((m, i) => {
    const explicit = unboxNumber(m.cost_musd, resolve);
    const qty = pick(`materials[${i}].qty`, m.qty);
    const price = pick(`materials[${i}].price`, m.price);
    const cost = explicit ?? (qty ?? 0) * (price ?? 0) / 1e6;
    const signed = m.side === 'retired' ? -cost : cost;
    if (signed) opexItems.push({ label: resName(m.resource_ref), value: signed, cell: m.resource_ref });
    if (qty != null) {
      physicalItems.push({ label: resName(m.resource_ref), value: qty, unit: m.unit ?? library.resources[m.resource_ref]?.unit ?? '', cell: m.resource_ref });
    }
  });

  const localInputs: LocalInput[] = Object.entries(measure.inputs ?? {}).map(([key, inp]) => ({
    label: { ru: key, en: key },
    value: inp.value,
    unit: inp.unit ?? '',
    source: inp.provenance?.citation ?? '',
    // Measure-scoped so the in-memory override store (keyed by `cell`) never collides
    // when two measures share an input name (e.g. `lifetime`). measure-recalc parses
    // `in:<measureId>#<key>` back to that measure's input.
    cell: `in:${measure.id}#${key}`,
  }));

  return { capexItems, opexItems, physicalItems, localInputs };
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
    ...buildBreakdown(measure, library, resolve),
  };
}
