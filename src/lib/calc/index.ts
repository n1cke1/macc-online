// Public surface of the v1 calc engine. Import from here, not from `engine.ts`,
// so the HyperFormula dependency stays encapsulated in one place.
export { recalc, modelVersion, BASELINE_LEVERS } from './engine';
export type { RecalcResult, Levers } from './types';
