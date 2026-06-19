// Community overlay — published measures authored through the collaboration layer
// (Supabase) that are NOT part of the file dataset (ids beyond the canonical kz-1…kz-26),
// surfaced on the main curve for EVERYONE incl. anonymous visitors.
//
// This module is LAZY (dynamically imported by the store): it is the only overlay path
// that pulls in @supabase/supabase-js + the measure calc engine, so the static core's
// First Load stays free of both (principle #1: the curve renders the bundled file
// dataset first; this enriches it when the backend is reachable, and silently degrades
// to file-only when it is not).
import type { Levers, MaccPoint, SectorCode } from '@data/schema';
import { getSupabase } from '@/lib/supabase/client';
import { loadLibrary, loadMeasures } from '@/lib/measure/load-supabase';
import { compute } from '@/lib/measure/compute';
import type { Library, Measure } from '@/lib/measure/schema';

export interface CommunityData { measures: Measure[]; library: Library }

/** The canonical file curve owns kz-1…kz-26; only ids beyond that are "extras". */
const FILE_IDS = new Set(Array.from({ length: 26 }, (_, i) => `kz-${i + 1}`));

/** Synthetic numeric MaccPoint id for an extra (the file model is keyed by number). */
const extraPointId = (measureId: string): number => 10000 + (Number(measureId.replace('kz-', '')) || 0);

/** Fetch the published extras + the library to compute them. Null on error/empty (→ file-only). */
export async function loadCommunityExtras(): Promise<CommunityData | null> {
  try {
    const db = getSupabase();
    const [library, all] = await Promise.all([loadLibrary(db), loadMeasures(db)]);
    const measures = all.filter((m) => !FILE_IDS.has(m.id)); // published, minus the canonical 26
    return measures.length ? { measures, library } : null;
  } catch {
    return null; // backend down / not configured → the curve stays the file dataset
  }
}

/** Apply the live levers to the library so extras recompute with the sliders (WACC via the
 *  discount rate; the fuel-price levers map onto resource prices for price-bound economics). */
function leveredLibrary(library: Library, levers: Levers): Library {
  const resources = { ...library.resources };
  const setPrice = (id: string, price: number) => { if (resources[id]) resources[id] = { ...resources[id], price }; };
  setPrice('coal', levers.coalPrice);
  setPrice('gas', levers.gasPrice);
  setPrice('electricity', levers.electricityPrice);
  return { ...library, resources, globals: { ...library.globals, discountRate: levers.discountRate } };
}

/** Compute the extras into plottable MaccPoints at the given levers (skips any that error). */
export function computeExtras(data: CommunityData, levers: Levers): MaccPoint[] {
  const lib = leveredLibrary(data.library, levers);
  const out: MaccPoint[] = [];
  for (const m of data.measures) {
    try {
      const c = compute(m, lib);
      out.push({
        id: extraPointId(m.id),
        sector: c.sector as SectorCode,
        variant: null,
        name: c.name,
        capex: c.capex,
        opex: c.opex,
        durationYrs: c.durationYrs,
        abatementKt: c.abatementKt,
        npv: c.npv,
        discCo2Kt: c.discCo2Kt,
        mac: c.mac,
        cumAbatementStartKt: 0, // the chart recomputes the cumulative span from merit order
        cumAbatementEndKt: c.abatementKt,
        capexItems: [],
        opexItems: [],
        physicalItems: [],
        localInputs: [],
      });
    } catch {
      // a malformed/unresolvable extra is skipped rather than breaking the whole curve
    }
  }
  return out;
}
