// R9 — translation-layer coverage guard. `npm run i18n-check` -> tsx; exits non-zero on a
// regression so it gates CI alongside golden/ingest/r8. Codifies the R9 audit invariant:
// every domain text has an `en`, no Cyrillic leaks into the en surface, and the UI catalogs
// stay key-for-key in sync. (Library object/tech RU names are a separate, deferred layer —
// English-base `en===ru` with no Cyrillic is allowed; only Cyrillic-in-en is a failure.)
import { readFileSync } from 'node:fs';

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

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
