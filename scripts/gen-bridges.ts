// Regenerate data/kz/library/bridges.json from the code registry (the trust-anchor mirror).
// `npx tsx scripts/gen-bridges.ts`. measure-golden §11 asserts the mirror equals BRIDGES.
import { writeFileSync } from 'node:fs';
import { BRIDGES } from '../src/lib/measure/bridges';

const out = {
  _comment:
    'Published mirror of src/lib/measure/bridges.ts BRIDGES (trust anchor). The engine uses the '
    + 'code definitions; regenerate with `npx tsx scripts/gen-bridges.ts`.',
  ...BRIDGES,
};
writeFileSync('data/kz/library/bridges.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${Object.keys(BRIDGES).length} bridges to data/kz/library/bridges.json`);
