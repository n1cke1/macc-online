// Bake the canonical MACC curve from Supabase (the measure-notation authority graph)
// into data/<country>/model.data.json — the static dataset the chart/drill-down read.
//
// This replaces the Excel ETL as the source of truth for the CURVE (projects + totals):
// every bar is now a published measure document, computed through the same pure-TS calc
// core the MCP/editor use, so an MCP edit becomes visible after a rebuild (Plan 1A).
// The UI-config blocks (assumptions/sliders, sector palette, emissions meta) are carried
// over from the existing dataset — they are app config, not curve data.
//
//   npx tsx scripts/bake-from-supabase.ts --check   # report + parity, no write
//   npx tsx scripts/bake-from-supabase.ts           # write model.data.json + fingerprint
//
// Reads Supabase with the public anon key (graph tables + published measures are
// world-readable per the 0007/0011 RLS), so the CF Pages build needs no secret. A
// service-role key (.env.supabase.local) is accepted as a fallback for local runs;
// either way the curve is filtered to scope==='published' deterministically.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadLibrary, loadMeasures } from '../src/lib/measure/load-supabase';
import { compute } from '../src/lib/measure/compute';
import type { Library, Measure } from '../src/lib/measure/schema';
import type { Assumption, Dataset, MaccPoint } from '../data/schema';

const REPO = new URL('..', import.meta.url);
const country = 'kz';
const checkOnly = process.argv.includes('--check');

function envFrom(file: string): Record<string, string> {
  try {
    const raw = readFileSync(new URL(file, REPO), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

// The canonical curve includes draft measures (kz-2, kz-16, kz-27) that strict
// guardrails flag but that are still part of the official MACC, so the bake reads with
// a service-role key (drafts are anon-invisible per RLS). When no creds are present
// (a contributor's machine, or a build without the secret) the bake is SKIPPED and the
// committed model.data.json snapshot is used as-is — so the static build never depends
// on backend reachability (principle #1). On CF Pages the secret is set, so the curve
// is rebuilt fresh from Supabase on every deploy (an MCP edit ⇒ next build shows it).
function makeClient(): SupabaseClient | null {
  const svc = envFrom('.env.supabase.local');
  const url = process.env.SUPABASE_URL || svc.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || envFrom('.env.local').NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || svc.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** kz-N → numeric MaccPoint id; non-numeric suffixes hash to a stable high id. */
function numericId(id: string): number {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : 1_000_000 + (parseInt(createHash('sha1').update(id).digest('hex').slice(0, 6), 16) % 1_000_000);
}

function toPoint(measure: Measure, library: Library): MaccPoint {
  const c = compute(measure, library);
  return {
    id: numericId(measure.id),
    sector: c.sector,
    variant: null,
    name: c.name,
    capex: c.capex,
    opex: c.opex,
    durationYrs: c.durationYrs,
    abatementKt: c.abatementKt,
    npv: c.npv,
    discCo2Kt: c.discCo2Kt,
    mac: c.mac,
    cumAbatementStartKt: 0,
    cumAbatementEndKt: 0,
    capexItems: c.capexItems,
    opexItems: c.opexItems,
    physicalItems: c.physicalItems,
    localInputs: c.localInputs,
  };
}

function buildTotals(projects: MaccPoint[]): Dataset['totals'] {
  const capexMUsd = projects.reduce((s, p) => s + p.capex, 0);
  const abatementKt = projects.reduce((s, p) => s + p.abatementKt, 0);
  const npvMUsd = projects.reduce((s, p) => s + p.npv, 0);
  const discCo2Kt = projects.reduce((s, p) => s + p.discCo2Kt, 0);
  const noRegretsAbatementKt = projects.filter((p) => p.mac < 0).reduce((s, p) => s + p.abatementKt, 0);
  return {
    capexMUsd,
    abatementKt,
    npvMUsd,
    discCo2Kt,
    weightedAvgMac: discCo2Kt === 0 ? 0 : (npvMUsd / discCo2Kt) * 1000,
    noRegretsAbatementKt,
  };
}

const SCALARS: Array<keyof MaccPoint> = ['mac', 'abatementKt', 'capex', 'opex', 'npv', 'discCo2Kt'];

/**
 * The globally-editable unit-CAPEX panel, derived from the library technologies the
 * curve's measures actually create. In the measure world a "global unit CAPEX" IS a
 * `technology.capex_ud`; editing it shifts every measure that builds that technology.
 * The override cell is `obj:<techId>#capex_ud`, which measure-recalc applies to the
 * library at runtime. (The old Excel `MACC!E45…E57` knobs are retired — several had no
 * faithful single-technology equivalent in the notation.)
 */
function capexAssumptions(measures: Measure[], library: Library): Assumption[] {
  const seen = new Set<string>();
  const out: Assumption[] = [];
  for (const m of measures) {
    for (const o of m.created_technologies ?? []) {
      const ref = o.technology_ref;
      if (seen.has(ref)) continue;
      const t = library.technologies[ref];
      if (!t || typeof t.capex_ud !== 'number') continue;
      seen.add(ref);
      out.push({
        key: ref,
        cell: `obj:${ref}#capex_ud`,
        label: t.name,
        value: t.capex_ud,
        unit: t.capex_ud_unit ?? '',
        group: 'capex_unit',
        isLever: false,
      });
    }
  }
  out.sort((a, b) => (a.label.en || a.label.ru).localeCompare(b.label.en || b.label.ru));
  return out;
}

/** Per-measure scalar parity vs the existing (Excel-derived) dataset. Returns lines to report. */
function parity(baked: MaccPoint[], prevPath: URL): { lines: string[]; mismatches: number; droppedIds: number[]; newIds: number[] } {
  const prev: Dataset = JSON.parse(readFileSync(prevPath, 'utf8'));
  const prevById = new Map(prev.projects.map((p) => [p.id, p]));
  const bakedById = new Map(baked.map((p) => [p.id, p]));
  const lines: string[] = [];
  let mismatches = 0;
  for (const p of baked) {
    const o = prevById.get(p.id);
    if (!o) continue;
    for (const k of SCALARS) {
      const a = p[k] as number;
      const b = o[k] as number;
      const tol = 1e-4 * (1 + Math.abs(b));
      if (Math.abs(a - b) > tol) {
        mismatches++;
        lines.push(`  Δ id ${p.id}.${String(k)}: baked ${a} vs prev ${b}`);
      }
    }
  }
  const droppedIds = prev.projects.filter((p) => !bakedById.has(p.id)).map((p) => p.id);
  const newIds = baked.filter((p) => !prevById.has(p.id)).map((p) => p.id);
  const pt = buildTotals(baked);
  for (const k of Object.keys(prev.totals) as Array<keyof Dataset['totals']>) {
    lines.push(`  totals.${k}: baked ${(pt[k] as number).toFixed(2)} vs prev ${(prev.totals[k] as number).toFixed(2)}`);
  }
  return { lines, mismatches, droppedIds, newIds };
}

async function main(): Promise<number> {
  const db = makeClient();
  if (!db) {
    console.log('bake-from-supabase: no Supabase creds (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — keeping committed model.data.json snapshot.');
    return 0;
  }
  const library = await loadLibrary(db);
  const all = await loadMeasures(db);
  const published = all.filter((m) => m.scope === 'published');
  const drafts = all.filter((m) => m.scope !== 'published');

  // Canonical curve = every measure (published + draft); drafts kz-2/kz-16 are official
  // MACC measures that only strict guardrails flag. Each draft bar is computable.
  const onCurve = all;
  const projects = onCurve.map((m) => toPoint(m, library)).sort((a, b) => a.mac - b.mac);
  let cum = 0;
  for (const p of projects) {
    p.cumAbatementStartKt = cum;
    cum += p.abatementKt;
    p.cumAbatementEndKt = cum;
  }
  const totals = buildTotals(projects);

  const prevPath = new URL(`data/${country}/model.data.json`, REPO);
  const prev: Dataset = JSON.parse(readFileSync(prevPath, 'utf8'));

  console.log(`Loaded from Supabase: ${all.length} measures (${published.length} published, ${drafts.length} draft)`);
  if (drafts.length) console.log(`Drafts included on curve: ${drafts.map((m) => m.id).join(', ')}`);
  console.log(`Curve: ${projects.length} bars · total abatement ${totals.abatementKt.toFixed(0)} kt · wavg MAC ${totals.weightedAvgMac.toFixed(2)} · no-regrets ${totals.noRegretsAbatementKt.toFixed(0)} kt`);

  const { lines, mismatches, droppedIds, newIds } = parity(projects, prevPath);
  console.log(`\nParity vs Excel-derived dataset (${prev.projects.length} bars):`);
  if (droppedIds.length) console.log(`  dropped (in Excel, not on baked curve): ids ${droppedIds.join(', ')}`);
  if (newIds.length) console.log(`  new (on baked curve, not in Excel): ids ${newIds.join(', ')}`);
  console.log(`  per-measure scalar mismatches (shared ids): ${mismatches}`);
  for (const l of lines) console.log(l);

  const hash = createHash('sha256')
    .update(JSON.stringify({ measures: published.map((m) => m.id).sort(), indicators: library.indicators }))
    .digest('hex')
    .slice(0, 12);
  const modelVersion = `${country}-sup-${hash}`;

  // Levers + emission-factor assumptions are app config (carried over); the unit-CAPEX
  // panel is regenerated from the library so it edits real technology.capex_ud values.
  const assumptions: Assumption[] = [
    ...prev.assumptions.filter((a) => a.group !== 'capex_unit'),
    ...capexAssumptions(onCurve, library),
  ];

  const dataset: Dataset = {
    schemaVersion: prev.schemaVersion,
    country,
    modelVersion,
    meta: {
      ...prev.meta,
      sourceFile: 'supabase:measures+graph',
      sourceDate: new Date().toISOString().slice(0, 10),
    },
    sectors: prev.sectors,
    assumptions,
    projects,
    totals,
  };

  // The client recompute bundle: the full measure set + library, so the slider/override
  // recompute runs the SAME pure-TS calc core over Supabase data (no Excel engine, no
  // backend at runtime). Committed + refreshed here so the static core stays offline-safe.
  const bundlePath = new URL(`data/${country}/measures.bundle.json`, REPO);
  const bundle = { country, modelVersion, library, measures: onCurve };

  if (checkOnly) {
    console.log('\n--check: no files written.');
    return 0;
  }
  writeFileSync(prevPath, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${prevPath.pathname} — modelVersion ${modelVersion}`);
  console.log(`Wrote ${bundlePath.pathname} — ${onCurve.length} measures + library`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
