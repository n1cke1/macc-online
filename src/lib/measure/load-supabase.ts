// Stage C — load the authoring library + measures from Supabase at runtime (the
// authority graph in the 0007 tables), instead of the bundled JSON seed. Imported
// only by the lazy/flagged authoring chunk (never the static core). The same
// `assembleLibrary` denormalizer used by the file seed runs here, so a DB-loaded
// Library is identical to the file one (verified by scripts/stage-c-check.ts).
//
// Reads use the anonymous client: the graph tables are world-readable (0007 RLS).
// Measures: only `published` rows are anon-visible (drafts need the owner session),
// so the editor merges DB measures with the file seed per id until auth is wired.
import type { SupabaseClient } from '@supabase/supabase-js';
import { assembleLibrary, type Graph } from './library';
import type { Library, Measure } from './schema';

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

export async function loadLibrary(db: SupabaseClient): Promise<Library> {
  const tables = ['objects', 'resources', 'products', 'refs', 'subsectors', 'indicators'] as const;
  const [objects, resources, products, refs, subsectors, indicators] = await Promise.all(
    tables.map((t) => db.from(t).select('*')),
  );
  for (const [i, r] of [objects, resources, products, refs, subsectors, indicators].entries()) {
    if (r.error) throw new Error(`load ${tables[i]}: ${r.error.message}`);
  }
  // L3 — the dimensional vocabulary + bridge overlay. Tolerate the tables not existing yet
  // (pre-migration): an error → empty overlay, so the code seed still provides the base set.
  const [units, bridges] = await Promise.all([db.from('units').select('*'), db.from('bridges').select('*')]);
  const unitRows = units.error ? [] : (units.data ?? []);
  const bridgeRows = bridges.error ? [] : (bridges.data ?? []);
  const graph: Graph = {
    objects: (objects.data ?? []).map((o) => ({
      id: o.id, name: o.name, kind: o.kind, description: o.description ?? undefined,
      rules: o.rules ?? undefined, lifetimeYrs: o.lifetime_yrs != null ? num(o.lifetime_yrs) : undefined,
    })),
    resources: (resources.data ?? []).map((r) => ({ id: r.id, name: r.name, unit: r.unit })),
    products: (products.data ?? []).map((p) => ({
      id: p.id, name: p.name, unit: p.unit, service_unit: p.service_unit ?? undefined,
      sector_ref: p.sector_ref ?? undefined, technology_ref: p.technology_ref ?? undefined,
    })),
    references: (refs.data ?? []).map((r) => ({
      id: r.id, type: r.type ?? '', range: [num(r.range_min), num(r.range_max)], unit: r.unit ?? '', source: r.source ?? undefined,
    })),
    subsectors: (subsectors.data ?? []).map((s) => ({ id: s.id, sector_ref: s.sector_ref, name: s.name })),
    indicators: (indicators.data ?? []).map((i) => ({
      id: i.id, key: i.key, owner_kind: i.owner_kind, owner_ref: i.owner_ref,
      value: num(i.value), unit: i.unit ?? undefined, reference_ref: i.reference_ref ?? undefined, provenance: i.provenance ?? undefined,
    })),
    units: unitRows.map((u) => ({ id: u.id, dim: u.dim ?? {}, scale: num(u.scale) })),
    bridges: bridgeRows.map((b) => ({
      id: b.id, from: b.from, via: b.via ?? [], to: b.to, expr: b.expr,
      carrier_rule: b.carrier_rule ?? undefined, authoring: b.authoring ?? '',
    })),
  };
  return assembleLibrary(graph);
}

/** Anon-visible measures (published only, per RLS) as full Measure documents. */
export async function loadMeasures(db: SupabaseClient): Promise<Measure[]> {
  const { data, error } = await db.from('measures').select('data');
  if (error) throw new Error(`load measures: ${error.message}`);
  return (data ?? []).map((r) => r.data as Measure);
}
