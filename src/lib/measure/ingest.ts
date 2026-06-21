// R1 — the single ingest gate for measure writes (reused by stdio + Edge).
//
// A measure is a versioned document, not a patch. Every write is a FULL-DOCUMENT
// replace that passes through here once, so the four classes of silent rot the
// audit found die by construction:
//   A2  unknown top-level / nested keys  → ajv `additionalProperties:false` rejects them
//   A3  orphaned `sources` after an edit → pruned (a source whose path no longer exists)
//   —   structural vs parametric edits   → `formula_hash` (normalized AST) + `change_kind`
//   C8/C9 trustworthy numbers pasted inline → `findShouldRef` forces them to a `{ref}`
//
// Pure TS, no IO. The ajv validator is isolated behind `getValidator()` so the Edge
// bundle (Deno) can later swap a precompiled standalone validator if runtime codegen
// proves unavailable there — without touching the gate logic. (R1.5.)
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import measureSchema from '../../../data/measure.schema.json';
import type { Binding, Library, Measure, ValueSource } from './schema';

export interface ShouldRefEntry {
  path: string; // where the inline number lives in the measure
  value: number; // the inlined literal
  matches: string[]; // library indicator ids whose value equals it
}

export interface IngestResult {
  ok: boolean; // no blocking errors
  doc: Measure; // normalized document (orphan sources pruned)
  errors: string[]; // blocking: schema violations, unique should-ref matches
  warnings: string[]; // advisory: ambiguous should-ref matches
  formula_hash: string; // fingerprint of the document's formulas (numbers excluded)
  /** Set only when a prior hash is supplied: same formulas ⇒ parametric, else structural. */
  change_kind?: 'structural' | 'parametric';
  droppedSources: string[]; // §A3 orphan source paths removed
  shouldRef: ShouldRefEntry[];
}

// ── ajv (schema gate, A2) ──────────────────────────────────────────────────────

let _validate: ValidateFunction | null = null;
function getValidator(): ValidateFunction {
  if (_validate) return _validate;
  // strict:false — the schema uses only standard 2020-12 keywords; we don't want ajv
  // throwing on schema-authoring style. allErrors so one write reports every violation.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  _validate = ajv.compile(measureSchema as object);
  return _validate;
}

function schemaErrors(input: unknown): string[] {
  const validate = getValidator();
  if (validate(input)) return [];
  return (validate.errors ?? []).map((e) => {
    const where = e.instancePath || '(root)';
    const extra = e.keyword === 'additionalProperties'
      ? ` (${(e.params as { additionalProperty: string }).additionalProperty})`
      : '';
    return `schema ${where} ${e.keyword}: ${e.message}${extra}`;
  });
}

// ── path access ────────────────────────────────────────────────────────────────

/** JS-style path read (`a.b[0].c`) into the document. Mirrors validate.ts readPath. */
function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.match(/[^.[\]]+/g) ?? []) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// ── A3 — orphaned sources ────────────────────────────────────────────────────

/** Drop every `sources[path]` whose path is referenced nowhere in the document —
 *  neither as an inline value NOR as a `computed[path]` entry. (Full-replace makes
 *  shallow-merge orphans impossible; this catches the author who drops an object but
 *  leaves its source entry behind.) A formula-derived value lives in `computed` with its
 *  provenance in `sources`, so a present `computed[path]` keeps the source alive — only a
 *  path that resolves to nothing AND has no formula is a true orphan. */
function dropOrphanSources(m: Measure): { doc: Measure; dropped: string[] } {
  if (!m.sources) return { doc: m, dropped: [] };
  const dropped: string[] = [];
  const kept: Record<string, ValueSource> = {};
  for (const [p, s] of Object.entries(m.sources)) {
    if (readPath(m, p) === undefined && !m.computed?.[p]) dropped.push(p);
    else kept[p] = s;
  }
  return dropped.length ? { doc: { ...m, sources: kept }, dropped } : { doc: m, dropped };
}

// ── formula_hash (structural vs parametric) ────────────────────────────────────

/** Deterministic, key-order-independent JSON. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** FNV-1a, run on two seeds for a 64-bit fingerprint — no node:crypto (Deno/browser safe). */
function fingerprint(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/** Hash only the document's FORMULAS (ASTs), so a pure number edit is parametric (same
 *  hash) and a formula edit is structural (different hash). */
export function formulaHash(m: Measure): string {
  const computed = Object.fromEntries(
    Object.entries(m.computed ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, c]) => [k, c?.formula ?? null]),
  );
  return fingerprint(stableStringify({
    abatement_formula: m.abatement?.formula ?? null,
    abatement_computed: m.abatement?.computed ?? null,
    computed,
  }));
}

// ── C8/C9 — should-ref enforcement (inverse of findDrift) ──────────────────────

const SHOULD_REF_TOL = 1e-6;
const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);

/** A number that already names a library/local source through its binding is linked. */
function hasRefBinding(binding?: Binding): boolean {
  return !!binding?.ref && (binding.mode === 'reuse' || binding.mode === 'alt' || binding.mode === 'derived');
}

/** Inline numbers (not already bound to a `{ref}`) that equal a shared subsector
 *  EMISSIONS baseline — a trustworthy value pasted inline that should point at the
 *  indicator (e.g. `base_emissions=135.3` = the coal subsector's `max_emissions`; C9).
 *
 *  Matching is by value, so it is deliberately narrow on two axes: only subsector
 *  `max_emissions` indicators (the exact C9 case), and only measure INPUTS whose unit is
 *  CO₂ (or unit-less) — an emissions baseline lives in an input, never in an object
 *  capacity or a `лет`/`доля` factor, so the unit guard stops a round-valued baseline
 *  (industry_energy=30, forestry=10 Мт) from colliding with an unrelated round input
 *  (`lifetime=30`). R3/R8 will fold full dimensions in and promote a unique match to a
 *  hard block (see `ingest` opts); today it is a warn. */
export function findShouldRef(m: Measure, library: Library): ShouldRefEntry[] {
  const out: ShouldRefEntry[] = [];
  const indicators = (library.indicators ?? [])
    .filter((i) => i.owner_kind === 'subsector' && i.key === 'max_emissions');
  const isCo2 = (u?: string) => !u || /co[₂2]/i.test(u);
  for (const [k, inp] of Object.entries(m.inputs ?? {})) {
    if (typeof inp.value !== 'number' || inp.value === 0 || !Number.isFinite(inp.value)) continue;
    if (hasRefBinding(inp.binding) || !isCo2(inp.unit)) continue;
    const matches = indicators
      .filter((i) => typeof i.value === 'number' && relDiff(i.value, inp.value) <= SHOULD_REF_TOL)
      .map((i) => i.id);
    if (matches.length) out.push({ path: `inputs.${k}`, value: inp.value, matches });
  }
  return out;
}

// ── the gate ────────────────────────────────────────────────────────────────

/**
 * Run a full measure document through the ingest gate. `library` is needed for
 * should-ref matching; `prevFormulaHash` (the stored version's hash) enables
 * change_kind. Returns the normalized document plus a verdict — the caller persists
 * `doc` only when `ok`.
 *
 * `shouldRefSeverity` — `'warn'` (default) surfaces every should-ref as advisory;
 * `'block'` turns a UNIQUE match into a blocking error (the roadmap's eventual gate).
 * Default is warn because the audit proved a value-only unique match still over-fires
 * across dimensions; R3 will make the match dimension-aware and flip the default.
 */
export function ingest(
  input: unknown,
  library: Library,
  opts: { prevFormulaHash?: string; shouldRefSeverity?: 'warn' | 'block' } = {},
): IngestResult {
  const errors = schemaErrors(input);
  const warnings: string[] = [];

  const { doc, dropped } = dropOrphanSources(input as Measure);

  const formula_hash = formulaHash(doc);
  const change_kind = opts.prevFormulaHash != null
    ? (opts.prevFormulaHash === formula_hash ? 'parametric' : 'structural')
    : undefined;

  const shouldRef = findShouldRef(doc, library);
  for (const s of shouldRef) {
    const unique = s.matches.length === 1;
    const msg = unique
      ? `should-ref: ${s.path}=${s.value} equals library indicator '${s.matches[0]}' — bind it via {ref} instead of inlining`
      : `should-ref?: ${s.path}=${s.value} matches indicators [${s.matches.join(', ')}] — bind one via {ref} if it is the same quantity`;
    if (unique && opts.shouldRefSeverity === 'block') errors.push(msg);
    else warnings.push(msg);
  }

  return {
    ok: errors.length === 0,
    doc,
    errors,
    warnings,
    formula_hash,
    change_kind,
    droppedSources: dropped,
    shouldRef,
  };
}
