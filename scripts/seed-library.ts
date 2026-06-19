// Seed the normalized library graph (0007 tables) from data/kz/library/graph.seed.json
// — the single source of truth. Run AFTER `supabase db push`, with the service-role
// key (bypasses RLS to write the authority/base rows):
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt> \
//   npx tsx scripts/seed-library.ts
//
// Idempotent (upsert by id). English base only; the `translations` overlay is seeded
// separately when the translation layer lands.
import { createClient } from '@supabase/supabase-js';
import graph from '../data/kz/library/graph.seed.json';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

interface Graph {
  subsectors: Array<{ id: string; sector_ref: string; name: string }>;
  objects: Array<{ id: string; name: string; kind?: string; description?: string; rules?: string; lifetimeYrs?: number }>;
  resources: Array<{ id: string; name: string; unit: string }>;
  products: Array<{ id: string; name: string; unit: string; service_unit?: string; sector_ref?: string; technology_ref?: string }>;
  references: Array<{ id: string; type?: string; range: [number, number]; unit?: string; source?: unknown }>;
  indicators: Array<{ id: string; key: string; owner_kind: string; owner_ref: string; value: number; unit?: string; reference_ref?: string; provenance?: unknown }>;
  pools: Array<{ id: string; caps_ref?: string; annual_flow: number; unit?: string; sector_ref?: string; baselineEmissionsKt?: number }>;
}
const g = graph as unknown as Graph;

async function upsert(table: string, rows: unknown[]) {
  const { error } = await db.from(table).upsert(rows as never);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ✓ ${table}: ${rows.length}`);
}

async function main() {
  console.log('Seeding library graph →', url);
  // objects first (products.technology_ref / indicators.owner_ref reference them); refs before indicators.
  await upsert('objects', g.objects.map((o) => ({
    id: o.id, owner_id: null, name: o.name, kind: o.kind ?? null,
    description: o.description ?? null, rules: o.rules ?? null, lifetime_yrs: o.lifetimeYrs ?? null,
  })));
  await upsert('resources', g.resources.map((r) => ({ id: r.id, owner_id: null, name: r.name, unit: r.unit })));
  await upsert('products', g.products.map((p) => ({
    id: p.id, owner_id: null, name: p.name, unit: p.unit ?? null,
    service_unit: p.service_unit ?? null, sector_ref: p.sector_ref ?? null, technology_ref: p.technology_ref ?? null,
  })));
  await upsert('refs', g.references.map((r) => ({
    id: r.id, type: r.type ?? null, range_min: r.range[0], range_max: r.range[1], unit: r.unit ?? null, source: r.source ?? null,
  })));
  await upsert('pools', g.pools.map((p) => ({
    id: p.id, caps_ref: p.caps_ref ?? null, annual_flow: p.annual_flow, unit: p.unit ?? null,
    sector_ref: p.sector_ref ?? null, baseline_emissions_kt: p.baselineEmissionsKt ?? null,
  })));
  await upsert('subsectors', g.subsectors.map((s) => ({ id: s.id, sector_ref: s.sector_ref, name: s.name })));
  await upsert('indicators', g.indicators.map((i) => ({
    id: i.id, key: i.key, owner_kind: i.owner_kind, owner_ref: i.owner_ref,
    value: i.value, unit: i.unit ?? null, reference_ref: i.reference_ref ?? null, provenance: i.provenance ?? null,
  })));
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
