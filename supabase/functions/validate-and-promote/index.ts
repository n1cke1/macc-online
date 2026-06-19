// Supabase Edge Function: server-authoritative promotion of a measure to
// `published`. Clients can never set scope=published (RLS + the scope guard in
// 0006); only this function may, and only after re-running the §7 guardrails
// independently of the client.
//
// It reuses the SAME stored check ASTs (library/checks.json) and the pure-TS
// guardrail evaluator (src/lib/measure/guardrails.ts) the app uses — no
// HyperFormula here (guardrails need no PV), so the bundle stays Deno-clean.
// `measure-golden` pins that pure-TS path equal to the HF validate().
//
// Secrets (provided automatically in prod): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { runGuardrails } from '../../../src/lib/measure/guardrails.ts';
import { BUILTIN_TEMPLATES } from '../../../src/lib/measure/templates.ts';
import type { Indicator, Library, Measure } from '../../../src/lib/measure/schema.ts';

// Normalized library graph (English base) — bundled trust anchor. Stage B will move
// this read to the Supabase graph tables; for now it mirrors the app loader.
import graph from '../../../data/kz/library/graph.seed.json' with { type: 'json' };
import checks from '../../../data/kz/library/checks.json' with { type: 'json' };
import uiHelp from '../../../data/kz/library/measure-ui-help.json' with { type: 'json' };
import globals from '../../../data/kz/library/globals.json' with { type: 'json' };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Denormalize the graph into the in-memory Library (mirrors src/lib/measure/library.ts). */
function buildLibrary(): Library {
  // deno-lint-ignore no-explicit-any
  const g = graph as any;
  const inds = g.indicators as Indicator[];
  const L = (en: string) => ({ ru: en, en });
  const ind = (k: string, ref: string, key: string) =>
    inds.find((i) => i.owner_kind === k && i.owner_ref === ref && i.key === key);

  const technologies: Record<string, unknown> = {};
  for (const o of g.objects) {
    const capex = ind('object', o.id, 'capex_ud');
    technologies[o.id] = {
      id: o.id, name: L(o.name), kind: o.kind, lifetimeYrs: o.lifetimeYrs,
      capex_ud: capex?.value, capex_ud_reference_ref: capex?.reference_ref,
      maintenance_capex_ud: ind('object', o.id, 'maintenance_capex_ud')?.value,
      eff: ind('object', o.id, 'eff')?.value,
    };
  }
  const resources: Record<string, unknown> = {};
  for (const r of g.resources) {
    resources[r.id] = { id: r.id, name: L(r.name), unit: r.unit, ef: ind('resource', r.id, 'ef')?.value ?? 0, price: ind('resource', r.id, 'price')?.value };
  }
  const products: Record<string, unknown> = {};
  for (const p of g.products) products[p.id] = { id: p.id, name: L(p.name), unit: p.unit };
  const subsectors: Record<string, unknown[]> = {};
  for (const s of g.subsectors) (subsectors[s.sector_ref] ??= []).push({ id: s.id, label: L(s.name) });

  return {
    resources, technologies, products,
    references: Object.fromEntries(g.references.map((r: { id: string }) => [r.id, r])),
    pools: Object.fromEntries(g.pools.map((p: { id: string; sector_ref: string }) => [p.id, { ...p, sector: p.sector_ref }])),
    checks, indicators: inds, subsectors, uiHelp, notation: uiHelp, formulaTemplates: BUILTIN_TEMPLATES, globals,
  } as unknown as Library;
}

Deno.serve(async (req) => {
  try {
    const { measure_id } = await req.json();
    if (!measure_id) return json({ error: 'missing measure_id' }, 400);

    const { data: row, error } = await admin.from('measures').select('*').eq('id', measure_id).single();
    if (error || !row) return json({ error: 'measure not found' }, 404);

    const library = buildLibrary();
    const measure = row.data as Measure;

    // Peers (for the pool-combination sum): every other measure.
    const { data: all } = await admin.from('measures').select('id, data');
    const peers = (all ?? []).filter((r) => r.id !== measure_id).map((r) => r.data as Measure);

    const g = runGuardrails(measure, library, peers);

    if (!g.eligible) {
      return json({ promoted: false, scope: row.scope, checks: g.checks });
    }

    // Eligible → promote. Service role + the scope guard allows scope=published.
    const { error: upErr } = await admin
      .from('measures')
      .update({ scope: 'published', review_status: 'accepted' })
      .eq('id', measure_id);
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ promoted: true, scope: 'published', checks: g.checks });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
