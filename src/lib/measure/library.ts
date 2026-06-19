// Assemble the in-memory `Library` from the normalized graph (`graph.seed.json`)
// plus the checks/notation/globals/measures seed files. The graph is English-base
// with the Indicator as the hub; this loader DENORMALIZES each indicator value onto
// its owner (technology.capex_ud, resource.ef, …) so the engine keeps reading those
// fields unchanged (parity-safe), while keeping `library.indicators` for the hub.
//
// Storage of record is the graph (this seed today; the Supabase tables after
// migration 0007). A `name`/`description` is a plain English string in the graph; the
// loader lifts it into the `{ru,en}` shape the existing UI expects (English in both
// until the translation overlay lands — English-only for now). Relative JSON imports
// so this also runs under `tsx`/Node and Deno without tsconfig-path resolution.
import graph from '../../../data/kz/library/graph.seed.json';
import checks from '../../../data/kz/library/checks.json';
import uiHelp from '../../../data/kz/library/measure-ui-help.json';
import globals from '../../../data/kz/library/globals.json';
import measuresSeed from '../../../data/kz/library/measures.seed.json';
import { BUILTIN_TEMPLATES } from './templates';
import type {
  Indicator, Library, Localized, Measure, Pool, Product, Reference, Resource, Subsector, Technology,
} from './schema';

/** The normalized graph shape (graph.seed.json today; the Supabase tables via load-supabase.ts). */
export interface Graph {
  subsectors: Array<{ id: string; sector_ref: string; name: string }>;
  objects: Array<{ id: string; name: string; kind: Technology['kind']; description?: string; rules?: string; lifetimeYrs?: number }>;
  resources: Array<{ id: string; name: string; unit: string }>;
  products: Array<{ id: string; name: string; unit: string; service_unit?: string; sector_ref?: string; technology_ref?: string }>;
  references: Array<Reference>;
  indicators: Array<Indicator>;
  pools: Array<{ id: string; caps_ref: string; annual_flow: number; unit: string; sector_ref: string; baselineEmissionsKt?: number }>;
}

/** Lift an English string into the {ru,en} shape (English in both until translations land). */
const L = (en: string): Localized => ({ ru: en, en });

/**
 * Denormalize a graph into the in-memory `Library` (parity-safe: indicator values are
 * lifted back onto their owners so the engine reads technology.capex_ud / resource.ef
 * unchanged). The same function serves the file seed (below) and the Supabase loader,
 * so both sources produce an identical Library. The authority files (checks / ui-help /
 * globals / formula templates) are not in the graph — they are bundled here.
 */
export function assembleLibrary(g: Graph): Library {
  const indicators = g.indicators;
  const byOwner = (kind: string, ref: string) => indicators.filter((i) => i.owner_kind === kind && i.owner_ref === ref);
  const ind = (kind: string, ref: string, key: string) => byOwner(kind, ref).find((i) => i.key === key);

  const technologies: Record<string, Technology> = {};
  for (const o of g.objects) {
    const capex = ind('object', o.id, 'capex_ud');
    const maint = ind('object', o.id, 'maintenance_capex_ud');
    technologies[o.id] = {
      id: o.id, name: L(o.name), kind: o.kind,
      description: o.description ? L(o.description) : undefined,
      rules: o.rules ? L(o.rules) : undefined,
      lifetimeYrs: o.lifetimeYrs,
      capex_ud: capex?.value,
      capex_ud_unit: capex?.unit,
      capex_ud_reference_ref: capex?.reference_ref,
      maintenance_capex_ud: maint?.value,
      eff: ind('object', o.id, 'eff')?.value,
      indicators: byOwner('object', o.id)
        .filter((i) => !['capex_ud', 'maintenance_capex_ud'].includes(i.key))
        .map((i) => ({ key: i.key, label: L(i.key), value: i.value, unit: i.unit })),
    };
  }

  const resources: Record<string, Resource> = {};
  for (const r of g.resources) {
    resources[r.id] = {
      id: r.id, name: L(r.name), unit: r.unit,
      ef: ind('resource', r.id, 'ef')?.value ?? 0,
      price: ind('resource', r.id, 'price')?.value,
    };
  }

  const products: Record<string, Product> = {};
  for (const p of g.products) {
    const cf = ind('product', p.id, 'carbon_footprint');
    products[p.id] = {
      id: p.id, name: L(p.name), unit: p.unit, service_unit: p.service_unit,
      carbon_footprint: cf ? { value: cf.value, unit: cf.unit ?? '' } : undefined,
    };
  }

  const references: Record<string, Reference> = Object.fromEntries(g.references.map((r) => [r.id, r]));
  const pools: Record<string, Pool> = Object.fromEntries(
    g.pools.map((p) => [p.id, { ...p, sector: p.sector_ref as Pool['sector'] }]),
  );
  const subsectors: Record<string, Subsector[]> = {};
  for (const s of g.subsectors) (subsectors[s.sector_ref] ??= []).push({ id: s.id, label: L(s.name) });

  return {
    resources, technologies, products, references, pools,
    checks: checks as unknown as Library['checks'],
    indicators,
    subsectors,
    uiHelp: uiHelp as unknown as Library['uiHelp'],
    notation: uiHelp as unknown as Library['notation'], // TEMP alias for the MCP resource (removed step 4)
    // Templates live in code (the engine uses them); formula-templates.json mirrors them publicly.
    formulaTemplates: BUILTIN_TEMPLATES,
    globals: globals as unknown as Library['globals'],
  };
}

/** The published bundle the prototype resolves measures against (file seed; tests/golden use this). */
export const library: Library = assembleLibrary(graph as unknown as Graph);

/** The §11 seed measures (A=kz-20, B=kz-2, C=kz-16). */
export const seedMeasures: Measure[] = (measuresSeed as unknown as { measures: Measure[] }).measures;

export function getSeedMeasure(id: string): Measure | undefined {
  return seedMeasures.find((m) => m.id === id);
}
