// Public types for the v1 calc engine. The engine reproduces the Excel model
// exactly (validated by the golden test) and recomputes the whole curve from a
// set of live `Levers` plus optional per-measure cell overrides. Data shapes
// are reused from the published dataset schema so a recalc result is a drop-in
// replacement for the bundled baseline dataset.
import type { MaccPoint, DatasetTotals, Levers } from '@data/schema';

export type { Levers };

/**
 * Per-measure assumption overrides — `"Расчёты!C8" -> new value`. Keys mirror
 * the provenance cell on each `LocalInput`; values replace the Excel literal in
 * HyperFormula so all downstream formulas (E/F/G/H of MACC) propagate. Empty =
 * pristine baseline. Lives in-memory for the user's session only.
 */
export type ProjectOverrides = Record<string, number>;

/** Output of `recalc(levers, overrides)` — a fully re-sorted, ready-to-plot curve. */
export interface RecalcResult {
  /** Projects with refreshed E..K outputs, sorted ascending by MAC (curve order). */
  projects: MaccPoint[];
  /** Aggregate KPIs, recomputed from the refreshed projects. */
  totals: DatasetTotals;
  /** The levers that produced this result (echoed back for the UI/exports). */
  levers: Levers;
}
