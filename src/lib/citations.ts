// EN overlay for provenance citations — the line under each slider and each leaf of the
// formula tree that says where a number came from ("Уд. CAPEX солнце/ветер (IRENA 2023,
// MACC!E47/E48) × мощность").
//
// In the measure document `provenance.citation` is a plain string: an author writes ONE
// language, and the notation has no second slot to keep in sync. So the EN surface resolves
// it through this curated dictionary at render time — no schema migration, no Supabase
// rewrite, and the RU text stays the verifiable original.
//
// A citation authored after the last curation pass falls back to its RU text; `npm run
// i18n-check` fails on any citation missing from the dictionary, so the gap shows up in CI
// instead of on the page.
import citationsEn from '@data/kz/citations.en.json';

const CITATIONS = citationsEn as Record<string, string>;

/** RU citation → its EN overlay on /en; the RU string itself everywhere else. */
export function citationEn(citation: string | undefined, locale: string): string | undefined {
  if (!citation || locale !== 'en') return citation;
  return CITATIONS[citation] ?? citation;
}
