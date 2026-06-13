// Golden test — the published trust anchor (see CLAUDE.md principle #2).
//
// It runs the v1 HyperFormula engine at the *baseline* levers and asserts that
// every measure output and every total matches the values the ETL cached from
// Excel (`model.data.json`). A pass proves the client-side recalc is bit-for-bit
// faithful to the original workbook — the curve is verifiable, not a black box.
//
// Run it: `npm run golden`. It is plain TypeScript with no test-framework
// dependency, so anyone can audit it. CI/contributors can also wrap `runGolden`
// in their runner of choice.
import baselineJson from '../../../data/kz/model.data.json';
import type { Dataset, MaccPoint } from '@data/schema';
import { recalc, BASELINE_LEVERS, modelVersion } from './engine';

const baseline = baselineJson as unknown as Dataset;

/** Absolute tolerance for floating-point comparison (model units are mUSD / kt). */
const ABS_TOL = 1e-6;
/** Relative tolerance, applied for large magnitudes. */
const REL_TOL = 1e-9;

function close(actual: number, expected: number): boolean {
  const diff = Math.abs(actual - expected);
  return diff <= ABS_TOL || diff <= Math.abs(expected) * REL_TOL;
}

export interface GoldenIssue {
  where: string;
  field: string;
  actual: number;
  expected: number;
  diff: number;
}

export interface GoldenReport {
  pass: boolean;
  modelVersion: string;
  checked: number;
  maxAbsDiff: number;
  issues: GoldenIssue[];
}

const MEASURE_FIELDS: Array<keyof MaccPoint> = [
  'capex',
  'opex',
  'durationYrs',
  'abatementKt',
  'npv',
  'discCo2Kt',
  'mac',
];

export function runGolden(): GoldenReport {
  const result = recalc(BASELINE_LEVERS);
  const issues: GoldenIssue[] = [];
  let maxAbsDiff = 0;
  let checked = 0;

  const byId = new Map(result.projects.map((p) => [p.id, p]));

  for (const expected of baseline.projects) {
    const actual = byId.get(expected.id);
    if (!actual) {
      issues.push({
        where: `measure #${expected.id}`,
        field: '(missing)',
        actual: NaN,
        expected: expected.id,
        diff: NaN,
      });
      continue;
    }
    for (const f of MEASURE_FIELDS) {
      const a = actual[f] as number;
      const e = expected[f] as number;
      const diff = Math.abs(a - e);
      maxAbsDiff = Math.max(maxAbsDiff, diff);
      checked++;
      if (!close(a, e)) {
        issues.push({ where: `measure #${expected.id}`, field: f, actual: a, expected: e, diff });
      }
    }
  }

  // Totals
  const totalFields = Object.keys(baseline.totals) as Array<keyof typeof baseline.totals>;
  for (const f of totalFields) {
    const a = result.totals[f];
    const e = baseline.totals[f];
    const diff = Math.abs(a - e);
    maxAbsDiff = Math.max(maxAbsDiff, diff);
    checked++;
    if (!close(a, e)) {
      issues.push({ where: 'totals', field: f, actual: a, expected: e, diff });
    }
  }

  return { pass: issues.length === 0, modelVersion, checked, maxAbsDiff, issues };
}
