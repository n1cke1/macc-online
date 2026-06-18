'use client';
// Heavy authoring store — lives in the lazily-loaded authoring chunk because it
// imports the §2 schema, the AST→HF calc core and (transitively) HyperFormula.
// Never import this from the static core; the chart reads the lightweight
// `useDraftOverlay` bridge instead (see src/store.ts).
//
// Stage C: the library + measures are LOADED FROM SUPABASE at runtime (init()),
// not the bundled seed. The file seed is a resilience fallback (and the source for
// draft measures the anon client can't read until auth is wired).
import { create } from 'zustand';
import { library as fileLibrary, seedMeasures } from '@/lib/measure/library';
import { loadLibrary, loadMeasures } from '@/lib/measure/load-supabase';
import { getSupabase } from '@/lib/supabase/client';
import { compute, type ComputedMeasure } from '@/lib/measure/compute';
import { validate, type ValidateResult } from '@/lib/measure/validate';
import type { Library, Measure } from '@/lib/measure/schema';
import { useDraftOverlay } from '@/store';

/** Curve id (`MaccPoint.id`) a seed maps to, so the chart can de-dupe its bar. */
function linkedCurveId(measureId: string): number | null {
  const m = /(\d+)$/.exec(measureId);
  return m ? Number(m[1]) : null;
}

interface MeasureDraftState {
  ready: boolean;
  source: 'supabase' | 'file-fallback' | null;
  initError: string | null;
  library: Library | null;
  measures: Measure[];
  activeId: string | null;
  measure: Measure | null;
  computed: ComputedMeasure | null;
  validation: ValidateResult | null;
  error: string | null;
  /** Load the library + measures from Supabase (once); falls back to the file seed on error. */
  init: () => Promise<void>;
  /** Re-fetch measures with the current (possibly now-authenticated) session — drafts appear after sign-in. */
  reloadMeasures: () => Promise<void>;
  /** Load a measure into the editable draft and recompute. */
  load: (id: string) => void;
  /** Mutate the working copy (a deep clone) via `fn`, then recompute. */
  update: (fn: (m: Measure) => void) => void;
  /** Clear the draft and remove its overlay bar. */
  clear: () => void;
}

function recompute(measure: Measure, library: Library, measures: Measure[]): Pick<MeasureDraftState, 'computed' | 'validation' | 'error'> {
  try {
    const peers = measures.filter((m) => m.id !== measure.id);
    const computed = compute(measure, library);
    const validation = validate(measure, library, peers);
    useDraftOverlay.getState().setBar({
      linkedId: linkedCurveId(measure.id),
      sector: computed.sector,
      name: computed.name,
      mac: computed.mac,
      abatementKt: validation.potential, // pool-clipped potential
      warn: Object.values(validation.checks).some((s) => s === 'warn'),
    });
    return { computed, validation, error: null };
  } catch (e) {
    return { computed: null, validation: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Merge DB measures over the file seed by id (DB wins; seed fills anon-hidden drafts). */
function mergeMeasures(db: Measure[]): Measure[] {
  const byId = new Map<string, Measure>(seedMeasures.map((m) => [m.id, m]));
  for (const m of db) byId.set(m.id, m);
  return [...byId.values()];
}

export const useMeasureDraft = create<MeasureDraftState>((set, get) => ({
  ready: false,
  source: null,
  initError: null,
  library: null,
  measures: [],
  activeId: null,
  measure: null,
  computed: null,
  validation: null,
  error: null,
  init: async () => {
    if (get().ready) return;
    try {
      const db = getSupabase();
      const [library, dbMeasures] = await Promise.all([loadLibrary(db), loadMeasures(db)]);
      set({ ready: true, source: 'supabase', library, measures: mergeMeasures(dbMeasures), initError: null });
    } catch (e) {
      // Resilience: keep the editor usable on the bundled seed, but surface that it's a fallback.
      set({ ready: true, source: 'file-fallback', library: fileLibrary, measures: seedMeasures, initError: e instanceof Error ? e.message : String(e) });
    }
  },
  reloadMeasures: async () => {
    if (get().source !== 'supabase') return; // file-fallback: nothing to refresh
    try {
      const dbMeasures = await loadMeasures(getSupabase());
      set({ measures: mergeMeasures(dbMeasures) });
    } catch { /* keep current measures on a transient read error */ }
  },
  load: (id) => {
    const { measures, library } = get();
    const found = measures.find((m) => m.id === id);
    if (!found || !library) return;
    const measure = structuredClone(found);
    set({ activeId: id, measure, ...recompute(measure, library, measures) });
  },
  update: (fn) => {
    const { measure: cur, library, measures } = get();
    if (!cur || !library) return;
    const measure = structuredClone(cur);
    fn(measure);
    set({ measure, ...recompute(measure, library, measures) });
  },
  clear: () => {
    useDraftOverlay.getState().setBar(null);
    set({ activeId: null, measure: null, computed: null, validation: null, error: null });
  },
}));
