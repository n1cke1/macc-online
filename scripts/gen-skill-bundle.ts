// Bundle the macc-measure-authoring skill into a committed TS module the hosted MCP serves
// (guide://measure + get_authoring_guide). Markdown lives under
// `.claude/skills/macc-measure-authoring/`; the Deno Edge bundle + Worker can't read the FS,
// so we inline it at build time like the JSON authority data.
//
//   npm run gen-skill            regenerate src/lib/measure/skill.generated.ts
//   npm run gen-skill -- --check verify it is in sync (CI / pre-deploy), no write
//
// R5 — the guide is DERIVED FROM TRUTH, so it can't drift:
//   • `{{indicator:<id>}}` placeholders → live value+unit from the library snapshot (B7)
//   • a generated "Schema enums" section straight from measure.schema.json (B6)
//   • a generated "Validate output" section from a live validate() run (D14 — displaced &c.)
// Re-run after editing SKILL.md / a reference / the schema / the library, then `npm run build-edge`.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { library, seedMeasures } from '../src/lib/measure/library';
import { validate } from '../src/lib/measure/validate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = resolve(ROOT, '.claude/skills/macc-measure-authoring');
const OUT = resolve(ROOT, 'src/lib/measure/skill.generated.ts');

const REFERENCES = [
  'measure-types', 'sectors', 'conventions', 'sourcing', 'formula-ast',
  'dimension-bridges', 'abatement-modes', 'potential', 'checks',
];

/** Drop a leading YAML frontmatter block (`---` … `---`). */
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 3);
  return end === -1 ? md : md.slice(md.indexOf('\n', end + 1) + 1).replace(/^\n+/, '');
}

// ── derive-from-truth ──────────────────────────────────────────────────────────

/** Replace `{{indicator:<id>}}` with the live `value unit` from the library snapshot (B7). */
function substituteLive(md: string): string {
  return md.replace(/\{\{indicator:([a-zA-Z0-9_]+)\}\}/g, (_, id) => {
    const ind = library.indicators.find((i) => i.id === id);
    if (!ind) throw new Error(`gen-skill: {{indicator:${id}}} not in the library — fix the placeholder`);
    return `${ind.value}${ind.unit ? ` ${ind.unit}` : ''}`;
  });
}

/** Generated "Schema enums" section — every enum in measure.schema.json, always current (B6). */
function genEnums(): string {
  const schema = JSON.parse(readFileSync(resolve(ROOT, 'data/measure.schema.json'), 'utf8'));
  const found: Array<[string, string[]]> = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.enum)) found.push([path, o.enum as string[]]);
    for (const [k, v] of Object.entries(o)) {
      if (k === 'enum') continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(schema, '');
  // keep the readable leaf path (drop schema-structural segments)
  const clean = (p: string) => p.replace(/\.(properties|\$defs|items|additionalProperties)\b/g, '').replace(/^(properties|\$defs)\./, '');
  const lines = found
    .map(([p, vals]) => `- \`${clean(p)}\`: ${vals.map((v) => `\`${v}\``).join(', ')}`)
    .sort();
  return `## Schema enums (generated)\n\nEvery closed value set in \`measure.schema.json\` — the single source, so this never drifts from the contract:\n\n${lines.join('\n')}\n`;
}

/** Generated "Validate output" section — the live field list from a validate() run (D14). */
function genValidateFields(): string {
  const sample = seedMeasures[0];
  const v = validate(sample, library, seedMeasures.filter((m) => m.id !== sample.id));
  const gloss: Record<string, string> = {
    eligibleForModel: 'true ⟺ the measure passes every gating check + complete panels (server-authoritative «готово»)',
    scope: 'recommended scope (advisory) — actual promotion is server-side',
    mac: 'marginal abatement cost, USD/tCO₂',
    potential: 'annual abatement after pool stacking (kt CO₂eq/yr)',
    displaced: 'render-time: this measure’s share was clipped by cheaper peers in the same pool — NOT a quality verdict; a готово measure can be displaced; never persisted',
    panels: 'per-panel completeness (ok | warn | incomplete)',
    checks: 'per-guardrail verdict (factor/economics/pool/sector/limit → ok | warn | na)',
    details: 'each check’s computed quantity + bound slots (to render its formula)',
    missing: 'human-readable list of what blocks promotion',
    untagged: 'numbers that are neither an input source nor computed (§3/§6 rule)',
    computedNoFormula: 'paths declared computed but missing a formula',
    drift: 'binding.mode="reuse" whose local value disagrees with the source it claims',
    dimension: 'L3 dimensional verdict on the abatement formula',
    maturity: 'the measure’s maturity_stage',
    unchecked: 'R8 — plausibility rules eligibility was granted WITHOUT (no corridor / no basis); honest badge, advisory',
    classificationIssues: 'R8 — pool↔sector incoherence (gates); empty ⇒ coherent',
  };
  const lines = Object.keys(v).sort().map((k) => `- \`${k}\`: ${gloss[k] ?? '**(undocumented — add a gloss in gen-skill-bundle.ts)**'}`);
  return `## Validate output (generated)\n\nFields returned by \`validate_measure\` / the editor, derived from a live \`validate()\` run (so a new field can’t go undocumented):\n\n${lines.join('\n')}\n`;
}

// ── assemble ────────────────────────────────────────────────────────────────

function buildSections(): Record<string, string> {
  const sections: Record<string, string> = {};
  sections.guide = substituteLive(stripFrontmatter(readFileSync(resolve(SKILL_DIR, 'SKILL.md'), 'utf8')).trimEnd());
  for (const name of REFERENCES) {
    sections[name] = substituteLive(readFileSync(resolve(SKILL_DIR, 'references', `${name}.md`), 'utf8').trim());
  }
  sections.enums = genEnums();
  sections['validate-output'] = genValidateFields();
  return sections;
}

function fullMarkdown(sections: Record<string, string>): string {
  const refs = REFERENCES.map((name) => `## reference: ${name}\n\n${sections[name]}`);
  return [sections.guide, '---', '# References', ...refs, '---', sections.enums, sections['validate-output']].join('\n\n') + '\n';
}

function render(markdown: string, sections: Record<string, string>): string {
  const version = createHash('sha256').update(markdown).digest('hex').slice(0, 12);
  return `// GENERATED by scripts/gen-skill-bundle.ts — DO NOT EDIT.
// Source: .claude/skills/macc-measure-authoring/{SKILL.md,references/*.md} + DERIVED sections
// (schema enums, validate-output, live indicator numbers). Regenerate: \`npm run gen-skill\`.
//
// The measure-authoring guide served over MCP. \`markdown\` is the full guide; \`sections\`
// lets get_authoring_guide(section) serve one part (lazy). Inlined so every transport
// (stdio / Deno edge / Worker) ships the same text without runtime filesystem access.

export const SKILL_GUIDE = {
  version: ${JSON.stringify(version)},
  markdown: ${JSON.stringify(markdown)},
  sections: ${JSON.stringify(sections)},
} as const;

export type GuideSection = keyof typeof SKILL_GUIDE.sections;
`;
}

const sections = buildSections();
const markdown = fullMarkdown(sections);
const next = render(markdown, sections);
const check = process.argv.includes('--check');

if (check) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing → out of sync */ }
  if (current !== next) {
    console.error('skill bundle OUT OF SYNC — run `npm run gen-skill` and commit src/lib/measure/skill.generated.ts');
    process.exit(1);
  }
  console.log(`skill bundle in sync (${(markdown.length / 1024).toFixed(1)} kB, ${Object.keys(sections).length} sections)`);
} else {
  writeFileSync(OUT, next);
  console.log(`wrote ${OUT} (${(markdown.length / 1024).toFixed(1)} kB, ${Object.keys(sections).length} sections)`);
}
