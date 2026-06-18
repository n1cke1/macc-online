// Headless preview of what the accordion editor (MeasureEditor.tsx) renders for
// each §11 seed measure — the panel statuses, badges and live values, straight
// from the same compute()/validate() the UI calls. Lets you verify the authoring
// UI's content without a browser. `npx tsx scripts/measure-ui-preview.ts`.
import { library, seedMeasures } from '../src/lib/measure/library';
import { compute, makeResolver } from '../src/lib/measure/compute';
import { validate } from '../src/lib/measure/validate';
import { renderAst, evalAst } from '../src/lib/measure/compile';

const glyph = (s: string) => (s === 'ok' ? '✓' : s === 'warn' ? '⚠' : s === 'incomplete' ? '○' : '–');

for (const m of seedMeasures) {
  const peers = seedMeasures.filter((x) => x.id !== m.id);
  const c = compute(m, library);
  const v = validate(m, library, peers);
  const isSub = m.comparison?.is_substitution === true;

  console.log(`\n┌─ ${m.id} · ${m.name.ru}`);
  console.log(`│ badges: [${m.sector_ref}] [${m.maturity_stage}] [${v.scope}] [${isSub ? 'substitution' : 'A/B'}]`);
  console.log(`│ MAC ${c.mac.toFixed(2)} USD/t · abatement ${Math.round(c.abatementKt)} kt/yr · potential ${Math.round(v.potential)} kt/yr`);
  console.log(`├─ panels`);
  for (const [k, s] of Object.entries(v.panels)) console.log(`│   ${glyph(s)} ${k.padEnd(10)} ${s}`);
  console.log(`├─ guardrails`);
  for (const [k, s] of Object.entries(v.checks)) console.log(`│   ${glyph(s)} ${k.padEnd(10)} ${s}`);
  if (m.abatement.back_calc) {
    const r = library.references[m.abatement.back_calc.reference_ref];
    console.log(`│   implied factor ${c.impliedFactor?.toFixed(2)} vs corridor [${r.range.join('–')}] ${r.unit}`);
  }
  // §6 sourcing — provenance + binding per INPUT number (what each "?" shows in the UI).
  const sources = m.sources ?? {};
  const keys = Object.keys(sources);
  console.log(`├─ sourcing (${keys.length} input numbers)`);
  for (const k of keys) {
    const s = sources[k];
    const b = s.binding ? ` · binding ${s.binding.mode}${s.binding.ref ? `→${s.binding.ref}` : ''}${s.binding.divergence_reason ? ` (${s.binding.divergence_reason})` : ''}` : '';
    console.log(`│   ${k.padEnd(40)} ${s.provenance.source_type}/${s.provenance.confidence}${b}`);
  }
  // §3 computed — derived numbers and their formula = evaluated value.
  const computedMap = m.computed ?? {};
  const cKeys = Object.keys(computedMap);
  if (cKeys.length) {
    const resolve = makeResolver(m, library);
    console.log(`├─ computed (${cKeys.length} derived numbers)`);
    for (const k of cKeys) {
      const c = computedMap[k];
      console.log(`│   ${k.padEnd(40)} ${renderAst(c.formula, (key) => `[${key}]`)} = ${evalAst(c.formula, resolve).toFixed(2)}`);
    }
  }
  // §3/§6 notation rule — any number that is neither input nor computed (must be empty).
  if (v.untagged.length || v.computedNoFormula.length) {
    console.log(`├─ ⚠ NOTATION GAP — untagged: [${v.untagged.join(', ')}] noFormula: [${v.computedNoFormula.join(', ')}]`);
  }
  console.log(`└─ ${v.eligibleForModel ? 'ENTERS THE MODEL (checks passed)' : 'STAYS DRAFT'}`);
}
