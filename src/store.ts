'use client';
import { create } from 'zustand';
import type { MaccPoint, DatasetTotals, Levers } from '@data/schema';
import type { ProjectOverrides } from '@/lib/calc';
import type { CommunityData } from '@/lib/community/extras';
import { projects as baselineProjects, totals as baselineTotals } from '@/lib/data';
import { BASELINE_LEVERS, isBaseline } from '@/lib/scenario';

// ── View state (selection + sector filter) ───────────────────────────────────
interface UiState {
  selectedId: number | null;
  /** The right-hand summary panel is shown for the selection. Decoupled from
   *  `selectedId` so its ✕ can hide just that panel while the (full-width) measure
   *  drill-down below the table keeps the selection. Re-selecting a bar reopens it. */
  rightOpen: boolean;
  select: (id: number | null) => void;
  closeRight: () => void;
  hiddenSectors: Set<string>;
  toggleSector: (code: string) => void;
  /** Show measures whose pool share is displaced (clipped by cheaper peers). Off by
   *  default — displaced measures don't make the trusted curve until capacity frees up. */
  showDisplaced: boolean;
  toggleDisplaced: () => void;
}

export const useUi = create<UiState>((set) => ({
  selectedId: null,
  rightOpen: false,
  select: (id) => set({ selectedId: id, rightOpen: id != null }),
  closeRight: () => set({ rightOpen: false }),
  hiddenSectors: new Set<string>(),
  toggleSector: (code) =>
    set((s) => {
      const next = new Set(s.hiddenSectors);
      next.has(code) ? next.delete(code) : next.add(code);
      return { hiddenSectors: next };
    }),
  showDisplaced: false,
  toggleDisplaced: () => set((s) => ({ showDisplaced: !s.showDisplaced })),
}));

// ── Draft-overlay bridge (lightweight; safe to import in the static core) ────
// The authoring layer (a lazy chunk that pulls in HyperFormula) computes the
// draft measure and pushes ONLY its plottable result here. The chart reads it to
// splice a draft bar into the curve. Kept free of any calc import so importing it
// from MaccChart never bundles HyperFormula into the core (bundle hygiene).
export interface DraftBar {
  /** Curve id of the measure this draft edits, so the chart can de-dupe it. */
  linkedId: number | null;
  sector: string;
  name: { ru: string; en: string };
  mac: number;
  abatementKt: number;
  /** From validate(): true while a guardrail flags the draft (styled as ⚠). */
  warn: boolean;
}
interface DraftOverlayState {
  bar: DraftBar | null;
  setBar: (bar: DraftBar | null) => void;
  /** Whether the authoring editor is expanded — the chart shows the draft bar only then
   * (so a collapsed editor has no side-effect on the curve). */
  editorOpen: boolean;
  setEditorOpen: (open: boolean) => void;
}
export const useDraftOverlay = create<DraftOverlayState>((set) => ({
  bar: null,
  setBar: (bar) => set({ bar }),
  editorOpen: false,
  setEditorOpen: (editorOpen) => set({ editorOpen }),
}));

// ── Scenario state (live levers + per-measure overrides + recomputed curve) ──
// The curve starts as the bundled baseline (golden) data — no engine needed for
// the first paint. Moving a lever OR editing a per-measure assumption in the
// drill-down lazy-loads src/lib/calc (HyperFormula) and recomputes. Overrides
// live in memory for the session only; not persisted, not URL-encoded yet.
// `recomputeToken` guards against out-of-order async results.
interface ScenarioState {
  levers: Levers;
  /** Per-measure cell overrides keyed by provenance ref ("Расчёты!C8"). */
  overrides: ProjectOverrides;
  /** The plotted curve = file dataset + community extras, merged in merit order. */
  projects: MaccPoint[];
  /** Community measures (published, authored via the collab layer; ids beyond kz-26). */
  extras: MaccPoint[];
  totals: DatasetTotals;
  /** True while levers AND overrides are pristine (Excel-default scenario). */
  atBaseline: boolean;
  /** True while a recompute is in flight (for subtle UI feedback). */
  computing: boolean;
  recomputeToken: number;
  /** Commit a single lever (called on slider release) and recompute. */
  setLever: (key: keyof Levers, value: number) => void;
  /** Apply a full lever set (URL hydration, reset, presets) and recompute. */
  applyLevers: (levers: Levers) => void;
  /** Set one per-measure override (commit on Enter/blur from the drill-down). */
  setOverride: (cell: string, value: number) => void;
  /** Drop a single per-measure override (the per-row ↺ button). */
  clearOverride: (cell: string) => void;
  /** Drop several overrides in one go (the "reset assumptions" project button). */
  clearOverrides: (cells: string[]) => void;
  /** Restore the Excel-default baseline (clears levers AND overrides). */
  reset: () => void;
  /** Fetch + merge the community-authored published measures (runs once for everyone). */
  loadCommunity: () => void;
}

function pristine(levers: Levers, overrides: ProjectOverrides): boolean {
  return isBaseline(levers) && Object.keys(overrides).length === 0;
}

// Community extras: cached after the first fetch; the merged file curve to overlay onto.
let communityCache: CommunityData | null = null;
let baseCurve: MaccPoint[] = baselineProjects;

/** File curve + community extras, sorted ascending by MAC (merit order). */
function mergeCurve(base: MaccPoint[], extras: MaccPoint[]): MaccPoint[] {
  return extras.length ? [...base, ...extras].sort((a, b) => a.mac - b.mac) : base;
}

async function recompute(
  levers: Levers,
  overrides: ProjectOverrides,
  get: () => ScenarioState,
  set: (partial: Partial<ScenarioState>) => void,
) {
  const token = get().recomputeToken + 1;
  const baseline = pristine(levers, overrides);
  set({ levers, overrides, atBaseline: baseline, computing: true, recomputeToken: token });

  let base: MaccPoint[];
  let totals: DatasetTotals;
  if (baseline) {
    // Baseline is the published golden data — skip the engine entirely.
    base = baselineProjects;
    totals = baselineTotals;
  } else {
    // Lazy-load the calc engine only when the user actually moves off baseline. The
    // canonical curve recomputes from the measure-notation bundle (baked from Supabase),
    // NOT the Excel HyperFormula engine — so a slider/override runs the same calc core as
    // the bake and keeps MCP/editor measure edits instead of snapping back to Excel.
    const { recalc } = await import('@/lib/calc/measure-recalc');
    const result = recalc(levers, overrides);
    if (get().recomputeToken !== token) return; // a newer recompute superseded us
    base = result.projects;
    totals = result.totals;
  }
  baseCurve = base;

  // Recompute the community extras at the new levers (lazy; keeps the engine out of core).
  let extras = get().extras;
  if (communityCache) {
    const { computeExtras } = await import('@/lib/community/extras');
    if (get().recomputeToken !== token) return;
    extras = computeExtras(communityCache, levers);
  }
  set({ projects: mergeCurve(base, extras), extras, totals, computing: false });
}

export const useScenario = create<ScenarioState>((set, get) => ({
  levers: { ...BASELINE_LEVERS },
  overrides: {},
  projects: baselineProjects,
  extras: [],
  totals: baselineTotals,
  atBaseline: true,
  computing: false,
  recomputeToken: 0,
  setLever: (key, value) => {
    void recompute({ ...get().levers, [key]: value }, get().overrides, get, set);
  },
  applyLevers: (levers) => {
    void recompute(levers, get().overrides, get, set);
  },
  setOverride: (cell, value) => {
    void recompute(get().levers, { ...get().overrides, [cell]: value }, get, set);
  },
  clearOverride: (cell) => {
    if (!(cell in get().overrides)) return;
    const next = { ...get().overrides };
    delete next[cell];
    void recompute(get().levers, next, get, set);
  },
  clearOverrides: (cells) => {
    const cur = get().overrides;
    const next: ProjectOverrides = { ...cur };
    let changed = false;
    for (const c of cells) {
      if (c in next) {
        delete next[c];
        changed = true;
      }
    }
    if (!changed) return;
    void recompute(get().levers, next, get, set);
  },
  reset: () => {
    void recompute({ ...BASELINE_LEVERS }, {}, get, set);
  },
  loadCommunity: () => {
    void (async () => {
      const mod = await import('@/lib/community/extras');
      const data = await mod.loadCommunityExtras();
      if (!data) return; // backend absent / no extras → curve stays the file dataset
      communityCache = data;
      const extras = mod.computeExtras(data, get().levers);
      set({ extras, projects: mergeCurve(baseCurve, extras) });
    })();
  },
}));
