// R8 semantic-layer regression test. `npm run r8-test` -> tsx; exits non-zero on failure.
// Asserts: corridor transparency is honest but non-gating (A1.5/A1.6/C11); classification
// coherence gates a mis-filed measure but passes the clean set (A1.3).
import { library, seedMeasures, getSeedMeasure } from '../src/lib/measure/library';
import { validate } from '../src/lib/measure/validate';

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { console.log(`  ✓ ${msg}`); return; } failures++; console.log(`  ✗ ${msg}`); };
const peers = (id: string) => seedMeasures.filter((m) => m.id !== id);

// A1.5/A1.6/C11 — transparency, not a gate
console.log('A1.5/A1.6/C11 corridor transparency');
const results = seedMeasures.map((m) => validate(m, library, peers(m.id)));
const eligible = results.filter((v) => v.eligibleForModel).length;
ok(eligible >= 24, `eligibility unchanged — ${eligible}/${seedMeasures.length} still готово (no corridor-gate regression)`);
const naFactor = results.filter((v) => v.checks.factor === 'na');
ok(naFactor.every((v) => v.unchecked.some((u) => u.startsWith('factor:'))), 'every factor=na measure names the gap in `unchecked` (no silent na)');
ok(results.some((v) => v.unchecked.some((u) => u.startsWith('economics:'))), 'economics gaps surface in `unchecked` too');
ok(results.every((v) => Array.isArray(v.unchecked)), '`unchecked` always present (honest-badge field)');

// A1.3 — classification coherence gates only the incoherent
console.log('A1.3 classification coherence');
ok(results.every((v) => v.classificationIssues.length === 0), 'the whole seed is classification-coherent (no false positives)');
const bad = JSON.parse(JSON.stringify(getSeedMeasure('kz-1'))); bad.sector_ref = '5';
const vb = validate(bad, library, peers('kz-1'));
ok(vb.classificationIssues.length > 0, 'a mis-sectored measure is flagged incoherent');
ok(vb.eligibleForModel === false && vb.panels.baseline === 'incomplete', 'classification incoherence gates (baseline incomplete, not готово)');

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
