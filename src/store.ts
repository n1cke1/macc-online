'use client';
import { create } from 'zustand';
import type { MaccPoint, DatasetTotals, Levers } from '@data/schema';
import type { ProjectOverrides } from '@/lib/calc';
import { projects as baselineProjects, totals as baselineTotals } from '@/lib/data';
import { BASELINE_LEVERS, isBaseline } from '@/lib/scenario';

// ── View state (selection + sector filter) ───────────────────────────────────
interface UiState {
  selectedId: number | null;
  select: (id: number | null) => void;
  hiddenSectors: Set<string>;
  toggleSector: (code: string) => void;
}

export const useUi = create<UiState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
  hiddenSectors: new Set<string>(),
  toggleSector: (code) =>
    set((s) => {
      const next = new Set(s.hiddenSectors);
      next.has(code) ? next.delete(code) : next.add(code);
      return { hiddenSectors: next };
    }),
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
}
export const useDraftOverlay = create<DraftOverlayState>((set) => ({
  bar: null,
  setBar: (bar) => set({ bar }),
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
  projects: MaccPoint[];
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
}

function pristine(levers: Levers, overrides: ProjectOverrides): boolean {
  return isBaseline(levers) && Object.keys(overrides).length === 0;
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

  if (baseline) {
    // Baseline is the published golden data — skip the engine entirely.
    set({ projects: baselineProjects, totals: baselineTotals, computing: false });
    return;
  }

  // Lazy-load the calc engine only when the user actually moves off baseline.
  const { recalc } = await import('@/lib/calc');
  const result = recalc(levers, overrides);
  if (get().recomputeToken !== token) return; // a newer recompute superseded us
  set({ projects: result.projects, totals: result.totals, computing: false });
}

export const useScenario = create<ScenarioState>((set, get) => ({
  levers: { ...BASELINE_LEVERS },
  overrides: {},
  projects: baselineProjects,
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
}));
