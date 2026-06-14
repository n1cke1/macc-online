// Typed access to the published dataset. For v0 the baseline is imported
// directly (bundled); v1 will lazy-load workbook.engine.json for live recalc
// behind the src/lib/calc/ interface. The static core never imports Supabase.
import datasetJson from '@data/kz/model.data.json';
import type { Dataset, MaccPoint, Assumption, SectorCode } from '@data/schema';

export const dataset = datasetJson as unknown as Dataset;

export const projects: MaccPoint[] = dataset.projects;
export const assumptions: Assumption[] = dataset.assumptions;
export const levers = assumptions.filter((a) => a.isLever);
export const totals = dataset.totals;
export const sectors = dataset.sectors;
export const modelVersion = dataset.modelVersion;

export type { Dataset, MaccPoint, Assumption, SectorCode };

export function sectorColor(code: string): string {
  return sectors[code as SectorCode]?.color ?? '#94a3b8';
}

export function sectorLabel(code: string, locale: 'ru' | 'en'): string {
  const s = sectors[code as SectorCode]?.label;
  if (!s) return code;
  return (locale === 'en' && s.en) || s.ru;
}

/** Bilingual pick with RU fallback. */
export function pick(label: { ru: string; en: string }, locale: 'ru' | 'en'): string {
  return (locale === 'en' && label.en) || label.ru;
}

/**
 * Stable, locale-independent anchor key for a drill-down line item (CAPEX/OPEX/
 * physical/assumption row). Derived from the RU label — NOT the provenance cell
 * address, which shifts whenever rows move in the model (the Stage 1–7 restructure
 * did exactly that). A re-worded label is then the only thing that can detach a
 * thread; ':' is stripped so the value stays safe inside a `type:id` anchor.
 */
export function itemAnchorKey(label: { ru: string }): string {
  return label.ru
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-zа-яё]+/giu, '-')
    .replace(/^-+|-+$/g, '');
}
