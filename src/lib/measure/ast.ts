// §3 — formula storage as an AST over named keys, not Excel cell refs.
//
// «Formula is data, not code»: the raw→computed maturity step is a substitution
// of the abatement formula, so formulas must be stored, versioned and validated.
// Named keys (`ref`) survive row insertion — the fragility that broke Excel cell
// refs (`=C43*…`). The AST compiles back to HyperFormula (already in the stack),
// so no bespoke interpreter is needed and `etl.py --check` stays a bit-for-bit
// proof the translation lost nothing (§10). See `compile.ts`.
//
//   was (Excel):  =C43*8760*C39*(C37-C38)*10^-3
//   AST:          mul(ref:in_2_4, 8760, ref:in_2_2, sub(ref:ef_coal, ref:ef_gas), 1e-3)

/**
 * Whitelisted operators — kept small for auditability and HF-compilability (§3).
 * Arithmetic produces numbers; the comparison ops (`lte`/`gte`/`between`) produce
 * a predicate (0/1) and are used by the stored guardrail formulas (validate()).
 */
export type AstOp =
  | 'add' | 'sub' | 'mul' | 'div' | 'sum' | 'lookup' | 'pv'
  | 'lte' | 'gte' | 'between';

export const AST_OPS: readonly AstOp[] = [
  'add', 'sub', 'mul', 'div', 'sum', 'lookup', 'pv', 'lte', 'gte', 'between',
];

/** Comparison operators: their result is a predicate (true/false), not a number. */
export const PREDICATE_OPS: readonly AstOp[] = ['lte', 'gte', 'between'];

/** A leaf: a named key, a template slot, or a literal constant. */
export type AstLeaf =
  | { ref: string } // resolved from measure inputs / resource props / library
  | { slot: string } // template slot, bound per measure (§3)
  | { const: number };

/** An internal node: an operator applied to operands (leaves or nodes). */
export interface AstNode {
  op: AstOp;
  args: Ast[];
}

/** An expression tree. */
export type Ast = AstLeaf | AstNode | number;

export function isLeafRef(a: Ast): a is { ref: string } {
  return typeof a === 'object' && a !== null && 'ref' in a;
}
export function isLeafSlot(a: Ast): a is { slot: string } {
  return typeof a === 'object' && a !== null && 'slot' in a;
}
export function isLeafConst(a: Ast): a is { const: number } {
  return typeof a === 'object' && a !== null && 'const' in a;
}
export function isNode(a: Ast): a is AstNode {
  return typeof a === 'object' && a !== null && 'op' in a;
}
