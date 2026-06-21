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
import { compute, type ComputedMeasure } from '@/lib/measure/compute';
import { stackPools, validate } from '@/lib/measure/validate';
import { canonicalMeasureIds } from '@/lib/calc/measure-recalc';
import type { Library, Measure } from '@/lib/measure/schema';

/** `measures` = ALL published measures (canonical + extras): the full set is needed so pool
 *  stacking sees the canonical measures' claims when deciding which extras are displaced.
 *  Only the non-canonical ones are plotted (see computeExtras). */
export interface CommunityData { measures: Measure[]; library: Library }

/** The baked canonical curve owns every measure in the build-time bundle (kz-1…kz-27, incl
 *  drafts); only measures NOT yet baked are "extras" — i.e. ones published/edited after the
 *  last build, surfaced live until the next rebuild bakes them in. Avoids double-plotting. */
const FILE_IDS = canonicalMeasureIds;

/** Synthetic numeric MaccPoint id for an extra (the file model is keyed by number). */
const extraPointId = (measureId: string): number => 10000 + (Number(measureId.replace('kz-', '')) || 0);

/** Fetch the published extras + the library to compute them. Null on error/empty (→ file-only). */
export async function loadCommunityExtras(): Promise<CommunityData | null> {
  try {
    const db = getSupabase();
    const [library, all] = await Promise.all([loadLibrary(db), loadMeasures(db)]);
    // Keep the full published set (canonical + extras) for pool stacking; gate only on
    // whether any non-canonical extra exists (else the curve stays the file dataset).
    const hasExtras = all.some((m) => !FILE_IDS.has(m.id));
    return hasExtras ? { measures: all, library } : null;
  } catch {
    return null; // backend down / not configured → the curve stays the file dataset
  }
}

/** Apply the live levers to the library so extras recompute with the sliders (WACC via the
 *  discount rate; the fuel-price levers map onto resource prices for price-bound economics). */
function leveredLibrary(library: Library, levers: Levers): Library {
  const priceById: Record<string, number> = {
    coal: levers.coalPrice, gas: levers.gasPrice, electricity: levers.electricityPrice,
  };
  const resources = { ...library.resources };
  for (const [id, price] of Object.entries(priceById)) {
    if (resources[id]) resources[id] = { ...resources[id], price };
  }
  // A `res:<id>#price` ref resolves through library.indicators (the §1 hub), so the lever
  // must update the indicator too — not just the denormalized resources[id].price field.
  const indicators = library.indicators.map((ind) =>
    ind.owner_kind === 'resource' && ind.key === 'price' && priceById[ind.owner_ref] !== undefined
      ? { ...ind, value: priceById[ind.owner_ref] } : ind);
  return { ...library, resources, indicators, globals: { ...library.globals, discountRate: levers.discountRate } };
}

/** Compute the extras into plottable MaccPoints at the given levers (skips any that error).
 *  Pool displacement is decided over the FULL published set so an extra is marked
 *  `displaced` when cheaper peers (incl. the canonical measures) already claim its pool
 *  ceiling; only the non-canonical extras are returned for plotting. */
export function computeExtras(data: CommunityData, levers: Levers): MaccPoint[] {
  const lib = leveredLibrary(data.library, levers);

  // Compute every measure once; a malformed/unresolvable one is skipped (never breaks the curve).
  const computed: ComputedMeasure[] = [];
  const computedById = new Map<string, ComputedMeasure>();
  const measureById = new Map<string, Measure>();
  for (const m of data.measures) {
    try {
      const c = compute(m, lib);
      computed.push(c);
      computedById.set(m.id, c);
      measureById.set(m.id, m);
    } catch {
      // skip — see above
    }
  }

  // Render-time pool allocation over the full set (canonical + extras); scenario-dependent.
  const alloc = stackPools(computed, measureById, lib);

  const out: MaccPoint[] = [];
  for (const m of data.measures) {
    if (FILE_IDS.has(m.id)) continue; // canonical ids are already plotted from the file curve
    const c = computedById.get(m.id);
    if (!c) continue;
    // Gate C: only `готово` measures (eligibleForModel) belong on the trusted curve — a
    // DB row marked published but failing the script (e.g. kz-27's CAPEX=0) is never plotted.
    // Eligibility is peer-independent (pool competition no longer gates), so no peers needed.
    let eligible = false;
    try { eligible = validate(m, lib, []).eligibleForModel; } catch { eligible = false; }
    if (!eligible) continue;
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
      displaced: alloc.get(m.id)?.clipped ?? false,
      capexItems: [],
      opexItems: [],
      physicalItems: [],
      localInputs: [],
    });
  }
  return out;
}
