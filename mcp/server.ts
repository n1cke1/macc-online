// Phase 4 / §9 — the measure-authoring MCP server DEFINITION, transport-agnostic.
//
// `buildServer(deps)` returns a configured `McpServer` (one resource + the tool set),
// closing over a resolved caller (`deps.user`) and the library/seed it serves. The
// same definition binds to either transport:
//   • stdio  — `mcp/measure-server.ts` (local dev; service-account identity)
//   • web HTTP — `mcp/http-handler.ts` (hosted; Bearer-JWT identity, per request)
//
// Identity (§9): tools are RESTRICTED TO LOGGED-IN USERS — `deps.user` null → every
// tool refuses (the notation resource stays public). Each tool runs under that user's
// RLS scope; writes publish directly (versioned + attributed, session-10 model).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compute } from '../src/lib/measure/compute';
import { validate } from '../src/lib/measure/validate';
import { SKILL_GUIDE } from '../src/lib/measure/skill.generated';
import measureSchema from '../data/measure.schema.json';
import type { Library, Measure } from '../src/lib/measure/schema';
import { bindTemplateSymbolic } from '../src/lib/measure/templates';
import { renderAst } from '../src/lib/measure/eval';
import { dbListMeasures, dbGetMeasure, dbCreateMeasure, dbUpdateMeasure, dbSetScope, dbMeasureHistory, dbListLibrary, dbUpsertLibraryEntity, dbLibraryHistory, LIBRARY_TABLES, type AuthedUser } from './db';

/** Everything a server instance needs — supplied per transport (and, in C, per request). */
export interface ServerDeps {
  /** The signed-in caller, or null (not logged in → tools refuse). */
  user: AuthedUser | null;
  /** The published library the measures resolve against (file seed today; Supabase in C). */
  library: Library;
  /** The seed measures used for pool peers + the get fallback. */
  seedMeasures: Measure[];
  getSeedMeasure: (id: string) => Measure | undefined;
}

/** Strip `description` keys from a JSON Schema (prose lives in `notation`; keeps payload compact). */
function structureOnly(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(structureOnly);
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([k]) => k !== 'description')
        .map(([k, v]) => [k, structureOnly(v)]),
    );
  }
  return node;
}
const compactSchema = structureOnly(measureSchema);

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const err = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] });

/**
 * Inline the formula template body into a measure's `abatement.computed` for
 * audit (closes the §3/§6 "every number traceable" gap on `formula_ref` measures
 * — the AST otherwise lives in the engine, opaque to a single get_measure
 * response). Read-time only; the stored document keeps the compact
 * `{formula_ref, bindings}` shape — single source of truth, no drift.
 *
 * Adds, when `abatement.computed.formula_ref` is set:
 *   • `formula`        — the full template `{id, label, description, output, expr, slots}` from `library.formulaTemplates`
 *   • `resolved_ast`   — the template AST with each `{slot}` replaced by the binding's `{ref}` / `{const}` (symbolic, NOT numeric — `compute_measure` is for evaluation)
 *   • `human`          — `resolved_ast` rendered as a plain-language string
 *
 * On an unknown template id or unbound slot, the measure is still returned; the
 * failure surfaces as `formula_resolution_error` (a single get_measure call
 * never breaks because the library moved).
 */
function enrichComputedForAudit(measure: Measure, library: Library): Measure {
  const a = measure.abatement;
  if (!a?.computed?.formula_ref) return measure;
  const ref = a.computed.formula_ref;
  const tmpl = library.formulaTemplates[ref];
  if (!tmpl) {
    return { ...measure, abatement: { ...a, computed: { ...a.computed,
      formula_resolution_error: `Unknown formula template '${ref}' (not in library.formulaTemplates).` } } } as Measure;
  }
  try {
    const resolved_ast = bindTemplateSymbolic(tmpl, a.computed.bindings);
    const human = renderAst(resolved_ast, (k) => k);
    return { ...measure, abatement: { ...a, computed: { ...a.computed,
      formula: tmpl, resolved_ast, human } } } as Measure;
  } catch (e) {
    return { ...measure, abatement: { ...a, computed: { ...a.computed,
      formula: tmpl, formula_resolution_error: (e as Error).message } } } as Measure;
  }
}

// Some MCP clients serialize an object-typed argument as a JSON STRING. Declare the
// measure as an object (so well-behaved clients send an object) AND tolerate a
// stringified document by parsing it before validation — otherwise a string slips
// through as the "measure" and every field reads back undefined.
const asObject = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
};
const measureArg = z.preprocess(asObject, z.record(z.string(), z.any()));
const AUTH_ERR = 'Authentication required — sign in to the web app and supply a Supabase access token (Bearer header for the hosted server, MCP_USER_TOKEN for stdio). The MCP tools are restricted to logged-in users.';

/** Build a configured measure-authoring MCP server for one caller + library. */
export function buildServer(deps: ServerDeps): McpServer {
  const { user, library, seedMeasures, getSeedMeasure } = deps;
  const peersOf = (id: string): Measure[] => seedMeasures.filter((m) => m.id !== id);

  const server = new McpServer({ name: 'macc-measure', version: '0.1.0' });

  // ── Resource: the measure STRUCTURE (field help + JSON Schema), public ───────────
  server.registerResource(
    'measure-schema',
    'schema://measure',
    {
      title: 'Measure structure: field help + JSON Schema',
      description: 'The measure STRUCTURE: field-level help (panels/fields/enums/sourcing/formulas) plus the JSON Schema of a measure document. For the authoring JUDGMENT (procedure, mechanism/baseline choice, sectors, sourcing, formula AST, potential, checks) read guide://measure FIRST.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({ uiHelp: library.uiHelp, jsonSchema: compactSchema }),
      }],
    }),
  );

  // ── Resource: the authoring guide (the macc-measure-authoring skill), public ──────
  server.registerResource(
    'measure-guide',
    'guide://measure',
    {
      title: 'Measure authoring guide',
      description: 'The full measure-authoring judgment: the model of a measure, the quality bar and the workflow (classify → build on the library → bottom-up formulas → limiting factor → validate → publish), the sector playbook, sourcing discipline, the formula AST and the validation checks. Read this BEFORE create_measure / update_measure / upsert_library_entity.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: SKILL_GUIDE.markdown,
      }],
    }),
  );

  // ── Tool: the authoring guide + structure, as a TOOL (public, no auth) ───────────
  // Mirror of the guide://measure + schema://measure resources, exposed as a tool because
  // some MCP clients (e.g. claude.ai custom connectors) surface tools to the model but not
  // resources. One call returns everything needed to author a measure.
  server.registerTool(
    'get_authoring_guide',
    {
      title: 'Get the measure authoring guide',
      description: 'Read the full measure-authoring guide (the macc-measure-authoring skill: model, quality bar, workflow, sectors, sourcing, formula AST, potential, checks) PLUS the measure JSON Schema and field-level help. Call this FIRST, before create_measure / update_measure / upsert_library_entity. Public — no sign-in required.',
      inputSchema: {},
    },
    async () => ({
      content: [{
        type: 'text' as const,
        text: `${SKILL_GUIDE.markdown}\n\n---\n\n# Measure JSON Schema (structure)\n\n\`\`\`json\n${JSON.stringify(compactSchema)}\n\`\`\`\n\n# Field-level help (uiHelp)\n\n\`\`\`json\n${JSON.stringify(library.uiHelp)}\n\`\`\`\n`,
      }],
    }),
  );

  // ── Tool: list the measures visible to the signed-in user ──────────────────────
  server.registerTool(
    'list_measures',
    { title: 'List measures', description: 'List the measures visible to the signed-in user (their drafts + published), with headline outputs and model-eligibility.', inputSchema: {} },
    async () => {
      if (!user) return err(AUTH_ERR);
      const rows = await dbListMeasures(user);
      return ok({ user: user.email ?? user.userId, measures: rows.map(({ data: m, scope: storedScope }) => {
        const c = compute(m, library);
        const v = validate(m, library, peersOf(m.id));
        return { id: m.id, name: m.name, storedScope, maturity: m.maturity_stage, mac: c.mac, abatementKt: c.abatementKt, eligibleForModel: v.eligibleForModel };
      }) });
    },
  );

  // ── Tool: fetch one measure's full document ────────────────────────────────────
  server.registerTool(
    'get_measure',
    { title: 'Get measure', description: 'Return the full measure document by id. For measures whose abatement uses a `formula_ref` (named engine template like `delta_ef`), the response inlines the template body (`abatement.computed.formula` — `expr` AST + `slots`), a slot-substituted `resolved_ast` (refs/consts only, NOT evaluated — `compute_measure` is for that), and a `human` rendering, so the §3/§6 audit chain reaches the leaves from one call.', inputSchema: { id: z.string().describe('measure id, e.g. "kz-2"') } },
    async ({ id }) => {
      if (!user) return err(AUTH_ERR);
      const m = (await dbGetMeasure(user, id)) ?? getSeedMeasure(id);
      return m ? ok(enrichComputedForAudit(m, library)) : err(`Unknown measure '${id}'`);
    },
  );

  // ── Tool: compute a measure → MaccPoint-compatible outputs ──────────────────────
  server.registerTool(
    'compute_measure',
    { title: 'Compute measure', description: 'Compute MAC / abatement / CAPEX / OPEX / NPV for a measure document (the same engine as the UI).', inputSchema: { measure: measureArg.describe('a measure document — an OBJECT (see schema://measure); a JSON string is also accepted') } },
    async ({ measure }) => {
      if (!user) return err(AUTH_ERR);
      try { return ok(compute(measure as Measure, library)); }
      catch (e) { return err(`compute failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: validate a measure → guardrails + notation completeness ────────────────
  server.registerTool(
    'validate_measure',
    { title: 'Validate measure', description: 'Run the §7 guardrails + §3/§6 notation rule (every number input-or-computed). Returns panel statuses, checks, untagged numbers and model-eligibility.', inputSchema: { measure: measureArg.describe('a measure document — an OBJECT (a JSON string is also accepted)'), peers: z.array(measureArg).optional().describe('other measures sharing a pool (defaults to the seed set)') } },
    async ({ measure, peers }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const p = (peers as Measure[] | undefined) ?? peersOf((measure as Measure).id);
        return ok(validate(measure as Measure, library, p));
      } catch (e) { return err(`validate failed: ${(e as Error).message}`); }
    },
  );

  const advisoryOf = (v: ReturnType<typeof validate>) =>
    [...v.untagged.map((p) => `untagged: ${p}`), ...v.computedNoFormula.map((p) => `no-formula: ${p}`),
     ...Object.entries(v.checks).filter(([, s]) => s === 'warn').map(([k]) => `check ${k}: warn`), ...v.missing];

  // ── Tool: CREATE a new measure (server assigns the id; never collides) ───────────
  server.registerTool(
    'create_measure',
    { title: 'Create measure', description: 'Create a NEW measure. The SERVER assigns its id (kz-N) — do NOT supply one; any `id` you pass is ignored. The document SCOPE is honored: omit it / "draft" → a private work-in-progress (visible only to you), "published" → live in the shared model. Versioned (v1) + attributed. validate() runs as ADVISORY only. Returns the assigned id. (To change an existing measure use update_measure; to publish/retire one use set_measure_scope.)', inputSchema: { measure: measureArg.describe('the measure content as an OBJECT (no id needed; see schema://measure)'), note: z.string().optional().describe('optional note for the version history') } },
    async ({ measure, note }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const res = await dbCreateMeasure(user, measure as Measure, note);
        const v = validate({ ...(measure as Measure), id: res.id }, library, seedMeasures);
        return ok({ id: res.id, action: 'created', author: user.email ?? user.userId, finalScope: res.finalScope, version: res.version, ownerId: res.ownerId, eligibleForModel: v.eligibleForModel, advisory: advisoryOf(v) });
      } catch (e) { return err(`create failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: UPDATE an existing measure (id required; refuses unknown id) ────────────
  server.registerTool(
    'update_measure',
    { title: 'Update measure', description: 'Correct an EXISTING measure by id (the id must already exist — an unknown id is refused, so a typo cannot create a phantom). `measure` is merged into the stored document; its SCOPE is honored. Any logged-in user may edit any measure; the change is versioned + attributed (co-authors tracked). validate() is ADVISORY only.', inputSchema: { id: z.string().describe('the existing measure id, e.g. "kz-2"'), measure: measureArg.describe('the fields to set, as an OBJECT (merged into the stored document)'), note: z.string().optional().describe('change note for the version history') } },
    async ({ id, measure, note }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const res = await dbUpdateMeasure(user, id, measure as Record<string, unknown>, note);
        const full = (await dbGetMeasure(user, id)) ?? ({ ...(measure as Measure), id } as Measure);
        const v = validate(full, library, peersOf(id));
        return ok({ id, action: 'updated', author: user.email ?? user.userId, finalScope: res.finalScope, version: res.version, ownerId: res.ownerId, contributors: res.contributors, eligibleForModel: v.eligibleForModel, advisory: advisoryOf(v) });
      } catch (e) { return err(`update failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: lifecycle — publish / unpublish / archive a measure ────────────────────
  server.registerTool(
    'set_measure_scope',
    { title: 'Archive measure', description: 'Soft-delete a measure: set scope to "archived" — hidden from the curve, but the row + full history are kept (there is no hard delete). The draft/published status is NOT settable here: it is platform-decided, derived automatically by validate() (published ⟺ the measure passes every check). Versioned + attributed.', inputSchema: { id: z.string().describe('measure id'), scope: z.enum(['archived']), note: z.string().optional() } },
    async ({ id, scope, note }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const res = await dbSetScope(user, id, scope, note);
        return ok({ id, action: 'scope-changed', finalScope: res.finalScope, version: res.version, author: user.email ?? user.userId });
      } catch (e) { return err(`set_measure_scope failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: a measure's version history ───────────────────────────────────────────
  server.registerTool(
    'measure_history',
    { title: 'Measure history', description: 'Append-only version history of a measure: each version with its author and change note. Co-authors = the distinct authors.', inputSchema: { id: z.string().describe('measure id') } },
    async ({ id }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const versions = await dbMeasureHistory(user, id);
        return ok({ id, versions, contributors: [...new Set(versions.map((v) => v.author_id).filter(Boolean))] });
      } catch (e) { return err(`history failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: read the whole library/registry (objects/resources/products/indicators/refs/pools/subsectors) ──
  server.registerTool(
    'list_library',
    { title: 'List library', description: 'Read the whole shared registry — objects, resources, products, indicators, refs, pools, subsectors — as raw rows. Use it to reuse existing ids/shapes before authoring a measure or adding a new entity. The library is open collaboration: any signed-in user may add or correct any entity (see upsert_library_entity).', inputSchema: {} },
    async () => {
      if (!user) return err(AUTH_ERR);
      try { return ok(await dbListLibrary(user)); }
      catch (e) { return err(`list_library failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: create/correct a library entity (open collaboration; versioned + attributed) ──
  server.registerTool(
    'upsert_library_entity',
    {
      title: 'Upsert library entity',
      description: 'Create or correct one library entity and save it to the shared registry (open collaboration — any signed-in user may edit any entity; every write is versioned + attributed). `kind` selects the entity table; `entity` is the row (must include `id`). Shapes: object {id,name,kind,description?,rules?,lifetime_yrs?}; resource {id,name,unit}; product {id,name,unit,service_unit?,sector_ref?,technology_ref?}; indicator {id,key,owner_kind,owner_ref,value,unit?,reference_ref?,provenance?}; ref {id,type,range_min,range_max,unit,source?}; pool {id,caps_ref,annual_flow,unit,sector_ref,baseline_emissions_kt?}; subsector {id,sector_ref,name}; unit {id (the unit string),dim (exponent vector over the base dims energy/mass/mass_co2/time/currency/count/area/volume; {} = scalar),scale (to the canonical base unit)}; bridge {id,from:{dim,carrier?},via:[{name,dim,indicator?}],to:{dim,carrier?},expr (AST over the `from`+via slots),carrier_rule?,authoring}. unit and bridge are validated server-side: a unit needs a base-dim vector + finite non-zero scale, a bridge`s expr must fold to its declared `to` — an inconsistent one is rejected.',
      inputSchema: {
        kind: z.enum(Object.keys(LIBRARY_TABLES) as [string, ...string[]]).describe('object | resource | product | indicator | ref | pool | subsector | unit | bridge'),
        entity: z.record(z.string(), z.any()).describe('the entity row (snake_case columns; must include id)'),
      },
    },
    async ({ kind, entity }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const res = await dbUpsertLibraryEntity(user, kind, entity as Record<string, unknown>);
        return ok({ ...res, author: user.email ?? user.userId });
      } catch (e) { return err(`upsert_library_entity failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: a library entity's version history ───────────────────────────────────
  server.registerTool(
    'library_history',
    { title: 'Library entity history', description: 'Append-only version history of one library entity: each version with its author. Co-authors = the distinct authors.', inputSchema: { kind: z.enum(Object.keys(LIBRARY_TABLES) as [string, ...string[]]), id: z.string() } },
    async ({ kind, id }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const versions = await dbLibraryHistory(user, kind, id);
        return ok({ kind, id, versions, contributors: [...new Set(versions.map((v) => v.author_id).filter(Boolean))] });
      } catch (e) { return err(`library_history failed: ${(e as Error).message}`); }
    },
  );

  return server;
}
