// Scenario = the four live levers. This module owns lever metadata (for the
// slider panel) and the URL <-> levers codec (for shareable scenarios). It reads
// the lever definitions from the published dataset, so it never imports the calc
// engine (HyperFormula stays lazy-loaded behind src/lib/calc/).
import { assumptions } from '@/lib/data';
import type { Assumption, Levers } from '@data/schema';

export type { Levers };

export type LeverKey = keyof Levers;

/** Display order for the panel (fuel prices first, then cost of capital). */
export const LEVER_ORDER: LeverKey[] = [
  'coalPrice',
  'gasPrice',
  'electricityPrice',
  'discountRate',
];

/** Short query-string keys — keep URLs compact and stable. */
const URL_KEY: Record<LeverKey, string> = {
  coalPrice: 'c',
  gasPrice: 'g',
  electricityPrice: 'e',
  discountRate: 'w',
};

export interface LeverMeta extends Assumption {
  key: LeverKey;
  min: number;
  max: number;
  step: number;
}

function leverMeta(key: LeverKey): LeverMeta {
  const a = assumptions.find((x) => x.key === key);
  if (!a || !a.isLever || a.min === undefined || a.max === undefined || a.step === undefined) {
    throw new Error(`Lever "${key}" missing or incompletely defined in dataset`);
  }
  return a as LeverMeta;
}

/** Lever metadata in panel display order. */
export const LEVER_META: LeverMeta[] = LEVER_ORDER.map(leverMeta);

/** Excel-default lever values (the baseline scenario). */
export const BASELINE_LEVERS: Levers = LEVER_ORDER.reduce((acc, k) => {
  acc[k] = leverMeta(k).value;
  return acc;
}, {} as Levers);

const EPS = 1e-9;

/** True when every lever equals its baseline value. */
export function isBaseline(levers: Levers): boolean {
  return LEVER_ORDER.every((k) => Math.abs(levers[k] - BASELINE_LEVERS[k]) < EPS);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Encode only the levers that differ from baseline into URLSearchParams, so a
 * pristine view has a clean URL and a shared scenario carries just its deltas.
 */
export function encodeScenario(levers: Levers): URLSearchParams {
  const params = new URLSearchParams();
  for (const k of LEVER_ORDER) {
    if (Math.abs(levers[k] - BASELINE_LEVERS[k]) >= EPS) {
      // Trim float noise: WACC keeps 4 dp, prices keep 2.
      const dp = k === 'discountRate' ? 4 : 2;
      params.set(URL_KEY[k], String(Number(levers[k].toFixed(dp))));
    }
  }
  return params;
}

/** Parse levers from a query string / URLSearchParams, clamped to each range. */
export function decodeScenario(
  search: string | URLSearchParams | null | undefined,
): Levers {
  const params =
    search instanceof URLSearchParams ? search : new URLSearchParams(search ?? '');
  const out: Levers = { ...BASELINE_LEVERS };
  for (const m of LEVER_META) {
    const raw = params.get(URL_KEY[m.key]);
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out[m.key] = clamp(n, m.min, m.max);
  }
  return out;
}
