// §3 — pure-TS AST evaluation + economic core (NO HyperFormula).
//
// The measure calc path (compute/validate) runs here, not through HyperFormula. The
// AST whitelist is small (add sub mul div sum pv + comparisons) and the only
// non-trivial function — PV — is closed-form, so a tiny interpreter suffices.
// Dropping HF lets the SAME calc core run in a Deno/Edge serverless runtime (the
// hosted MCP, §9) and keeps HyperFormula out of the app bundle entirely.
//
// HyperFormula stays the PARITY ORACLE, not the runtime: `compile.ts` keeps the
// HF-backed twins of these functions, and `measure-golden` asserts this pure-TS path
// equals the HF path (which reproduces the Excel cached values bit-for-bit, §10).
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

/**
 * Excel PV with `fv=0, type=0` — the only form the model uses:
 *   PV(rate, nper, pmt) = -pmt · (1 − (1+rate)^(−nper)) / rate   (rate ≠ 0)
 *   PV(0,    nper, pmt) = -pmt · nper                            (rate = 0 guard)
 * Pinned equal to HyperFormula's PV by `measure-golden`.
 */
export function pv(rate: number, nper: number, pmt: number): number {
  if (rate === 0) return -pmt * nper;
  return (-pmt * (1 - Math.pow(1 + rate, -nper))) / rate;
}

/**
 * Evaluate a numeric AST. Comparison ops (`lte`/`gte`/`between`) yield 1/0 so they
 * compose inside arithmetic and feed `evalPredicate`. `{slot}` leaves must already be
 * bound (an unbound slot is a programming error); `lookup` is whitelisted but unused.
 */
export function evalAst(ast: Ast, resolve: RefResolver): number {
  if (typeof ast === 'number') return ast;
  if (isLeafConst(ast)) return ast.const;
  if (isLeafRef(ast)) return resolve(ast.ref);
  if (isLeafSlot(ast)) throw new Error(`Unbound slot '${ast.slot}' — bind it before evaluating`);
  if (isNode(ast)) {
    const a = ast.args.map((x) => evalAst(x, resolve));
    switch (ast.op) {
      case 'add': return a.reduce((s, x) => s + x, 0);
      case 'sub': return a.slice(1).reduce((s, x) => s - x, a[0]);
      case 'mul': return a.reduce((s, x) => s * x, 1);
      case 'div': return a.slice(1).reduce((s, x) => s / x, a[0]);
      case 'sum': return a.reduce((s, x) => s + x, 0);
      case 'pv': return pv(a[0], a[1], a[2]);
      case 'lte': return a[0] <= a[1] ? 1 : 0;
      case 'gte': return a[0] >= a[1] ? 1 : 0;
      case 'between': return a[0] >= a[1] && a[0] <= a[2] ? 1 : 0;
      default: throw new Error(`Operator '${ast.op as AstOp}' unsupported in the pure-TS evaluator`);
    }
  }
  throw new Error(`Unrecognized AST node: ${JSON.stringify(ast)}`);
}

/** Evaluate a predicate AST (lte/gte/between) to a boolean. */
export function evalPredicate(ast: Ast, resolve: RefResolver): boolean {
  return evalAst(ast, resolve) === 1;
}

/**
 * §0 economic core (pure TS): `NPV = CAPEX − PV(rate, term, OPEX)`,
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
  const npv = capex - pv(r, n, opex);
  const discCo2Kt = -pv(r, n, abatementKt);
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
