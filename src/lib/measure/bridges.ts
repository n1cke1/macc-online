// L3 slice 4 — the bridge registry + composition.
//
// A bridge is a typed unit conversion: a `from` quantity (dimension + optional resource
// carrier `$R`) plus `via` multipliers (indicators with their own dimensions) producing a
// `to` quantity, carrying a slot-AST that compiles to the SAME arithmetic the engine
// already runs. Bridges are indexed by their endpoints so an author can grow a formula by
// unit ("I have mass, I need energy" → `fuel_to_energy`); the dimensional check
// (`dimension-check.ts`) folds the result and the carrier lock guards resource identity.
//
// The engine is unchanged: `composeBridges` reassembles the existing `delta_ef` AST exactly
// (parity-exact, pinned by measure-golden §11) — what changes is the way a formula is
// ENTERED and verified, not how it is evaluated.
import { type Ast, isNode, isLeafSlot } from './ast';
import type { Dimension } from './dimensions';

// Named dimensions, aligned with the vectors in `dimensions.ts` (power & EF are derived).
const POWER: Dimension = { energy: 1, time: -1 };
const ENERGY: Dimension = { energy: 1 };
const MASS: Dimension = { mass: 1 };
const TIME: Dimension = { time: 1 };
const SCALAR: Dimension = {};
const EF: Dimension = { mass_co2: 1, energy: -1 };
const LHV: Dimension = { energy: 1, mass: -1 };
const CO2: Dimension = { mass_co2: 1 };

/** A bridge endpoint: a dimension plus an optional resource carrier. `$R` = resource-parametric. */
export interface BridgeEndpoint {
  dim: Dimension;
  /** Resource the quantity belongs to. `$R`/`$R_old`/`$R_new` are parameters bound per use. */
  carrier?: string;
}

/** A `via` multiplier — an indicator pulled from the registry, with its dimension. */
export interface BridgeVia {
  name: string;
  dim: Dimension;
  /** The library indicator this multiplier comes from (e.g. `res:$R#lhv`); absent for a free input. */
  indicator?: string;
}

/**
 * A bridge: `from` × Π(`via`) = `to`, with `expr` an AST over the slot names (`from` plus
 * each `via.name`). `carrier_rule` states the resource-identity constraint the carrier lock
 * enforces; `authoring` is the plain-language hint surfaced to an author.
 */
export interface Bridge {
  id: string;
  from: BridgeEndpoint;
  via: BridgeVia[];
  to: BridgeEndpoint;
  expr: Ast;
  carrier_rule?: string;
  authoring: string;
}

/** Atomic bridges — the irreducible conversions every composite is built from. */
export const ATOMIC_BRIDGES: Record<string, Bridge> = {
  // installed power × hours/yr × capacity factor = annual energy of the same resource.
  power_to_energy: {
    id: 'power_to_energy',
    from: { dim: POWER, carrier: '$R' },
    via: [
      { name: 'hours', dim: TIME },
      { name: 'cf', dim: SCALAR },
    ],
    to: { dim: ENERGY, carrier: '$R' },
    expr: { op: 'mul', args: [{ slot: 'from' }, { slot: 'hours' }, { slot: 'cf' }] },
    authoring: 'Установленная мощность × часы в году × КИУМ = годовая выработка энергии того же ресурса.',
  },
  // mass of fuel × its LHV = energy content of that fuel (carries the fuel as its resource).
  fuel_to_energy: {
    id: 'fuel_to_energy',
    from: { dim: MASS, carrier: '$R' },
    via: [{ name: 'lhv', dim: LHV, indicator: 'res:$R#lhv' }],
    to: { dim: ENERGY, carrier: '$R' },
    expr: { op: 'mul', args: [{ slot: 'from' }, { slot: 'lhv' }] },
    carrier_rule: 'lhv ОБЯЗАН быть res:$R#lhv — LHV того же ресурса, что и масса топлива.',
    authoring: 'Масса топлива × его теплотворность (LHV) = энергосодержание; LHV берётся из реестра ресурса.',
  },
  // energy of resource R × EF of R = CO₂. The carrier lock forbids an EF of a different resource.
  energy_to_co2: {
    id: 'energy_to_co2',
    from: { dim: ENERGY, carrier: '$R' },
    via: [{ name: 'ef', dim: EF, indicator: 'res:$R#ef' }],
    to: { dim: CO2 },
    expr: { op: 'mul', args: [{ slot: 'from' }, { slot: 'ef' }] },
    carrier_rule: 'ef ОБЯЗАН быть res:$R#ef — тот же носитель R, что у энергии (иначе ошибка класса kz-27).',
    authoring: 'Энергия ресурса R × EF ТОГО ЖЕ R = CO₂. Взять EF другого ресурса — это ошибка носителя.',
  },
};

/** Composite bridges — assembled from atomics; the engine's `delta_ef`/`share` shapes. */
export const COMPOSITE_BRIDGES: Record<string, Bridge> = {
  // fuel switch: energy of the displaced fuel × (its EF − the new fuel's EF) = avoided CO₂.
  fuel_switch_abatement: {
    id: 'fuel_switch_abatement',
    from: { dim: ENERGY, carrier: '$R_old' },
    via: [
      { name: 'ef_old', dim: EF, indicator: 'res:$R_old#ef' },
      { name: 'ef_new', dim: EF, indicator: 'res:$R_new#ef' },
    ],
    to: { dim: CO2 },
    expr: {
      op: 'mul',
      args: [{ slot: 'from' }, { op: 'sub', args: [{ slot: 'ef_old' }, { slot: 'ef_new' }] }],
    },
    carrier_rule: 'ef_old=res:$R_old#ef, ef_new=res:$R_new#ef; from — энергия R_old. Две цепочки своих ресурсов.',
    authoring: 'Снижение = энергия замещаемого топлива × (EF замещаемого − EF нового). Оба EF — своих ресурсов.',
  },
};

export const BRIDGES: Record<string, Bridge> = { ...ATOMIC_BRIDGES, ...COMPOSITE_BRIDGES };

export function getBridge(id: string): Bridge | undefined {
  return BRIDGES[id];
}

/** Substitute each `{slot}` in a bridge AST with the provided sub-AST (a leaf or a whole tree). */
export function substituteSlots(expr: Ast, bindings: Record<string, Ast>): Ast {
  if (isLeafSlot(expr)) {
    const v = bindings[expr.slot];
    if (v === undefined) throw new Error(`bridge composition: slot '${expr.slot}' is unbound`);
    return v;
  }
  if (isNode(expr)) return { op: expr.op, args: expr.args.map((a) => substituteSlots(a, bindings)) };
  return expr;
}

/**
 * Recompose the `delta_ef` abatement AST from bridges: `power_to_energy` feeds the energy
 * slot of `fuel_switch_abatement`, then a unit-scale factor (t→kt). The result evaluates
 * bit-for-bit to the `delta_ef` template — bridges change the input path, not the math.
 */
export function deltaEfFromBridges(leaves: {
  capacity: Ast; hours: Ast; cf: Ast; efIn: Ast; efOut: Ast; scale: Ast;
}): Ast {
  const energy = substituteSlots(ATOMIC_BRIDGES.power_to_energy.expr, {
    from: leaves.capacity, hours: leaves.hours, cf: leaves.cf,
  });
  const co2 = substituteSlots(COMPOSITE_BRIDGES.fuel_switch_abatement.expr, {
    from: energy, ef_old: leaves.efIn, ef_new: leaves.efOut,
  });
  return { op: 'mul', args: [co2, leaves.scale] };
}
