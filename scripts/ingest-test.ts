// R1 ingest-gate regression test. `npm run ingest-test` -> tsx; exits non-zero on
// any failure so it gates CI alongside `golden` / `measure-golden`.
//
// Asserts the four R1.1 invariants on the canonical seed:
//   1. schema gate  — every measure validates (ajv, additionalProperties:false)
//   2. orphan drop  — zero false drops (formula-derived provenance in `computed` survives)
//   3. formula_hash — deterministic; a number edit is parametric, a formula edit structural
//   4. findShouldRef — flags the inline subsector-emissions baselines (C9), warn by default
import { library, seedMeasures } from '../src/lib/measure/library';
import { ingest, formulaHash, findShouldRef } from '../src/lib/measure/ingest';
import type { Measure } from '../src/lib/measure/schema';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { console.log(`  ✓ ${msg}`); return; }
  failures++; console.log(`  ✗ ${msg}`);
};
const clone = (m: Measure): Measure => JSON.parse(JSON.stringify(m));

// 1. schema gate ───────────────────────────────────────────────────────────
console.log('1. schema gate');
const schemaFails = seedMeasures.filter((m) => ingest(m, library).errors.some((e) => e.startsWith('schema')));
ok(schemaFails.length === 0, `all ${seedMeasures.length} seed measures pass the ajv gate (failed: ${schemaFails.map((m) => m.id).join(',') || 'none'})`);

// 2. orphan drop ─────────────────────────────────────────────────────────────
console.log('2. orphan sources');
const dropped = seedMeasures.reduce((s, m) => s + ingest(m, library).droppedSources.length, 0);
ok(dropped === 0, `no source provenance falsely dropped across the seed (dropped=${dropped})`);

// 3. formula_hash + change_kind ──────────────────────────────────────────────
console.log('3. formula_hash / change_kind');
const sample = seedMeasures.find((m) => m.abatement?.formula) ?? seedMeasures[0];
const h0 = formulaHash(sample);
ok(h0 === formulaHash(sample), 'formula_hash is deterministic');
ok(new Set(seedMeasures.map(formulaHash)).size > 1, 'distinct measures get distinct formula hashes');
ok(ingest(sample, library, { prevFormulaHash: h0 }).change_kind === 'parametric', 'same document ⇒ parametric');

// a pure number edit must stay parametric (hash unchanged)
const numEdit = clone(sample);
const inKey = Object.keys(numEdit.inputs ?? {})[0];
if (inKey) numEdit.inputs![inKey].value += 1;
ok(ingest(numEdit, library, { prevFormulaHash: h0 }).change_kind === 'parametric', 'a number edit ⇒ parametric (formula_hash unchanged)');

// a formula edit must be structural (hash changed)
const formEdit = clone(sample);
formEdit.abatement.formula = { op: 'mul', args: [{ const: 2 }, formEdit.abatement.formula ?? { const: 1 }] };
ok(ingest(formEdit, library, { prevFormulaHash: h0 }).change_kind === 'structural', 'a formula edit ⇒ structural (formula_hash changed)');

// 4. findShouldRef — inline subsector emissions baselines (C9) ────────────────
console.log('4. findShouldRef (C9 baseline copies)');
const refMeasures = seedMeasures.filter((m) => findShouldRef(m, library).length > 0);
ok(refMeasures.length >= 10, `≥10 measures inline a subsector-emissions baseline (found ${refMeasures.length})`);
const allBaseline = seedMeasures.every((m) =>
  findShouldRef(m, library).every((e) => e.path.endsWith('base_emissions')
    && e.matches.every((id) => library.indicators.find((i) => i.id === id)?.key === 'max_emissions')));
ok(allBaseline, 'every should-ref hit is a base_emissions ↔ max_emissions match (no cross-dimension noise)');
const oneWith = refMeasures[0];
ok(!ingest(oneWith, library).errors.some((e) => e.startsWith('should-ref')), 'default severity never blocks on should-ref (warn only)');
ok(ingest(oneWith, library, { shouldRefSeverity: 'block' }).errors.some((e) => e.startsWith('should-ref:')), "severity='block' surfaces a unique match as an error");

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
