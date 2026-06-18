// §3 — compile an AST to a HyperFormula formula string, evaluate it, and render it
// in human-readable form.
//
// We reuse HyperFormula (already in the stack via `src/lib/calc/engine.ts`) rather
// than writing a bespoke interpreter: every measure formula — the §0 economic core
// (PV-based NPV/MAC) AND the stored guardrail predicates (validate()) — is
// evaluated by the same engine that reproduces the Excel cached values, so
// `etl.py --check` parity is a proof the AST translation lost nothing (§10).
// Constants are inlined, so each eval is a self-contained single-cell workbook.
import { HyperFormula } from 'hyperformula';
import {
  type Ast,
  type AstOp,
  isLeafConst,
  isLeafRef,
  isLeafSlot,
  isNode,
} from './ast';

/** Resolves a named `{ref}` leaf to a number (measure input / resource property). */
export type RefResolver = (key: string) => number;

const BINARY: Partial<Record<AstOp, string>> = {
  add: '+', sub: '-', mul: '*', div: '/', lte: '<=', gte: '>=',
};

/**
 * Lower an AST to a HyperFormula formula body (no leading `=`). All `{ref}` leaves
 * are resolved to numeric literals via `resolve`; `{slot}` leaves must already be
 * bound (see `bindTemplate`) — an unbound slot is a programming error.
 */
export function compileAst(ast: Ast, resolve: RefResolver): string {
  if (typeof ast === 'number') return fmt(ast);
  if (isLeafConst(ast)) return fmt(ast.const);
  if (isLeafRef(ast)) return fmt(resolve(ast.ref));
  if (isLeafSlot(ast)) {
    throw new Error(`Unbound template slot '${ast.slot}' — bind it before compiling`);
  }
  if (isNode(ast)) {
    const parts = ast.args.map((a) => compileAst(a, resolve));
    if (ast.op in BINARY) return `(${parts.join(BINARY[ast.op])})`;
    if (ast.op === 'sum') return `SUM(${parts.join(',')})`;
    if (ast.op === 'pv') return `PV(${parts.join(',')})`;
    if (ast.op === 'between') return `AND(${parts[0]}>=${parts[1]},${parts[0]}<=${parts[2]})`;
    // LOOKUP (=INDEX/MATCH) is in the §3 whitelist but unused by the prototype.
    throw new Error(`Operator '${ast.op}' not supported by the prototype compiler`);
  }
  throw new Error(`Unrecognized AST node: ${JSON.stringify(ast)}`);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Non-finite value in formula: ${n}`);
  // High precision so HF rounding matches the Excel engine bit-for-bit.
  return Number.isInteger(n) ? String(n) : n.toPrecision(15);
}

/**
 * Evaluate a HyperFormula formula body (e.g. `"5000*8760*0.5*(1-0.45)*0.001"`).
 * A fresh single-cell workbook per call keeps evaluation isolated and stateless.
 */
export function evalFormula(body: string): number {
  const hf = HyperFormula.buildFromArray([[`=${body}`]], { licenseKey: 'gpl-v3' });
  try {
    const v = hf.getCellValue({ sheet: 0, col: 0, row: 0 });
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Formula did not evaluate to a finite number: =${body} → ${JSON.stringify(v)}`);
    }
    return v;
  } finally {
    hf.destroy();
  }
}

/** Compile and evaluate a numeric AST in one step. */
export function evalAst(ast: Ast, resolve: RefResolver): number {
  return evalFormula(compileAst(ast, resolve));
}

/** Compile and evaluate a predicate AST (lte/gte/between) to a boolean. */
export function evalPredicate(ast: Ast, resolve: RefResolver): boolean {
  return evalFormula(`IF(${compileAst(ast, resolve)},1,0)`) === 1;
}

/**
 * §0 economic core, evaluated through HyperFormula's PV so it is identical to the
 * Excel path: `NPV = CAPEX − PV(rate, term, OPEX)`,
 * `discCO2 = −PV(rate, term, abatement)`, `MAC = NPV / discCO2 × 1000`.
 */
export function economicCore(args: {
  capex: number;
  opex: number; // signed mUSD/yr
  abatementKt: number; // kt CO2eq/yr
  durationYrs: number;
  discountRate: number;
}): { npv: number; discCo2Kt: number; mac: number } {
  const { capex, opex, abatementKt, durationYrs: n, discountRate: r } = args;
  const npv = evalFormula(`${fmt(capex)}-PV(${fmt(r)},${fmt(n)},${fmt(opex)})`);
  const discCo2Kt = evalFormula(`-PV(${fmt(r)},${fmt(n)},${fmt(abatementKt)})`);
  const mac = discCo2Kt === 0 ? 0 : (npv / discCo2Kt) * 1000;
  return { npv, discCo2Kt, mac };
}

// ── human-readable rendering ──────────────────────────────────────────────────

const SYMBOL: Partial<Record<AstOp, string>> = {
  add: ' + ', sub: ' − ', mul: ' × ', div: ' / ', lte: ' ≤ ', gte: ' ≥ ',
};

/**
 * Render an AST as a human formula. `label(key)` names a `{ref}`/`{slot}` leaf —
 * e.g. it can return "мощность" or "мощность (5000)" to inline values. This is how
 * the UI shows the reduction formula and the guardrail checks in plain language
 * (the formula itself lives as data — the AST — per §3).
 */
export function renderAst(ast: Ast, label: (key: string) => string): string {
  const walk = (a: Ast): string => {
    if (typeof a === 'number') return numStr(a);
    if (isLeafConst(a)) return numStr(a.const);
    if (isLeafRef(a)) return label(a.ref);
    if (isLeafSlot(a)) return label(a.slot);
    if (isNode(a)) {
      const p = a.args.map(walk);
      if (a.op in SYMBOL) return `(${p.join(SYMBOL[a.op])})`;
      if (a.op === 'sum') return `Σ(${p.join(', ')})`;
      if (a.op === 'pv') return `PV(${p.join(', ')})`;
      if (a.op === 'between') return `${p[0]} ∈ [${p[1]}, ${p[2]}]`;
      return `${a.op}(${p.join(', ')})`;
    }
    return '?';
  };
  // Strip the outermost redundant parentheses for readability.
  return walk(ast).replace(/^\((.*)\)$/, '$1');
}

function numStr(n: number): string {
  if (n === 1e-3) return '10⁻³';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}
