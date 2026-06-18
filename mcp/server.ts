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
import measureSchema from '../data/measure.schema.json';
import type { Library, Measure } from '../src/lib/measure/schema';
import { dbListMeasures, dbGetMeasure, dbUpsertMeasure, dbMeasureHistory, dbListLibrary, dbUpsertLibraryEntity, dbLibraryHistory, LIBRARY_TABLES, type AuthedUser } from './db';

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
const AUTH_ERR = 'Authentication required — sign in to the web app and supply a Supabase access token (Bearer header for the hosted server, MCP_USER_TOKEN for stdio). The MCP tools are restricted to logged-in users.';

/** Build a configured measure-authoring MCP server for one caller + library. */
export function buildServer(deps: ServerDeps): McpServer {
  const { user, library, seedMeasures, getSeedMeasure } = deps;
  const peersOf = (id: string): Measure[] => seedMeasures.filter((m) => m.id !== id);

  const server = new McpServer({ name: 'macc-measure', version: '0.1.0' });

  // ── Resource: the single measure-authoring instruction (notation + schema), public ──
  server.registerResource(
    'measure-notation',
    'schema://measure',
    {
      title: 'Measure authoring notation + schema',
      description: 'The measure-notation framework (panels/fields/enums/sourcing/formulas) plus the JSON Schema of a measure. The single instruction for authoring a measure.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({ notation: library.notation, jsonSchema: compactSchema }),
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
    { title: 'Get measure', description: 'Return the full measure document by id.', inputSchema: { id: z.string().describe('measure id, e.g. "kz-2"') } },
    async ({ id }) => {
      if (!user) return err(AUTH_ERR);
      const m = (await dbGetMeasure(user, id)) ?? getSeedMeasure(id);
      return m ? ok(m) : err(`Unknown measure '${id}'`);
    },
  );

  // ── Tool: compute a measure → MaccPoint-compatible outputs ──────────────────────
  server.registerTool(
    'compute_measure',
    { title: 'Compute measure', description: 'Compute MAC / abatement / CAPEX / OPEX / NPV for a measure document (the same engine as the UI).', inputSchema: { measure: z.any().describe('a measure document (see schema://measure)') } },
    async ({ measure }) => {
      if (!user) return err(AUTH_ERR);
      try { return ok(compute(measure as Measure, library)); }
      catch (e) { return err(`compute failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: validate a measure → guardrails + notation completeness ────────────────
  server.registerTool(
    'validate_measure',
    { title: 'Validate measure', description: 'Run the §7 guardrails + §3/§6 notation rule (every number input-or-computed). Returns panel statuses, checks, untagged numbers and model-eligibility.', inputSchema: { measure: z.any().describe('a measure document'), peers: z.array(z.any()).optional().describe('other measures sharing a pool (defaults to the seed set)') } },
    async ({ measure, peers }) => {
      if (!user) return err(AUTH_ERR);
      try {
        const p = (peers as Measure[] | undefined) ?? peersOf((measure as Measure).id);
        return ok(validate(measure as Measure, library, p));
      } catch (e) { return err(`validate failed: ${(e as Error).message}`); }
    },
  );

  // ── Tool: upsert (direct publish; validate() is advisory only) ──────────────────
  server.registerTool(
    'upsert_measure',
    { title: 'Publish measure', description: 'Create or correct a measure and publish it directly to the model (no server-side review). Any logged-in user may edit any measure; the change is versioned and attributed (co-authors are tracked). validate() still runs but is ADVISORY only (returned as `advisory`, never blocking).', inputSchema: { measure: z.any().describe('a measure document'), note: z.string().optional().describe('optional change note for the version history') } },
    async ({ measure, note }) => {
      if (!user) return err(AUTH_ERR);
      const m = measure as Measure;
      try {
        const v = validate(m, library, peersOf(m.id));
        const advisory = [...v.untagged.map((p) => `untagged: ${p}`), ...v.computedNoFormula.map((p) => `no-formula: ${p}`), ...Object.entries(v.checks).filter(([, s]) => s === 'warn').map(([k]) => `check ${k}: warn`), ...v.missing];
        const res = await dbUpsertMeasure(user, m, note);
        return ok({
          id: m.id,
          author: user.email ?? user.userId,
          finalScope: res.finalScope,
          version: res.version,
          ownerId: res.ownerId,
          contributors: res.contributors,
          eligibleForModel: v.eligibleForModel,
          advisory,
        });
      } catch (e) { return err(`publish failed: ${(e as Error).message}`); }
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
      description: 'Create or correct one library entity and save it to the shared registry (open collaboration — any signed-in user may edit any entity; every write is versioned + attributed). `kind` selects the entity table; `entity` is the row (must include `id`). Shapes: object {id,name,kind,description?,rules?,lifetime_yrs?}; resource {id,name,unit}; product {id,name,unit,service_unit?,sector_ref?,object_ref?}; indicator {id,key,owner_kind,owner_ref,value,unit?,reference_ref?,provenance?}; ref {id,type,range_min,range_max,unit,source?}; pool {id,caps_ref,annual_flow,unit,sector_ref,baseline_emissions_kt?}; subsector {id,sector_ref,name}.',
      inputSchema: {
        kind: z.enum(Object.keys(LIBRARY_TABLES) as [string, ...string[]]).describe('object | resource | product | indicator | ref | pool | subsector'),
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
