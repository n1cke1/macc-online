// R9 — translation-layer coverage guard. `npm run i18n-check` -> tsx; exits non-zero on a
// regression so it gates CI alongside golden/ingest/r8. Codifies the R9 audit invariant:
// every domain text has an `en`, no Cyrillic leaks into the en surface, and the UI catalogs
// stay key-for-key in sync. (Library object/tech RU names are a separate, deferred layer —
// English-base `en===ru` with no Cyrillic is allowed; only Cyrillic-in-en is a failure.)
import { readFileSync } from 'node:fs';
import { formatUnit } from '../src/lib/format';
import { citationEn } from '../src/lib/citations';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const CYR = /[а-яА-ЯёЁ]/;
let failures = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { console.log(`  ✓ ${msg}`); return; } failures++; console.log(`  ✗ ${msg}`); };

// 1. UI catalogs (next-intl) — same keys both ways, no Cyrillic in en.
console.log('1. UI catalogs (messages/{ru,en}.json)');
const flat = (o: unknown, p = '', acc: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, acc); else acc[key] = String(v);
  }
  return acc;
};
const ru = flat(read('messages/ru.json'));
const en = flat(read('messages/en.json'));
const missEn = Object.keys(ru).filter((k) => !(k in en));
const missRu = Object.keys(en).filter((k) => !(k in ru));
const cyrEn = Object.keys(en).filter((k) => CYR.test(en[k]));
ok(missEn.length === 0, `every ru key has an en (${missEn.length} missing${missEn.length ? ': ' + missEn.slice(0, 5).join(',') : ''})`);
ok(missRu.length === 0, `every en key has a ru (${missRu.length} missing${missRu.length ? ': ' + missRu.slice(0, 5).join(',') : ''})`);
ok(cyrEn.length === 0, `no Cyrillic left in the en catalog (${cyrEn.length}${cyrEn.length ? ': ' + cyrEn.slice(0, 5).join(',') : ''})`);

// 2. domain {ru,en} — no missing en, no Cyrillic in en, across curve + measures.
console.log('2. domain text {ru,en}');
const dom: Array<{ ru?: string; en?: string }> = [];
const data = read('data/kz/model.data.json');
data.projects?.forEach((p: { name?: object }) => p.name && dom.push(p.name));
Object.values(data.sectors ?? {}).forEach((s: unknown) => { const n = (s as { name?: object; label?: object }).name ?? (s as { label?: object }).label; if (n) dom.push(n as object); });
data.assumptions?.forEach((a: { label?: object }) => a.label && dom.push(a.label));
read('data/kz/measures.bundle.json').measures.forEach((m: { name?: object; abatement?: { formula_label?: object } }) => {
  if (m.name) dom.push(m.name); if (m.abatement?.formula_label) dom.push(m.abatement.formula_label);
});
const missDomEn = dom.filter((o) => o.en == null || o.en === '');
const cyrDomEn = dom.filter((o) => o.en && CYR.test(o.en));
ok(missDomEn.length === 0, `every domain {ru,en} has an en (${missDomEn.length} missing)`);
ok(cyrDomEn.length === 0, `no Cyrillic leaked into a domain en (${cyrDomEn.length}${cyrDomEn.length ? ': ' + cyrDomEn.slice(0, 3).map((o) => o.en).join(' | ') : ''})`);

// 3. units — every `unit` the baked curve ships must render Cyrillic-free on /en.
// formatUnit() falls back to a token pass for unseen units, so a new unit authored in
// Supabase surfaces here instead of on the page.
console.log('3. physical units render in en');
const units = new Set<string>();
const collectUnits = (o: unknown): void => {
  if (Array.isArray(o)) return o.forEach(collectUnits);
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k.endsWith('unit') && typeof v === 'string' && v) units.add(v);
    else collectUnits(v);
  }
};
[read('data/kz/model.data.json'), read('data/kz/measures.bundle.json')].forEach(collectUnits);
const badUnits = [...units].filter((u) => CYR.test(formatUnit(u, 'en')));
ok(badUnits.length === 0, `every unit renders Cyrillic-free on /en (${units.size} distinct, ${badUnits.length} failing${badUnits.length ? ': ' + badUnits.slice(0, 5).join(', ') : ''})`);

// 4/5. every {ru,en} pair in the bundle, not just the five domain fields of check 2 —
// computed labels arrive from the MCP with `ru` only, and the library's English-base rows
// can carry RU text straight onto the en surface. (The provenance layer — `citation`,
// `localInputs[].source` — is a plain `string` with no en slot at all; that is a separate
// epic, and this gate deliberately does not claim to cover it.)
console.log('4. every {ru,en} pair in the bundle');
const pairs: Array<{ path: string; ru?: string; en?: string }> = [];
const collectPairs = (o: unknown, path: string): void => {
  if (Array.isArray(o)) return o.forEach((v, i) => collectPairs(v, `${path}[${i}]`));
  if (!o || typeof o !== 'object') return;
  const rec = o as Record<string, unknown>;
  if (typeof rec.ru === 'string' && ('en' in rec || Object.keys(rec).length === 1)) {
    pairs.push({ path, ru: rec.ru, en: typeof rec.en === 'string' ? rec.en : undefined });
    return;
  }
  for (const [k, v] of Object.entries(rec)) collectPairs(v, `${path}.${k}`);
};
collectPairs(read('data/kz/measures.bundle.json'), 'bundle');
const missPairEn = pairs.filter((p) => !p.en);
const cyrPairEn = pairs.filter((p) => p.en && CYR.test(p.en));
ok(missPairEn.length === 0, `every {ru,…} pair has an en (${pairs.length} pairs, ${missPairEn.length} missing${missPairEn.length ? ': ' + missPairEn.slice(0, 5).map((p) => p.path).join(', ') : ''})`);
ok(cyrPairEn.length === 0, `no Cyrillic in any pair's en (${cyrPairEn.length}${cyrPairEn.length ? ': ' + cyrPairEn.slice(0, 3).map((p) => p.path).join(', ') : ''})`);

// 5. provenance citations — the line under every slider and every leaf of the formula tree.
// `citation` is a plain RU string in the notation, so /en resolves it through the curated
// overlay (data/kz/citations.en.json). A citation authored since the last curation pass has
// no entry and would fall back to Russian on the page — fail here instead.
console.log('5. provenance citations (en overlay)');
const cites = new Set<string>();
const collectCites = (o: unknown): void => {
  if (Array.isArray(o)) return o.forEach(collectCites);
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if ((k === 'citation' || k === 'source') && typeof v === 'string' && v) cites.add(v);
    else collectCites(v);
  }
};
[read('data/kz/model.data.json'), read('data/kz/measures.bundle.json')].forEach(collectCites);
const ruCites = [...cites].filter((c) => CYR.test(c));
const uncovered = ruCites.filter((c) => CYR.test(citationEn(c, 'en') ?? c));
ok(uncovered.length === 0, `every RU citation has an en overlay (${ruCites.length} RU, ${uncovered.length} uncovered${uncovered.length ? ': ' + uncovered.slice(0, 3).map((c) => c.slice(0, 40)).join(' | ') : ''})`);

// 6. catch-all: nothing else in the bundle may hold Cyrillic on the en surface. `ru` is the
// RU half of a pair; `*unit` is check 3's job; `citation`/`source` is check 5's. Anything
// else — a library description, an authoring rule, a reliability note — is a single
// English-base field, and Russian in it reaches /en verbatim.
console.log('6. no stray Cyrillic outside the covered fields');
const strays: string[] = [];
const COVERED = (k: string) => k === 'ru' || k.endsWith('unit') || k === 'citation' || k === 'source';
const scanStrays = (o: unknown, path: string): void => {
  if (Array.isArray(o)) return o.forEach((v, i) => scanStrays(v, `${path}[${i}]`));
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === 'string') { if (CYR.test(v) && !COVERED(k)) strays.push(`${path}.${k}`); }
    else scanStrays(v, `${path}.${k}`);
  }
};
scanStrays(read('data/kz/measures.bundle.json'), 'bundle');
ok(strays.length === 0, `no Cyrillic in a single-language field (${strays.length}${strays.length ? ': ' + strays.slice(0, 4).join(', ') : ''})`);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
