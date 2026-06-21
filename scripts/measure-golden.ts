// Parity + guardrail test for the new measure-authoring calc path (§11 slice).
// `npm run measure-golden` -> `tsx scripts/measure-golden.ts`. Exits non-zero on
// any failure so it can gate CI alongside the existing `golden` test.
//
// Proves three things:
//   1. The AST→HyperFormula path reproduces the Excel-derived MAC/abatement for the
//      two parity measures (A=kz-20 feed additives, B=kz-2 coal CHP→gas).
//   2. kz-16 (mine degassing) trips the factor guardrail (⚠) → stays draft, never auto-promoted.
//   3. Pool stacking clips potential by MAC order, independent of input order.
// The frozen Excel-cached snapshot is the parity oracle (the original workbook's values),
// NOT the live `model.data.json` (which is now baked from Supabase and may carry post-Excel
// measure edits). This keeps measure-golden the bit-for-bit anchor to the original Excel.
import baselineJson from '../data/kz/model.excel.json';
import { library, getSeedMeasure, seedMeasures, assembleLibrary, type Graph } from '../src/lib/measure/library';
import graphSeed from '../data/kz/library/graph.seed.json';
import { compute, makeResolver, poolCeilingKt, type ComputedMeasure } from '../src/lib/measure/compute';
import { evalAst } from '../src/lib/measure/eval';
import { validate, stackPools, findDrift } from '../src/lib/measure/validate';
import { runGuardrails, abatementJs } from '../src/lib/measure/guardrails';
// HyperFormula twins — the parity oracle the shipped pure-TS core is pinned against.
import { economicCore as economicCoreHF } from '../src/lib/measure/compile';
import { lookupUnit, mulDim, divDim, dimEqual, isScalar, validateUnit } from '../src/lib/measure/dimensions';
import { dimensionCheck } from '../src/lib/measure/dimension-check';
import { BRIDGES, deltaEfFromBridges, validateBridge } from '../src/lib/measure/bridges';
import bridgesJson from '../data/kz/library/bridges.json';
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

// kz-2 (coal→gas) competes in the coal-power pool — R3: the pool is now the subsector
// emissions baseline (1.A.1.coal_power#max_emissions = 135.3 Мт), not the old 88-Мт
// `annual_flow` (a "garbage" number, dropped). The coal cluster fits under 135.3 Мт, so
// kz-2 is no longer clipped: pool check ok, not displaced, готово (eligibleForModel).
const vB = validate(getSeedMeasure('kz-2')!, library, seedMeasures.filter((m) => m.id !== 'kz-2'));
expect(vB.checks.economics === 'ok', 'kz-2', `economics check ok — got ${vB.checks.economics}`);
expect(vB.checks.pool === 'ok', 'kz-2', `pool check ok (coal cluster fits the 135.3 Мт subsector baseline) — got ${vB.checks.pool}`);
expect(vB.eligibleForModel === true, 'kz-2', 'готово — coal cluster fits its subsector emissions baseline');
expect(vB.displaced === false, 'kz-2', 'not displaced — R3: pool = subsector emissions baseline (135.3 Мт), cluster fits');

const vC = validate(getSeedMeasure('kz-16')!, library, seedMeasures.filter((m) => m.id !== 'kz-16'));
const cC = compute(getSeedMeasure('kz-16')!, library);
log.push(`  · kz-16 implied factor = ${cC.impliedFactor?.toFixed(2)} (corridor ${library.references.ref_degas_factor.range.join('–')})`);
expect(vC.checks.factor === 'warn', 'kz-16', `factor check ⚠ (implied ~10× corridor) — got ${vC.checks.factor}`);
expect(vC.eligibleForModel === false, 'kz-16', 'NOT eligible for published');
expect(vC.scope !== 'published', 'kz-16', `recommended scope stays draft (published?) — got ${vC.scope}`);

// ── 3. Pool stacking: order-independent clip by MAC ───────────────────────────
// Two synthetic measures share one pool whose ceiling (1000) is oversubscribed by
// their combined potential (700 + 600). The cheaper (lower MAC) claims first.
const POOL = 'sub:1.A.1.coal_power#max_emissions';
const ceiling = poolCeilingKt(POOL, library)!;
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
    'доля', 'кВт', 'лет', 'млн м³', 'т', 'тCO₂/Гкал', 'тCO₂/МВт·ч', 'тCO₂/(га·год)', 'тыс. Гкал',
    'тыс. Гкал/год', 'тыс. га', 'тыс. голов', 'тыс. м³', 'усл. ед. (объём метана)', 'хозяйств',
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

// ── 9. Dimensional gate (L3 slice 2) — every measure folds to CO₂; garbage trips the gate ──
// The check folds each abatement AST over the slice-1 vocabulary and asserts it reduces to a
// CO₂ quantity. The gate is hard (draft on failure), so all 26 published measures MUST pass —
// a flip is a real finding to triage (like kz-16/kz-27), never a reason to weaken the check.
{
  for (const m of seedMeasures) {
    const d = dimensionCheck(m, library);
    expect(d.status !== 'warn', 'dimension',
      `${m.id}: abatement folds to CO₂ (status=${d.status}${d.issues.length ? ' — ' + d.issues.join('; ') : ''})`);
  }

  // Corrupt one EF input into a mass unit: the formula now reduces to non-CO₂ → the gate fires
  // and validate() withholds promotion (reduction panel incomplete, not eligible). kz-6's boiler
  // EF is still an input (only fuel EFs were migrated to res-refs), so it is the corruption probe.
  const bad = JSON.parse(JSON.stringify(getSeedMeasure('kz-6')!)) as Measure;
  bad.inputs!.ef_boiler.unit = 'т'; // mass, not an emission factor
  const dBad = dimensionCheck(bad, library);
  expect(dBad.status === 'warn', 'dimension', `corrupted EF unit trips the dimensional gate — got ${dBad.status}`);
  const vBad = validate(bad, library, seedMeasures.filter((m) => m.id !== 'kz-6'));
  expect(
    vBad.missing.some((s) => s.startsWith('dimension:'))
      && vBad.panels.reduction === 'incomplete' && vBad.eligibleForModel === false,
    'dimension',
    `dimensional failure gates to draft (reduction=${vBad.panels.reduction}, eligible=${vBad.eligibleForModel})`,
  );

  // A missing unit is equally a gate failure (the B-path made units mandatory).
  const noUnit = JSON.parse(JSON.stringify(getSeedMeasure('kz-9')!)) as Measure;
  delete noUnit.inputs!.cap_mw.unit;
  expect(dimensionCheck(noUnit, library).status === 'warn', 'dimension',
    'a missing input unit trips the dimensional gate');
}

// ── 10. Carrier layer (L3 slice 3) — kz-27 class: a wrong-resource EF trips the gate ──
// Units alone fold to CO₂; only the carrier layer (resource identity from the ref) sees that
// the EF belongs to a different resource/product than the measure. Inert on the real 26 (the
// fuel EFs were migrated to res-refs, but no measure crosses carriers in a product).
{
  // Lock 1 (backbone): a product may not cross two fuel carriers. coal EF × gas EF → mismatch.
  const crossCarrier = {
    id: 'synthetic-cross-carrier',
    abatement: { formula: { op: 'mul', args: [{ ref: 'res:coal#ef' }, { ref: 'res:gas#ef' }] } },
  } as unknown as Measure;
  expect(dimensionCheck(crossCarrier, library).issues.some((s) => s.includes('carrier mismatch')),
    'carrier', 'multiplying coal EF × gas EF trips the carrier-mismatch lock');

  // A fuel switch subtracts EF_coal − EF_gas (a sub, not a mul) — exempt, kz-2 stays ok.
  const kz2dim = dimensionCheck(getSeedMeasure('kz-2')!, library);
  expect(kz2dim.status === 'ok' && !kz2dim.issues.some((s) => s.includes('carrier')),
    'carrier', 'fuel switch (EF_coal − EF_gas) is exempt — kz-2 stays ok');

  // Lock 2 (the literal kz-27): a coarse output-EF priced per MWh-electricity used on a measure
  // whose product is Гкал-heat. The dimensions fold to CO₂/yr fine — only the carrier catches it.
  const kz27 = JSON.parse(JSON.stringify(getSeedMeasure('kz-6')!)) as Measure;
  kz27.product_ref = 'prod_heat';
  kz27.abatement = {
    formula: { op: 'mul', args: [{ ref: 'heat_kgcal' }, { ref: 'prd:prod_mwh#carbon_footprint' }] },
  } as Measure['abatement'];
  const d27 = dimensionCheck(kz27, library);
  expect(d27.dim != null && dimEqual(d27.dim, { mass_co2: 1, time: -1 }), 'carrier',
    'kz-27 synthetic is dimensionally CO₂/yr — units alone see nothing wrong');
  expect(d27.status === 'warn' && d27.issues.some((s) => s.includes('output-EF')), 'carrier',
    `electric output-EF on a heat product trips the carrier gate — got ${d27.status} (${d27.issues.join('; ')})`);
  const v27 = validate(kz27, library, []);
  expect(v27.panels.reduction === 'incomplete' && v27.eligibleForModel === false, 'carrier',
    `kz-27 synthetic gated to draft (reduction=${v27.panels.reduction}, eligible=${v27.eligibleForModel})`);

  // Same measure, product corrected to electricity (matches the output-EF) → carrier layer clears.
  const fixed = JSON.parse(JSON.stringify(kz27)) as Measure;
  fixed.product_ref = 'prod_mwh';
  expect(dimensionCheck(fixed, library).status === 'ok', 'carrier',
    'matching the product to the output-EF (prod_mwh) clears the carrier gate');
}

// ── 11. Bridge registry + composition (L3 slice 4) — delta_ef recomposed parity-exact ──
// Bridges are the typed unit-conversion layer (`bridges.ts`). The composite delta_ef reassembled
// from power_to_energy ∘ fuel_switch evaluates bit-for-bit to the engine's template (the engine
// is unchanged), and — with the LHV indicators now in the library — the carrier lock catches a
// real mis-composed fuel chain, not just a synthetic one.
{
  // The published mirror equals the code registry (trust anchor cannot silently drift).
  const mirror = { ...(bridgesJson as Record<string, unknown>) };
  delete mirror._comment;
  expect(JSON.stringify(mirror) === JSON.stringify(BRIDGES), 'bridges',
    'bridges.json published mirror equals the code registry');

  // Composition parity: delta_ef rebuilt from bridges == the engine's delta_ef template (kz-2).
  const kz2 = getSeedMeasure('kz-2')!;
  const resolve = makeResolver(kz2, library);
  const composed = deltaEfFromBridges({
    capacity: { ref: 'cap_mw' }, hours: 8760, cf: { ref: 'kium' },
    efIn: { ref: 'res:coal#ef' }, efOut: { ref: 'res:gas#ef' }, scale: 1e-3,
  });
  near('abatement', 'bridges', evalAst(composed, resolve), compute(kz2, library).abatementKt);

  // Carrier lock alive on a REAL composed chain: fuel_to_energy (mass × res:coal#lhv) makes the
  // energy carry "coal", so energy_to_co2 with a gas EF is now a detectable cross-carrier error.
  const fuelChain = (efRef: string) => ({
    id: `synthetic-fuelchain-${efRef}`,
    inputs: { fuel_t: { value: 1, unit: 'т', provenance: { source_type: 'assumption', confidence: 'low' } } },
    abatement: { formula: { op: 'mul', args: [{ ref: 'fuel_t' }, { ref: 'res:coal#lhv' }, { ref: efRef }] } },
  } as unknown as Measure);
  expect(dimensionCheck(fuelChain('res:coal#ef'), library).status === 'ok', 'bridges',
    'coal mass × coal LHV × coal EF folds clean (carrier consistent)');
  const mis = dimensionCheck(fuelChain('res:gas#ef'), library);
  expect(mis.status === 'warn' && mis.issues.some((s) => s.includes('carrier mismatch')), 'bridges',
    'coal energy × GAS EF — fuel_to_energy carried the coal carrier, so the wrong EF is caught');
}

// ── 12. Library-authored units & bridges (L3) — extendable vocabulary + registry, validated ──
// Units and bridges are first-class in `library` (code seed + data overlay), so an author can
// add or correct them. The upsert path validates each: a unit needs a base-dim vector + scale,
// a bridge's expr must fold to its declared `to`. Demonstrated with a data-overlay extension.
{
  expect(!!library.units['МВт'] && !!library.units['tCO₂/MWh'], 'library',
    'library.units exposes the dimensional vocabulary');
  expect(!!library.bridges['energy_to_co2'] && !!library.bridges['fuel_switch_abatement'], 'library',
    'library.bridges exposes the bridge registry');

  // validateUnit: a sound unit passes; an unknown base dim or a zero scale is rejected.
  expect(validateUnit({ id: 'тCO₂/т', dim: { mass_co2: 1, mass: -1 }, scale: 1 }).length === 0,
    'library', 'a well-formed new unit validates');
  expect(validateUnit({ id: 'bad', dim: { luminosity: 1 } as unknown as Record<string, number>, scale: 1 }).length > 0,
    'library', 'a unit over an unknown base dimension is rejected');
  expect(validateUnit({ id: 'bad2', dim: {}, scale: 0 }).length > 0,
    'library', 'a unit with a zero scale is rejected');

  // A measure using a NEW overlay unit folds — proves the vocabulary is genuinely data-driven.
  const extended = assembleLibrary({
    ...(graphSeed as unknown as Graph),
    units: [{ id: 'ктCO₂/год', dim: { mass_co2: 1, time: -1 }, scale: 1000 / 8760 }],
  });
  expect(!!extended.units['ктCO₂/год'], 'library', 'a data-overlay unit lands in library.units');
  const synthetic = {
    id: 'syn-new-unit',
    abatement: { formula: { ref: 'x' } },
    inputs: { x: { value: 1, unit: 'ктCO₂/год', provenance: { source_type: 'assumption', confidence: 'low' } } },
  } as unknown as Measure;
  expect(dimensionCheck(synthetic, extended).status === 'ok', 'library',
    'a measure using an author-added unit folds to CO₂ (vocabulary is data-driven)');

  // validateBridge: a consistent bridge passes; one whose expr does not fold to `to` is rejected.
  expect(validateBridge(library.bridges['energy_to_co2']).length === 0, 'library',
    'a consistent bridge validates (expr folds to its declared `to`)');
  const broken = {
    id: 'broken', from: { dim: { energy: 1 } }, via: [{ name: 'ef', dim: { mass_co2: 1, energy: -1 } }],
    to: { dim: { mass: 1 } }, // wrong: energy × EF = mass_co2, not mass
    expr: { op: 'mul', args: [{ slot: 'from' }, { slot: 'ef' }] }, authoring: 'x',
  };
  const brokenErrs = validateBridge(broken as unknown as Parameters<typeof validateBridge>[0]);
  expect(brokenErrs.length > 0 && brokenErrs[0].includes('folds to'), 'library',
    'a bridge whose expr does not fold to its declared `to` is rejected');
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
