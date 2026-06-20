// L3 slice 2+3 — dimensional + carrier check of a measure's abatement formula.
//
// Slice 2 (algebra): fold the abatement AST bottom-up over the slice-1 vocabulary
// (`dimensions.ts`) — each leaf gets a Dimension (input → by its `unit`, `res:<id>#ef`
// → EF, a literal → scalar), `mul`/`div` multiply/divide dimensions, `add`/`sub`/`sum`
// require their operands to agree, and the whole tree MUST reduce to CO₂ per year
// (mass_co2·time⁻¹) — or CO₂ (mass_co2) when the time integration sits inside.
//
// Slice 3 (carrier): tag the energy/EF quantities with the RESOURCE they belong to,
// taken from the ref itself (`res:R#ef` → carrier R; never a new per-input field). Two
// locks the bare units cannot see:
//   • carrier mismatch — multiplying a quantity of resource R by an EF of R'≠R is the
//     kz-27 class of error (electric EF on a thermal chain). The carrier is dropped once
//     a term becomes CO₂ (CO₂ is CO₂ regardless of fuel), so a fuel switch's
//     `EF_coal − EF_gas` is NOT flagged — only a `mul` that crosses carriers is.
//   • output-EF product — a coarse output-EF carried via `prd:<id>#carbon_footprint`
//     is stated per unit of an output product; its product's service-unit MUST match the
//     measure's product (kz-27: an MWh-electricity EF on a Гкал-heat measure → mismatch).
//
// `validate()` gates a measure to draft on any non-`ok` verdict (reduction panel goes
// incomplete). On the real 26 the carrier locks are inert (energy terms carry no carrier
// and no measure mixes carriers in a product) — a flip is a real finding to triage.
import { type Ast, isLeafConst, isLeafRef, isNode } from './ast';
import {
  type Dimension,
  lookupUnit,
  mulDim,
  divDim,
  dimEqual,
} from './dimensions';
import { getTemplate, bindTemplateSymbolic } from './templates';
import type { IndicatorOwnerKind, Library, Measure } from './schema';

/** Abatement is a CO₂ flow per year; either explicit (rate) or already time-integrated (stock). */
const CO2_RATE: Dimension = { mass_co2: 1, time: -1 };
const CO2_STOCK: Dimension = { mass_co2: 1 };
const isCO2 = (d: Dimension) => dimEqual(d, CO2_RATE) || dimEqual(d, CO2_STOCK);

export type DimensionStatus = 'ok' | 'warn' | 'na';

export interface DimensionResult {
  /** `na` — the measure has no foldable formula (raw share); nothing to check. */
  status: DimensionStatus;
  /** The reduced dimension of the abatement formula (null when it could not be folded). */
  dim: Dimension | null;
  /** Human-readable reasons a non-`ok` verdict was reached (gate messages). */
  issues: string[];
}

/** A dimension tagged with the resource carrier it belongs to (fuel-energy / EF / LHV). */
interface Tagged {
  dim: Dimension;
  /** Resource id this quantity is bound to, taken from a `res:<id>` ref. Dropped once it is CO₂. */
  carrier?: string;
}

/** Thrown mid-fold to abort with a precise reason; caught by `dimensionCheck`. */
class DimensionError extends Error {}

/** Mutable walk context: collects carrier/output-EF findings as the tree is folded. */
interface Ctx {
  measure: Measure;
  library: Library;
  issues: string[];
  /** Products of any coarse output-EF (`prd:<id>#carbon_footprint`) used in the formula. */
  outputEfProducts: Set<string>;
}

const INDICATOR_PREFIX: Record<string, IndicatorOwnerKind> = {
  res: 'resource', obj: 'object', prd: 'product', sub: 'subsector',
};

/** Render a dimension as `mass_co2·time⁻¹` for messages. */
function fmtDim(d: Dimension): string {
  const sup = (n: number) =>
    String(n).replace(/-/g, '⁻').replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]);
  const parts = Object.entries(d).filter(([, v]) => v).map(([k, v]) => (v === 1 ? k : `${k}${sup(v)}`));
  return parts.length ? parts.join('·') : 'scalar';
}

/** Resolve one library/measure unit string to a dimension, or fail with a reason. */
function dimOfUnit(unit: string | undefined, ref: string): Dimension {
  if (!unit) throw new DimensionError(`'${ref}' has no unit`);
  const info = lookupUnit(unit);
  if (!info) throw new DimensionError(`unknown unit '${unit}' on '${ref}'`);
  return info.dim;
}

/** Tagged dimension of a `{ref}` leaf — mirrors compute.makeResolver's namespace. */
function dimOfRef(ref: string, ctx: Ctx): Tagged {
  const { measure, library } = ctx;
  const m = ref.match(/^([a-z]+):(.+)$/);
  if (m) {
    const [, prefix, rest] = m;
    if (prefix === 'glb') return { dim: {} }; // globals (discountRate, year) are scalar
    if (prefix === 'in') return { dim: dimOfBareKey(rest, ctx, ref) };
    const owner_kind = INDICATOR_PREFIX[prefix];
    if (owner_kind) {
      const hashAt = rest.indexOf('#');
      const id = hashAt >= 0 ? rest.slice(0, hashAt) : rest;
      const key = hashAt >= 0 ? rest.slice(hashAt + 1) : undefined;
      // res:<id> ≡ res:<id>#ef — the fuel EF shortcut; the resource id IS the carrier.
      if (prefix === 'res' && (key === undefined || key === 'ef')) {
        const ind = library.indicators.find((i) => i.owner_kind === 'resource' && i.owner_ref === id && i.key === 'ef');
        return { dim: ind?.unit ? dimOfUnit(ind.unit, ref) : { mass_co2: 1, energy: -1 }, carrier: id };
      }
      const ind = library.indicators.find(
        (i) => i.owner_kind === owner_kind && i.owner_ref === id && i.key === key,
      );
      if (!ind) throw new DimensionError(`indicator '${ref}' absent from library.indicators`);
      // A coarse output-EF (product carbon footprint) is stated per the product's service
      // unit — record it so Lock 2 can check that product against the measure's product.
      if (prefix === 'prd' && key === 'carbon_footprint') ctx.outputEfProducts.add(id);
      // Other resource indicators (lhv, …) carry the resource as their carrier too.
      const carrier = prefix === 'res' ? id : undefined;
      return { dim: dimOfUnit(ind.unit, ref), carrier };
    }
    // Unknown prefix — fall through to the bare-key path.
  }
  return { dim: dimOfBareKey(ref, ctx, ref) };
}

/** A bare measure key: a recursive `computed` formula, else an `inputs` value's unit (carrier-less). */
function dimOfBareKey(key: string, ctx: Ctx, ref: string): Dimension {
  const computed = ctx.measure.computed?.[key];
  if (computed) return fold(computed.formula, ctx).dim;
  const input = ctx.measure.inputs?.[key];
  if (!input) throw new DimensionError(`'${ref}' resolves to no input/computed on measure '${ctx.measure.id}'`);
  return dimOfUnit(input.unit, `input '${key}'`);
}

/** Fold an AST to a tagged dimension. `add`/`sub`/`sum` require agreement; `mul` locks carriers. */
function fold(ast: Ast, ctx: Ctx): Tagged {
  if (typeof ast === 'number' || isLeafConst(ast)) return { dim: {} }; // scalar / conversion factor
  if (isLeafRef(ast)) return dimOfRef(ast.ref, ctx);
  if (isNode(ast)) {
    const kids = ast.args.map((a) => fold(a, ctx));
    switch (ast.op) {
      case 'mul': {
        const dim = kids.reduce((acc, k) => mulDim(acc, k.dim), {} as Dimension);
        // Carrier lock: a product may not cross two distinct resource carriers (e.g. coal
        // energy × gas EF). Carriers on already-CO₂ operands are irrelevant and ignored.
        const carriers = [...new Set(kids.filter((k) => k.carrier && !isCO2(k.dim)).map((k) => k.carrier!))];
        if (carriers.length > 1) {
          ctx.issues.push(`carrier mismatch in product: ${carriers.join(' × ')} (an EF must match the resource it multiplies)`);
        }
        // Drop the carrier once the product is CO₂ — CO₂ is CO₂ regardless of the fuel.
        return { dim, carrier: isCO2(dim) ? undefined : carriers[0] };
      }
      case 'div': {
        const dim = kids.slice(1).reduce((acc, k) => divDim(acc, k.dim), kids[0].dim);
        return { dim, carrier: isCO2(dim) ? undefined : kids[0].carrier };
      }
      case 'add': case 'sub': case 'sum': {
        for (const k of kids.slice(1)) {
          if (!dimEqual(k.dim, kids[0].dim)) {
            throw new DimensionError(`${ast.op} of incompatible dimensions ${fmtDim(kids[0].dim)} vs ${fmtDim(k.dim)}`);
          }
        }
        // No carrier enforcement on +/−: a fuel switch legitimately subtracts EF_coal − EF_gas.
        // The result keeps a carrier only if every operand agreed on it.
        const carriers = new Set(kids.map((k) => k.carrier));
        return { dim: kids[0].dim, carrier: carriers.size === 1 ? kids[0].carrier : undefined };
      }
      case 'pv': return kids[2] ?? { dim: {} }; // present value carries the payment's dimension
      default: return { dim: {} }; // predicates / lookup — scalar, not used in abatement
    }
  }
  throw new DimensionError(`unrecognized AST node ${JSON.stringify(ast)}`);
}

/** Lock 2 — a coarse output-EF's product service-unit must match the measure's product. */
function checkOutputEfProducts(ctx: Ctx): void {
  const myRef = ctx.measure.product_ref;
  const myUnit = myRef ? ctx.library.products[myRef]?.service_unit : undefined;
  for (const p of ctx.outputEfProducts) {
    const efUnit = ctx.library.products[p]?.service_unit;
    if (myUnit && efUnit && efUnit !== myUnit) {
      ctx.issues.push(
        `output-EF is per '${efUnit}' (product '${p}') but the measure's product is per '${myUnit}' — `
          + `an EF stated per a different product cannot price this measure's abatement`,
      );
    }
  }
}

/**
 * Dimensionally + carrier-check a measure's abatement formula. Returns `na` for a
 * raw-share measure (no foldable AST), `ok` when the formula reduces to CO₂/year with
 * consistent carriers, and `warn` with reasons otherwise — a missing/unknown unit, an
 * `add`/`sub` mismatch, a final dimension that is not CO₂, a cross-carrier product, or an
 * output-EF priced per the wrong product.
 */
export function dimensionCheck(measure: Measure, library: Library): DimensionResult {
  const a = measure.abatement;
  let ast: Ast;
  if (a?.formula) {
    ast = a.formula;
  } else if (a?.computed) {
    const template = getTemplate(a.computed.formula_ref);
    if (!template) {
      return { status: 'warn', dim: null, issues: [`unknown formula template '${a.computed.formula_ref}'`] };
    }
    ast = bindTemplateSymbolic(template, a.computed.bindings);
  } else {
    return { status: 'na', dim: null, issues: [] }; // raw share / no formula — nothing to fold
  }

  const ctx: Ctx = { measure, library, issues: [], outputEfProducts: new Set() };
  let dim: Dimension;
  try {
    dim = fold(ast, ctx).dim;
  } catch (e) {
    return { status: 'warn', dim: null, issues: [(e as Error).message] };
  }
  checkOutputEfProducts(ctx);
  if (!isCO2(dim)) {
    ctx.issues.push(`abatement reduces to ${fmtDim(dim)}, expected CO₂/year (mass_co2·time⁻¹)`);
  }
  return { status: ctx.issues.length ? 'warn' : 'ok', dim, issues: ctx.issues };
}
