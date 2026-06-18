// Verify the MCP connector path end-to-end: load the library + measures from Supabase
// ANONYMOUSLY (exactly what an anonymous reader / the connector's published view sees),
// then compute()+validate() every measure (what list_measures does) and assert each
// reproduces the Excel curve. Proves all 26 are visible AND computable via MCP.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadLibrary, loadMeasures } from '../src/lib/measure/load-supabase';
import { compute } from '../src/lib/measure/compute';
import { validate } from '../src/lib/measure/validate';
import baseline from '../data/kz/model.data.json';

function env(file: string, key: string): string {
  const m = readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) throw new Error(`${key} not in ${file}`);
  return m[1].trim();
}
const projects = (baseline as any).projects as Array<{ id: number; mac: number; abatementKt: number }>;
const REL = 1e-6;

async function main() {
  const url = env('.env.local', 'NEXT_PUBLIC_SUPABASE_URL');
  const anon = env('.env.local', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const db = createClient(url, anon);

  const lib = await loadLibrary(db);
  const measures = await loadMeasures(db);
  console.log(`Supabase (anonymous): library objects=${Object.keys(lib.technologies).length} resources=${Object.keys(lib.resources).length}`);
  console.log(`Published measures visible: ${measures.length}`);

  let fail = 0;
  for (const m of measures.sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)))) {
    const id = Number(m.id.replace('kz-', ''));
    const e = projects.find((p) => p.id === id)!;
    const c = compute(m, lib);
    validate(m, lib, measures.filter((x) => x.id !== m.id)); // must not throw (list_measures runs it)
    const relMac = Math.abs(c.mac - e.mac) / Math.max(Math.abs(e.mac), 1e-9);
    const relAb = Math.abs(c.abatementKt - e.abatementKt) / Math.max(Math.abs(e.abatementKt), 1e-9);
    const ok = relMac <= REL && relAb <= REL;
    if (!ok) { fail++; console.error(`  ✗ ${m.id} mac ${c.mac} vs ${e.mac} | abat ${c.abatementKt} vs ${e.abatementKt}`); }
  }
  if (measures.length !== 26) { console.error(`  ✗ expected 26 published, got ${measures.length}`); fail++; }
  console.log(fail === 0 ? '  RESULT: PASS — 26 measures visible via Supabase and reproduce the Excel curve.' : `  RESULT: FAIL — ${fail} issue(s).`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
