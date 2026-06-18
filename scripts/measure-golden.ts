// Parity + guardrail test for the new measure-authoring calc path (§11 slice).
// `npm run measure-golden` -> `tsx scripts/measure-golden.ts`. Exits non-zero on
// any failure so it can gate CI alongside the existing `golden` test.
//
// Proves three things:
//   1. The AST→HyperFormula path reproduces the Excel-derived MAC/abatement for the
//      two valid measures (A=kz-20 feed additives, B=kz-2 coal CHP→gas).
//   2. The broken measure (C=kz-16 mine degassing) trips the factor guardrail (⚠)
//      and stays draft — never auto-promoted to published.
//   3. Pool stacking clips potential by MAC order, independent of input order.
import baselineJson from '../data/kz/model.data.json';
import { library, getSeedMeasure, seedMeasures } from '../src/lib/measure/library';
import { compute, type ComputedMeasure } from '../src/lib/measure/compute';
import { validate, stackPools } from '../src/lib/measure/validate';
import { runGuardrails, abatementJs } from '../src/lib/measure/guardrails';
// HyperFormula twins — the parity oracle the shipped pure-TS core is pinned against.
import { economicCore as economicCoreHF } from '../src/lib/measure/compile';
import type { Measure } from '../src/lib/measure/schema';

interface ExcelRow { id: number; mac: number; abatementKt: number; capex: number; opex: number; durationYrs: number }
const excel = (baselineJson as unknown as { projects: ExcelRow[] }).projects;
const excelById = (id: number) => excel.find((p) => p.id === id)!;

// Relative tolerance for parity (floating-point + workbook rounding).
const REL_TOL = 1e-6;

interface Issue { where: string; detail: string }
const issues: Issue[] = [];
const log: string[] = [];

function near(label: string, where: string, actual: number, expected: number): void {
  const denom = Math.max(Math.abs(expected), 1e-9);
  const rel = Math.abs(actual - expected) / denom;
  const ok = rel <= REL_TOL;
  log.push(`  ${ok ? '✓' : '✗'} ${where} · ${label}: ${actual.toFixed(6)} vs Excel ${expected.toFixed(6)} (rel ${rel.toExponential(2)})`);
  if (!ok) issues.push({ where, detail: `${label}: got ${actual}, expected ${expected} (rel ${rel.toExponential(3)})` });
}

function expect(cond: boolean, where: string, detail: string): void {
  log.push(`  ${cond ? '✓' : '✗'} ${where} · ${detail}`);
  if (!cond) issues.push({ where, detail });
}

// ── 1. Parity for ALL 26 measures (full migration: every measure reproduces Excel) ─
for (const m of seedMeasures) {
  const excelId = Number(m.id.replace('kz-', ''));
  const c = compute(m, library);
  const e = excelById(excelId);
  near('abatementKt', m.id, c.abatementKt, e.abatementKt);
  near('mac', m.id, c.mac, e.mac);
  near('capex', m.id, c.capex, e.capex);
  near('opex', m.id, c.opex, e.opex);
}

// ── 1b. computeAbatement is TOTAL — a doc with no formula and no valid stage gives a
// descriptive error (naming the gap), never a `Cannot destructure 'abatementKt'` crash.
{
  const broken = { id: 'broken', schema_version: 1, name: { ru: '', en: '' }, sector_ref: '1.A.1',
    scope: 'draft', maturity_stage: 'bogus', abatement: {} } as unknown as Measure;
  let msg = '';
  try { compute(broken, library); } catch (e) { msg = (e as Error).message; }
  expect(/cannot derive abatement/i.test(msg) && !/destructure/i.test(msg), 'robustness',
    `malformed measure → descriptive error, not a destructure crash (got: ${msg || 'no throw'})`);
}

// ── 2. Guardrails: A ✓ in corridor & eligible; C ⚠ & stays draft ──────────────
const vA = validate(getSeedMeasure('kz-20')!, library, seedMeasures.filter((m) => m.id !== 'kz-20'));
expect(vA.checks.factor === 'ok', 'kz-20', `factor check ok (implied in corridor) — got ${vA.checks.factor}`);
expect(vA.checks.economics === 'ok', 'kz-20', `economics check ok — got ${vA.checks.economics}`);
expect(vA.eligibleForModel === true, 'kz-20', 'eligible for published');

const vB = validate(getSeedMeasure('kz-2')!, library, seedMeasures.filter((m) => m.id !== 'kz-2'));
expect(vB.checks.economics === 'ok', 'kz-2', `economics check ok — got ${vB.checks.economics}`);
expect(vB.eligibleForModel === true, 'kz-2', 'eligible for published');

const vC = validate(getSeedMeasure('kz-16')!, library, seedMeasures.filter((m) => m.id !== 'kz-16'));
const cC = compute(getSeedMeasure('kz-16')!, library);
log.push(`  · kz-16 implied factor = ${cC.impliedFactor?.toFixed(2)} (corridor ${library.references.ref_degas_factor.range.join('–')})`);
expect(vC.checks.factor === 'warn', 'kz-16', `factor check ⚠ (implied ~10× corridor) — got ${vC.checks.factor}`);
expect(vC.eligibleForModel === false, 'kz-16', 'NOT eligible for published');
expect(vC.scope !== 'published', 'kz-16', `recommended scope stays draft (published?) — got ${vC.scope}`);

// ── 3. Pool stacking: order-independent clip by MAC ───────────────────────────
// Two synthetic measures share one pool whose ceiling (1000) is oversubscribed by
// their combined potential (700 + 600). The cheaper (lower MAC) claims first.
const POOL = 'pool_coal_power';
const ceiling = library.pools[POOL].annual_flow;
const synth = (id: string, mac: number, ab: number): ComputedMeasure => ({
  id, sector: '1.A.1', name: { ru: id, en: id }, maturity: 'raw',
  capex: 0, opex: 0, durationYrs: 1, abatementKt: ab, npv: 0, discCo2Kt: 1, mac,
});
const cheap = synth('cheap', 10, ceiling * 0.7);
const pricey = synth('pricey', 50, ceiling * 0.6);
const byId = new Map<string, Measure>([
  ['cheap', { potential: { pool_ref: POOL } } as Measure],
  ['pricey', { potential: { pool_ref: POOL } } as Measure],
]);
const fwd = stackPools([cheap, pricey], byId, library);
const rev = stackPools([pricey, cheap], byId, library);
expect(fwd.get('cheap')!.potential === ceiling * 0.7 && !fwd.get('cheap')!.clipped, 'stacking', 'cheap measure gets full potential');
expect(fwd.get('pricey')!.clipped && Math.abs(fwd.get('pricey')!.potential - ceiling * 0.3) < 1e-6, 'stacking', 'pricey measure clipped to remaining ceiling');
expect(
  fwd.get('cheap')!.potential === rev.get('cheap')!.potential && fwd.get('pricey')!.potential === rev.get('pricey')!.potential,
  'stacking',
  'allocation is order-independent (forward == reversed)',
);

// ── 4. Pure-TS guardrails (Edge promotion path) agree with the HF validate() ──
// Promotion is server-authoritative and runs in Deno without HyperFormula, so the
// pure-TS guardrails must match the HF path exactly (abatement + each check verdict).
for (const id of ['kz-20', 'kz-2', 'kz-16'] as const) {
  const m = getSeedMeasure(id)!;
  const peers = seedMeasures.filter((p) => p.id !== id);
  const g = runGuardrails(m, library, peers);
  const vv = validate(m, library, peers);
  const cc = compute(m, library);
  near('abatement (JS vs HF)', id, g.abatementKt, cc.abatementKt);
  for (const k of ['factor', 'economics', 'pool', 'sector'] as const) {
    expect(g.checks[k] === vv.checks[k], id, `guardrail ${k}: JS ${g.checks[k]} == HF ${vv.checks[k]}`);
  }
  expect(g.eligible === vv.eligibleForModel, id, `eligibility: JS ${g.eligible} == HF ${vv.eligibleForModel}`);
}

// ── 5. Pure-TS economic core == HyperFormula oracle ───────────────────────────
// The shipped path computes NPV/MAC with a closed-form PV (eval.ts), no HF. HF stays
// the oracle: pure-TS must equal it to far tighter than the Excel tolerance, proving
// the PV port lost nothing. (Section 1 already pins pure-TS to the Excel cached values.)
const ORACLE_TOL = 1e-9;
function nearOracle(label: string, where: string, actual: number, expected: number): void {
  const rel = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  const ok = rel <= ORACLE_TOL;
  log.push(`  ${ok ? '✓' : '✗'} ${where} · ${label}: pure ${actual.toFixed(9)} vs HF ${expected.toFixed(9)} (rel ${rel.toExponential(2)})`);
  if (!ok) issues.push({ where, detail: `${label}: pure ${actual} vs HF ${expected} (rel ${rel.toExponential(3)})` });
}
for (const id of ['kz-20', 'kz-2', 'kz-16'] as const) {
  const c = compute(getSeedMeasure(id)!, library); // pure-TS economic core
  const hf = economicCoreHF({
    capex: c.capex, opex: c.opex, abatementKt: c.abatementKt,
    durationYrs: c.durationYrs, discountRate: library.globals.discountRate,
  });
  nearOracle('npv', id, c.npv, hf.npv);
  nearOracle('discCo2', id, c.discCo2Kt, hf.discCo2Kt);
  nearOracle('mac', id, c.mac, hf.mac);
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('Measure-golden — §11 acceptance slice');
console.log(log.join('\n'));
if (issues.length === 0) {
  console.log('  RESULT: PASS — AST→HF parity holds, guardrails fire as specified.');
  process.exit(0);
}
console.error(`  RESULT: FAIL — ${issues.length} issue(s):`);
for (const i of issues) console.error(`    ${i.where} · ${i.detail}`);
process.exit(1);
