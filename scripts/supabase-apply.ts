// Apply the measure-authoring backend to Supabase over a direct Postgres connection
// (SUPABASE_DB_URL in .env.supabase.local — gitignored). The `postgres` superuser
// bypasses RLS, so this both runs the migrations and seeds the authority/base rows
// without a service-role key.
//
//   npx tsx scripts/supabase-apply.ts --check     # read-only: connectivity + table list
//   npx tsx scripts/supabase-apply.ts --migrate   # run migrations 0005..0007 (in a tx each)
//   npx tsx scripts/supabase-apply.ts --seed       # seed graph + (if a profile exists) 3 measures
//
// --migrate / --seed MUTATE the live DB.
import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';
import graph from '../data/kz/library/graph.seed.json';
import measuresSeed from '../data/kz/library/measures.seed.json';

function loadDbUrl(): string {
  const raw = readFileSync(new URL('../.env.supabase.local', import.meta.url), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
  if (!line) throw new Error('SUPABASE_DB_URL not found in .env.supabase.local');
  return line.slice('SUPABASE_DB_URL='.length).trim();
}

const MIGRATIONS = ['0005_measures_schema.sql', '0006_measures_rls.sql', '0007_library_graph.sql', '0008_measure_versions.sql', '0009_measure_publish_admin.sql', '0010_open_library.sql', '0011_respect_scope.sql', '0012_create_and_archive.sql'];
const mode = process.argv[2] ?? '--check';

interface Graph {
  subsectors: Array<{ id: string; sector_ref: string; name: string }>;
  objects: Array<{ id: string; name: string; kind?: string; description?: string; rules?: string; lifetimeYrs?: number }>;
  resources: Array<{ id: string; name: string; unit: string }>;
  products: Array<{ id: string; name: string; unit?: string; service_unit?: string; sector_ref?: string; object_ref?: string }>;
  references: Array<{ id: string; type?: string; range: [number, number]; unit?: string; source?: unknown }>;
  indicators: Array<{ id: string; key: string; owner_kind: string; owner_ref: string; value: number; unit?: string; reference_ref?: string; provenance?: unknown }>;
  pools: Array<{ id: string; caps_ref?: string; annual_flow: number; unit?: string; sector_ref?: string; baselineEmissionsKt?: number }>;
}
const g = graph as unknown as Graph;
const measures = (measuresSeed as { measures: Array<Record<string, unknown>> }).measures;

async function listTables(c: Client): Promise<string[]> {
  const r = await c.query(`select table_name from information_schema.tables where table_schema='public' order by table_name`);
  return r.rows.map((x) => x.table_name as string);
}

async function migrate(c: Client) {
  const have = await listTables(c);
  const policies = (await c.query(`select policyname from pg_policies where schemaname='public'`)).rows.map((r) => r.policyname as string);
  const funcs = (await c.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.map((r) => r.proname as string);
  const funcSrc = (await c.query(`select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('measure_publish','measure_publish_admin')`)).rows.map((r) => r.prosrc as string).join(' ');
  // Per-migration "already applied" hallmark (idempotent re-runs).
  const applied = (f: string): boolean =>
    f.includes('0005') ? have.includes('measures')
    : f.includes('0006') ? policies.includes('measures_read')
    : f.includes('0007') ? have.includes('objects')
    : f.includes('0008') ? have.includes('measure_versions')
    : f.includes('0009') ? funcs.includes('measure_publish_admin')
    : f.includes('0010') ? have.includes('library_versions')
    : f.includes('0011') ? funcSrc.includes('v_scope')
    : f.includes('0012') ? funcs.includes('measure_create')
    : false;
  for (const f of MIGRATIONS) {
    if (applied(f)) { console.log(`  ⤳ ${f}: skip (already applied)`); continue; }
    const sql = readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('commit');
      console.log(`  ✓ ${f}`);
    } catch (e) {
      await c.query('rollback');
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
}

async function upsert(c: Client, table: string, cols: string[], rows: unknown[][]) {
  if (!rows.length) return;
  const set = cols.filter((x) => x !== 'id').map((x) => `${x}=excluded.${x}`).join(', ');
  for (const r of rows) {
    const ph = r.map((_, i) => `$${i + 1}`).join(', ');
    await c.query(`insert into public.${table} (${cols.join(', ')}) values (${ph}) on conflict (id) do update set ${set}`, r);
  }
  console.log(`  ✓ ${table}: ${rows.length}`);
}

async function seedGraph(c: Client) {
  await upsert(c, 'objects', ['id', 'owner_id', 'name', 'kind', 'description', 'rules', 'lifetime_yrs'],
    g.objects.map((o) => [o.id, null, o.name, o.kind ?? null, o.description ?? null, o.rules ?? null, o.lifetimeYrs ?? null]));
  await upsert(c, 'resources', ['id', 'owner_id', 'name', 'unit'],
    g.resources.map((r) => [r.id, null, r.name, r.unit]));
  await upsert(c, 'products', ['id', 'owner_id', 'name', 'unit', 'service_unit', 'sector_ref', 'object_ref'],
    g.products.map((p) => [p.id, null, p.name, p.unit ?? null, p.service_unit ?? null, p.sector_ref ?? null, p.object_ref ?? null]));
  await upsert(c, 'refs', ['id', 'type', 'range_min', 'range_max', 'unit', 'source'],
    g.references.map((r) => [r.id, r.type ?? null, r.range[0], r.range[1], r.unit ?? null, r.source ? JSON.stringify(r.source) : null]));
  await upsert(c, 'pools', ['id', 'caps_ref', 'annual_flow', 'unit', 'sector_ref', 'baseline_emissions_kt'],
    g.pools.map((p) => [p.id, p.caps_ref ?? null, p.annual_flow, p.unit ?? null, p.sector_ref ?? null, p.baselineEmissionsKt ?? null]));
  await upsert(c, 'subsectors', ['id', 'sector_ref', 'name'],
    g.subsectors.map((s) => [s.id, s.sector_ref, s.name]));
  await upsert(c, 'indicators', ['id', 'key', 'owner_kind', 'owner_ref', 'value', 'unit', 'reference_ref', 'provenance'],
    g.indicators.map((i) => [i.id, i.key, i.owner_kind, i.owner_ref, i.value, i.unit ?? null, i.reference_ref ?? null, i.provenance ? JSON.stringify(i.provenance) : null]));
}

async function seedMeasures(c: Client) {
  const prof = await c.query(`select id from public.profiles order by created_at limit 1`);
  if (!prof.rows.length) {
    console.log('  ⚠ measures: SKIPPED — no profiles row yet (owner_id is NOT NULL). Sign in once, then re-run --seed.');
    return;
  }
  const owner = prof.rows[0].id as string;
  for (const m of measures) {
    await c.query(
      `insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data)
       values ($1,$2,$3::measure_scope,$4,$5,$6,$7::jsonb)
       on conflict (id) do update set scope=excluded.scope, sector=excluded.sector, maturity=excluded.maturity, schema_version=excluded.schema_version, data=excluded.data`,
      [m.id, owner, m.scope ?? 'draft', m.sector_ref ?? null, m.maturity_stage ?? null, m.schema_version ?? 1, JSON.stringify(m)],
    );
  }
  console.log(`  ✓ measures: ${measures.length} (owner ${owner})`);
}

async function main() {
  const client = new Client({ connectionString: loadDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const v = await client.query('select version()');
    console.log('Connected:', (v.rows[0].version as string).split(' ').slice(0, 2).join(' '));

    if (mode === '--check') {
      const names = await listTables(client);
      console.log(`public tables (${names.length}): ${names.join(', ')}`);
      const files = readdirSync(new URL('../supabase/migrations', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
      console.log(`local migrations: ${files.join(', ')}\n(--check only: nothing modified)`);
      return;
    }
    if (mode === '--migrate' || mode === '--all') { console.log('Migrating:'); await migrate(client); }
    if (mode === '--seed' || mode === '--all') {
      console.log('Seeding graph:'); await seedGraph(client);
      console.log('Seeding measures:'); await seedMeasures(client);
    }
    console.log('Done.');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
