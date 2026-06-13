'use client';
import { create } from 'zustand';
import type { MaccPoint, DatasetTotals, Levers } from '@data/schema';
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

// ── Scenario state (live levers + recomputed curve) ──────────────────────────
// The curve starts as the bundled baseline (golden) data — no engine needed for
// the first paint. Moving a lever lazy-loads src/lib/calc (HyperFormula) and
// recomputes. `recomputeToken` guards against out-of-order async results.
interface ScenarioState {
  levers: Levers;
  projects: MaccPoint[];
  totals: DatasetTotals;
  /** True while the baseline (Excel-default) scenario is shown. */
  atBaseline: boolean;
  /** True while a recompute is in flight (for subtle UI feedback). */
  computing: boolean;
  recomputeToken: number;
  /** Commit a single lever (called on slider release) and recompute. */
  setLever: (key: keyof Levers, value: number) => void;
  /** Apply a full lever set (URL hydration, reset, presets) and recompute. */
  applyLevers: (levers: Levers) => void;
  /** Restore the Excel-default baseline. */
  reset: () => void;
}

async function recompute(
  levers: Levers,
  get: () => ScenarioState,
  set: (partial: Partial<ScenarioState>) => void,
) {
  const token = get().recomputeToken + 1;
  set({ levers, atBaseline: isBaseline(levers), computing: true, recomputeToken: token });

  if (isBaseline(levers)) {
    // Baseline is the published golden data — skip the engine entirely.
    set({ projects: baselineProjects, totals: baselineTotals, computing: false });
    return;
  }

  // Lazy-load the calc engine only when the user actually moves off baseline.
  const { recalc } = await import('@/lib/calc');
  const result = recalc(levers);
  if (get().recomputeToken !== token) return; // a newer recompute superseded us
  set({ projects: result.projects, totals: result.totals, computing: false });
}

export const useScenario = create<ScenarioState>((set, get) => ({
  levers: { ...BASELINE_LEVERS },
  projects: baselineProjects,
  totals: baselineTotals,
  atBaseline: true,
  computing: false,
  recomputeToken: 0,
  setLever: (key, value) => {
    void recompute({ ...get().levers, [key]: value }, get, set);
  },
  applyLevers: (levers) => {
    void recompute(levers, get, set);
  },
  reset: () => {
    void recompute({ ...BASELINE_LEVERS }, get, set);
  },
}));
