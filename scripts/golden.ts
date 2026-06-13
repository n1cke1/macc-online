// CLI runner for the golden test. `npm run golden` -> `tsx scripts/golden.ts`.
// Exits non-zero on any mismatch so it can gate CI.
import { runGolden } from '../src/lib/calc/golden';

const r = runGolden();

console.log(`Golden test — model ${r.modelVersion}`);
console.log(`  checks: ${r.checked}`);
console.log(`  max abs diff: ${r.maxAbsDiff.toExponential(3)}`);

if (r.pass) {
  console.log('  RESULT: PASS — HyperFormula recalc matches the Excel cached values.');
  process.exit(0);
}

console.error(`  RESULT: FAIL — ${r.issues.length} mismatch(es):`);
for (const i of r.issues.slice(0, 50)) {
  console.error(
    `    ${i.where} · ${i.field}: got ${i.actual}, expected ${i.expected} (Δ ${i.diff.toExponential(3)})`,
  );
}
process.exit(1);
