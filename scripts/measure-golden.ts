// Parity + guardrail test for the new measure-authoring calc path (§11 slice).
// `npm run measure-golden` -> `tsx scripts/measure-golden.ts`. Exits non-zero on
// any failure so it can gate CI alongside the existing `golden` test.
//
// Proves three things:
//   1. The AST→HyperFormula path reproduces the Excel-derived MAC/abatement for the
//      two parity measures (A=kz-20 feed additives, B=kz-2 coal CHP→gas).
//   2. kz-16 (mine degassing) trips the factor guardrail (⚠) and kz-2 is clipped in its
//      shared coal-power pool by cheaper peers — both stay draft, never auto-promoted.
//   3. Pool stacking clips potential by MAC order, independent of input order.
import baselineJson from '../data/kz/model.data.json';
import { library, getSeedMeasure, seedMeasures } from '../src/lib/measure/library';
import { compute, type ComputedMeasure } from '../src/lib/measure/compute';
import { validate, stackPools, findDrift } from '../src/lib/measure/validate';
import { runGuardrails, abatementJs } from '../src/lib/measure/guardrails';
// HyperFormula twins — the parity oracle the shipped pure-TS core is pinned against.
import { economicCore as economicCoreHF } from '../src/lib/measure/compile';
import { lookupUnit, mulDim, divDim, dimEqual, isScalar } from '../src/lib/measure/dimensions';
import type { Measure, NumberOrRef } from '../src/lib/measure/schema';

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

  // No `abatement` block at all → clear error, not "Cannot read 'formula' of undefined".
  const noAbate = { id: 'noabate', schema_version: 1, name: { ru: '', en: '' }, sector_ref: '1.A.1',
    scope: 'draft', maturity_stage: 'computed' } as unknown as Measure;
  let msg2 = '';
  try { compute(noAbate, library); } catch (e) { msg2 = (e as Error).message; }
  expect(/no 'abatement' block/i.test(msg2) && !/reading 'formula'/i.test(msg2), 'robustness',
    `missing abatement → descriptive error, not a read-of-undefined crash (got: ${msg2 || 'no throw'})`);

  // A formula-based measure (the migrated 26) is a complete reduction — validate must NOT
  // report 'abatement' missing nor mark the reduction panel incomplete.
  const vFormula = validate(getSeedMeasure('kz-1')!, library, seedMeasures.filter((m) => m.id !== 'kz-1'));
  expect(!vFormula.missing.includes('abatement') && vFormula.panels.reduction !== 'incomplete', 'robustness',
    `kz-1 (inline formula) → reduction recognized (missing=${JSON.stringify(vFormula.missing)} reduction=${vFormula.panels.reduction})`);
}

// ── 2. Guardrails: A ✓ in corridor & eligible; C ⚠ & stays draft ──────────────
const vA = validate(getSeedMeasure('kz-20')!, library, seedMeasures.filter((m) => m.id !== 'kz-20'));
expect(vA.checks.factor === 'ok', 'kz-20', `factor check ok (implied in corridor) — got ${vA.checks.factor}`);
expect(vA.checks.economics === 'ok', 'kz-20', `economics check ok — got ${vA.checks.economics}`);
expect(vA.eligibleForModel === true, 'kz-20', 'eligible for published');
expect(vA.displaced === false, 'kz-20', 'not displaced — claims its full pool share');

// kz-2 (coal→gas) shares pool_coal_power with cheaper coal-displacers (kz-3/4/5/8). Being the
// most expensive, its share is clipped on oversubscription — so its pool check ⚠ AND it is
// flagged `displaced`. But pool competition is a render-time outcome, not a quality failure:
// after 1B it no longer gates promotion, so kz-2 is `готово` (eligibleForModel) yet displaced.
const vB = validate(getSeedMeasure('kz-2')!, library, seedMeasures.filter((m) => m.id !== 'kz-2'));
expect(vB.checks.economics === 'ok', 'kz-2', `economics check ok — got ${vB.checks.economics}`);
expect(vB.checks.pool === 'warn', 'kz-2', `pool check ⚠ informational (clipped by cheaper coal-displacers) — got ${vB.checks.pool}`);
expect(vB.eligibleForModel === true, 'kz-2', 'готово — pool clipping no longer gates eligibility (render-time concern)');
expect(vB.displaced === true, 'kz-2', 'displaced=true — share clipped in pool_coal_power by cheaper peers');

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

// ── 6. Reuse-drift backstop — the kz-27 «one quantity, two numbers» catch ─────
// e74dd61 phase A: a `binding.mode='reuse'` whose local copy disagrees with the
// source it claims must surface as drift and withhold promotion. This was the only
// kz-27 miss (capacity=1500 while cap_mw=1163) the protocol had nothing to catch
// before; pin both the detection and the eligibility gate so neither can regress.
{
  // 6a — detection over the §6 `sources` path (the kz-27 shape exactly).
  const probe = (capacity: NumberOrRef): Measure => ({
    id: 'drift-probe', schema_version: 1, name: { ru: '', en: '' }, sector_ref: '1.A.1',
    scope: 'draft', maturity_stage: 'computed', mechanism: 'reduction',
    abatement: { formula: { const: 1 } },
    inputs: { cap_mw: { value: 1163, provenance: { source_type: 'assumption', confidence: 'low' } } },
    created_technologies: [{ technology_ref: 't', capacity }],
    sources: {
      'created_technologies[0].capacity': {
        provenance: { source_type: 'assumption', confidence: 'low' },
        binding: { mode: 'reuse', ref: 'in:cap_mw' },
      },
    },
  } as unknown as Measure);

  const drifted = findDrift(probe(1500), library);
  expect(drifted.length === 1 && drifted[0].local === 1500 && drifted[0].bound === 1163,
    'drift', `capacity 1500 vs reuse→cap_mw 1163 detected (got ${JSON.stringify(drifted)})`);
  expect(findDrift(probe(1163), library).length === 0, 'drift',
    'capacity equal to bound source → no drift');
  expect(findDrift(probe({ ref: 'cap_mw' }), library).length === 0, 'drift',
    'capacity as live {ref:cap_mw} → cannot drift (phase C structural fix)');

  // 6b — drift gates eligibility on a real measure: kz-20 is eligible until a
  // drifting reuse input is injected, after which validate() must withhold promotion.
  const peers = seedMeasures.filter((m) => m.id !== 'kz-20');
  const tainted = JSON.parse(JSON.stringify(getSeedMeasure('kz-20')!)) as Measure;
  tainted.inputs = {
    ...(tainted.inputs ?? {}),
    probe_a: { value: 100, provenance: { source_type: 'assumption', confidence: 'low' } },
    probe_b: { value: 999, provenance: { source_type: 'assumption', confidence: 'low' }, binding: { mode: 'reuse', ref: 'in:probe_a' } },
  };
  const vt = validate(tainted, library, peers);
  expect(vt.drift.length >= 1 && vt.eligibleForModel === false, 'drift',
    `injected reuse-drift blocks promotion (drift=${vt.drift.length}, eligible=${vt.eligibleForModel})`);
}

// ── 7. Non-degeneracy — "builds objects but CAPEX rolls to 0" must not pass готово ──
// kz-27's class: created_technologies present but no capacity/capex_ud → CAPEX=0, and with
// no capex_denominator the economics corridor stays 'na'. Without the non-degeneracy gate
// such a hollow measure could reach `готово`. Pin it (+ a costed control that stays clean).
{
  const mk = (tech: Record<string, unknown>): Measure => ({
    id: 'degen', schema_version: 1, name: { ru: '', en: '' }, sector_ref: '1.A.1',
    scope: 'draft', maturity_stage: 'computed', mechanism: 'reduction',
    abatement: { formula: { const: 100 } },
    inputs: { lifetime: { value: 10, provenance: { source_type: 'assumption', confidence: 'low' } } },
    created_technologies: [{ technology_ref: 'x', ...tech }],
  } as unknown as Measure);

  const vDegen = validate(mk({ capacity: 0 }), library, []);
  expect(vDegen.missing.some((s) => s.startsWith('degenerate:')) && vDegen.eligibleForModel === false,
    'degeneracy', `builds objects but CAPEX=0 → flagged degenerate & not готово (missing=${JSON.stringify(vDegen.missing)})`);

  const vCosted = validate(mk({ capex_musd: 5 }), library, []);
  expect(!vCosted.missing.some((s) => s.startsWith('degenerate:')),
    'degeneracy', 'a costed build (capex_musd>0) is NOT flagged degenerate');
}

// ── 8. Dimension vocabulary (L3 slice 1) — every real library unit resolves + algebra ──
// Pins the bridge-registry foundation: each unit string actually used in the library maps to
// a dimension, and the dimensional algebra (the checker will fold an AST over it) is sound.
{
  // Every distinct unit string found in the library data must resolve (else its measure would
  // fail the dimensional gate). Keep in lockstep with the data extraction.
  const REAL_UNITS = [
    '$/farm', '$/head', '$/head·yr', '$/kW', '$/t', '$/thousand m³', 'MWh', 'fraction',
    'kt CO₂eq/(million m³)', 'kt CO₂eq/(thousand head·yr)', 'kt CO₂eq/(млн м³)',
    'kt CO₂eq/(тыс. голов·год)', 'kt CO₂eq/yr', 'mUSD/yr', 'tCO₂/MWh', 'tCO₂/MWh (coal baseline)',
    'ГВт·ч/год', 'ГДж/т', 'ГДж/тыс. м³', 'Гкал', 'МВт', 'МВт·ч/год', 'Мт CO₂eq/год', 'голов',
    'доля', 'кВт', 'лет', 'млн м³', 'т', 'тCO₂/МВт·ч', 'тыс. Гкал', 'тыс. Гкал/год', 'тыс. га',
    'тыс. голов', 'тыс. м³', 'усл. ед. (объём метана)', 'хозяйств',
  ];
  const unresolved = REAL_UNITS.filter((u) => !lookupUnit(u));
  expect(unresolved.length === 0, 'dimensions', `every real library unit resolves (unresolved: ${JSON.stringify(unresolved)})`);

  // Power is derived (energy·time⁻¹): МВт and МВт·ч/год reduce to the SAME dimension.
  expect(dimEqual(lookupUnit('МВт')!.dim, lookupUnit('МВт·ч/год')!.dim),
    'dimensions', 'МВт ≡ МВт·ч/год (both energy·time⁻¹)');

  // RU/EN spellings of the EF agree.
  expect(dimEqual(lookupUnit('tCO₂/MWh')!.dim, lookupUnit('тCO₂/МВт·ч')!.dim),
    'dimensions', 'tCO₂/MWh ≡ тCO₂/МВт·ч');

  // Bridge math: energy × EF = CO₂ (mass_co2); power × time = energy.
  const energyDim = lookupUnit('MWh')!.dim;
  const efDim = lookupUnit('tCO₂/MWh')!.dim;
  expect(dimEqual(mulDim(energyDim, efDim), { mass_co2: 1 }),
    'dimensions', 'energy × EF = mass_co2 (the energy_to_co2 bridge)');
  expect(dimEqual(mulDim(lookupUnit('МВт')!.dim, lookupUnit('лет')!.dim), energyDim),
    'dimensions', 'power × time = energy');
  // div is the inverse: co2 ÷ energy = EF.
  expect(dimEqual(divDim({ mass_co2: 1 }, energyDim), efDim),
    'dimensions', 'mass_co2 ÷ energy = EF');

  // Fractions are scalar (dimensionless).
  expect(isScalar(lookupUnit('доля')!.dim) && isScalar(lookupUnit('fraction')!.dim),
    'dimensions', 'доля / fraction are dimensionless');
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
