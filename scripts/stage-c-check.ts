// Stage C verification: load the library from Supabase (anon, public read) and prove
// it is identical to the file-seed library — compute()/validate() on the 3 measures
// must match bit-for-bit between the DB-loaded and the file-loaded Library.
//   npx tsx scripts/stage-c-check.ts
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { library as fileLib, seedMeasures } from '../src/lib/measure/library';
import { loadLibrary } from '../src/lib/measure/load-supabase';
import { compute } from '../src/lib/measure/compute';

function envFrom(file: string, key: string): string {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not in ${file}`);
  return line.slice(key.length + 1).trim();
}

async function main() {
  const url = envFrom('.env.local', 'NEXT_PUBLIC_SUPABASE_URL');
  const anon = envFrom('.env.local', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const db = createClient(url, anon, { auth: { persistSession: false } });

  const dbLib = await loadLibrary(db);
  console.log(`DB library: ${Object.keys(dbLib.technologies).length} objects, ${Object.keys(dbLib.resources).length} resources, ${dbLib.indicators.length} indicators`);

  let fails = 0;
  for (const m of seedMeasures) {
    const f = compute(m, fileLib);
    const d = compute(m, dbLib);
    const same = ['mac', 'abatementKt', 'capex', 'opex'].every((k) => Math.abs((f as never)[k] - (d as never)[k]) < 1e-9);
    console.log(`  ${same ? '✓' : '✗'} ${m.id}: file MAC ${f.mac.toFixed(2)} vs DB MAC ${d.mac.toFixed(2)} · opex ${f.opex.toFixed(2)}/${d.opex.toFixed(2)}`);
    if (!same) fails++;
  }
  if (fails) { console.error(`FAIL: ${fails} measure(s) diverge between DB and file library`); process.exit(1); }
  console.log('STAGE-C CHECK OK — DB-loaded library == file library (compute parity)');
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
