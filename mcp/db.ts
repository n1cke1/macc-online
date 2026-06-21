// Env-agnostic Supabase data access for the MCP — no process / node:fs / Deno here, so
// it typechecks and bundles under any runtime (Node, Deno Edge, Cloudflare Workers).
//
// Two identity modes, both carried by `AuthedUser`:
//   • user-scoped (stdio MCP, Edge, web editor) — `client` holds the user's real token,
//     RLS applies, writes go through measure_publish (auth.uid()).
//   • service-role (the OAuth Worker — the project signs user JWTs with ES256, so a
//     trusted server can't mint one) — `client` is the service_role admin, RLS is
//     bypassed, so reads filter `published OR owner_id` explicitly and writes go through
//     measure_publish_admin(author) (granted to service_role only, migration 0009).
// Setting `serviceRole: true` selects the second mode; otherwise the first.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Library, Measure } from '../src/lib/measure/schema';
import { ingest, formulaHash } from '../src/lib/measure/ingest';
import { validateUnit } from '../src/lib/measure/dimensions';
import { validateBridge } from '../src/lib/measure/bridges';
import type { Bridge } from '../src/lib/measure/bridges';

/** A resolved caller: their id + a Supabase client. `serviceRole` → the client bypasses
 * RLS, so scope by `userId` explicitly (see the two modes above). */
export interface AuthedUser { userId: string; email?: string; client: SupabaseClient; serviceRole?: boolean }

/** Rows the user may see: published, plus their own (matches RLS; required when the
 * client is service-role and RLS is bypassed). */
const visibleTo = (userId: string) => `scope.eq.published,owner_id.eq.${userId}`;

export async function dbListMeasures(user: AuthedUser): Promise<Array<{ id: string; scope: string; data: Measure }>> {
  const { data, error } = await user.client.from('measures').select('id,scope,data').or(visibleTo(user.userId));
  if (error) throw new Error(`list: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, scope: r.scope as string, data: r.data as Measure }));
}

export async function dbGetMeasure(user: AuthedUser, id: string): Promise<Measure | null> {
  const { data, error } = await user.client.from('measures').select('data').eq('id', id).or(visibleTo(user.userId)).maybeSingle();
  if (error) throw new Error(`get: ${error.message}`);
  return (data?.data as Measure) ?? null;
}

/**
 * R1 write path: every measure write is a FULL-DOCUMENT REPLACE through the single
 * ingest gate (src/lib/measure/ingest — ajv schema, orphan-source prune, formula_hash +
 * change_kind, should-ref). The gate's verdict blocks a bad write before the RPC; its
 * `formula_hash`/`change_kind` ride along in `p_meta` onto the version row. The user path
 * uses measure_publish/_create (auth.uid()); the service-role path the _admin variants.
 * Returns the new version, co-authors, and the gate's advisory warnings.
 */
interface WriteResult { id: string; finalScope: string; version: number | null; ownerId: string | null; contributors: string[]; warnings: string[]; droppedSources: string[] }

async function contributorsOf(user: AuthedUser, id: string): Promise<string[]> {
  const { data } = await user.client.from('measure_versions').select('author_id').eq('measure_id', id);
  return [...new Set((data ?? []).map((r) => r.author_id as string).filter(Boolean))];
}

/**
 * CREATE a new measure. The SERVER allocates the id (kz-N, N ≥ 27) — the client never
 * picks one, so an LLM can't collide with an existing/seeded measure. v1 + history. The
 * document is gated first (validated with a placeholder id the RPC then overwrites).
 */
export async function dbCreateMeasure(user: AuthedUser, measure: Measure, library: Library, note?: string): Promise<WriteResult> {
  // the schema requires an id; create has none yet, so validate with a placeholder the
  // server overwrites (measure_create forces the real kz-N regardless of what we send).
  const g = ingest({ ...(measure as Measure), id: (measure as { id?: string }).id ?? 'kz-pending' }, library);
  if (!g.ok) throw new Error(`ingest blocked: ${g.errors.join('; ')}`);
  const { id: _drop, ...payload } = g.doc as Measure & { id?: string }; // server owns the id
  const p_meta = { formula_hash: g.formula_hash };
  const rpc = user.serviceRole
    ? user.client.rpc('measure_create_admin', { p_data: payload, p_author: user.userId, p_note: note ?? null, p_meta })
    : user.client.rpc('measure_create', { p_data: payload, p_note: note ?? null, p_meta });
  const { data, error } = await rpc;
  if (error) throw new Error(`create (as ${user.userId}): ${error.message}`);
  const row = data as { id: string; version?: number; owner_id?: string; scope?: string };
  return { id: row.id, finalScope: row.scope ?? 'draft', version: row.version ?? 1, ownerId: row.owner_id ?? null, contributors: await contributorsOf(user, row.id), warnings: g.warnings, droppedSources: g.droppedSources };
}

/**
 * UPDATE an EXISTING measure (versioned correction). The id must already exist — an
 * unknown id is refused (no silent create), so a typo can't spawn a phantom measure.
 * `measure` is the COMPLETE document — it REPLACES the stored one (no patch merge), so
 * the caller must send the whole thing (get_measure → edit → send). The gate computes
 * change_kind vs the prior version's formula_hash.
 */
export async function dbUpdateMeasure(user: AuthedUser, id: string, measure: Record<string, unknown>, library: Library, note?: string): Promise<WriteResult> {
  const { data: existing } = await user.client.from('measures').select('id').eq('id', id).maybeSingle();
  if (!existing) throw new Error(`no measure '${id}' to update — use create_measure for a new one (the server assigns its id)`);
  const { data: prev } = await user.client.from('measure_versions')
    .select('formula_hash').eq('measure_id', id).order('version', { ascending: false }).limit(1);
  const prevFormulaHash = (prev?.[0] as { formula_hash?: string | null })?.formula_hash ?? undefined;
  const g = ingest({ ...measure, id } as unknown as Measure, library, { prevFormulaHash });
  if (!g.ok) throw new Error(`ingest blocked: ${g.errors.join('; ')}`);
  const p_meta = { formula_hash: g.formula_hash, change_kind: g.change_kind ?? null };
  const rpc = user.serviceRole
    ? user.client.rpc('measure_publish_admin', { p_id: id, p_data: g.doc, p_author: user.userId, p_note: note ?? null, p_meta })
    : user.client.rpc('measure_publish', { p_id: id, p_data: g.doc, p_note: note ?? null, p_meta });
  const { data, error } = await rpc;
  if (error) throw new Error(`update (as ${user.userId}): ${error.message}`);
  const row = data as { version?: number; owner_id?: string; scope?: string } | null;
  return { id, finalScope: row?.scope ?? 'draft', version: row?.version ?? null, ownerId: row?.owner_id ?? null, contributors: await contributorsOf(user, id), warnings: g.warnings, droppedSources: g.droppedSources };
}

/** Lifecycle: set a measure's scope. Only `archived` (soft-delete) is set here;
 *  draft/published are platform-decided (derived by validate()). Versioned. Re-stores the
 *  stored document with the new scope WITHOUT the ingest gate (content is unchanged), so a
 *  schema-invalid measure (e.g. a half-authored draft) can still be archived. */
export async function dbSetScope(user: AuthedUser, id: string, scope: string, note?: string): Promise<WriteResult> {
  const doc = await dbGetMeasure(user, id);
  if (!doc) throw new Error(`no measure '${id}' to set scope — unknown id`);
  const updated = { ...(doc as Measure), scope } as Measure;
  const p_meta = { formula_hash: formulaHash(updated) };
  const p_note = note ?? `scope → ${scope}`;
  const rpc = user.serviceRole
    ? user.client.rpc('measure_publish_admin', { p_id: id, p_data: updated, p_author: user.userId, p_note, p_meta })
    : user.client.rpc('measure_publish', { p_id: id, p_data: updated, p_note, p_meta });
  const { data, error } = await rpc;
  if (error) throw new Error(`set scope (as ${user.userId}): ${error.message}`);
  const row = data as { version?: number; owner_id?: string; scope?: string } | null;
  return { id, finalScope: row?.scope ?? scope, version: row?.version ?? null, ownerId: row?.owner_id ?? null, contributors: await contributorsOf(user, id), warnings: [], droppedSources: [] };
}

/** Version history of a measure (append-only): version, author, note, time. */
export async function dbMeasureHistory(user: AuthedUser, id: string): Promise<Array<{ version: number; author_id: string | null; note: string | null; created_at: string }>> {
  const { data, error } = await user.client.from('measure_versions').select('version,author_id,note,created_at').eq('measure_id', id).order('version');
  if (error) throw new Error(`history: ${error.message}`);
  return (data ?? []) as never;
}

// ── Library (the registry): fully open to logged-in collaboration (migration 0010) ──

/** Library entity kind → its table. The whole library is now world-read + any-authenticated-write. */
export const LIBRARY_TABLES: Record<string, string> = {
  object: 'objects', resource: 'resources', product: 'products',
  indicator: 'indicators', ref: 'refs', subsector: 'subsectors',
  unit: 'units', bridge: 'bridges',
};

/**
 * Server-side semantic validation before a write — the dimensional entities must be sound or
 * the upsert is rejected (an agent cannot poison the vocabulary/registry). A `unit` needs a
 * base-dim vector + finite scale; a `bridge`'s `expr` must fold to its declared `to`.
 */
function assertLibraryEntityValid(kind: string, entity: Record<string, unknown>): void {
  if (kind === 'unit') {
    const errs = validateUnit(entity as { id?: string; dim?: Record<string, number>; scale?: number });
    if (errs.length) throw new Error(`invalid unit: ${errs.join('; ')}`);
  } else if (kind === 'bridge') {
    const errs = validateBridge(entity as unknown as Partial<Bridge>);
    if (errs.length) throw new Error(`invalid bridge: ${errs.join('; ')}`);
  }
}

/** R4 — addressable read filter (was an unconditional dump of all 9 tables). */
export interface LibraryFilter { kind?: string; owner_ref?: string; id?: string; prefix?: string }

/** Read the registry (raw rows per table), optionally narrowed — what an author needs to reuse
 *  ids/shapes or list "indicators of subsector X" without pulling ~270 rows. */
export async function dbListLibrary(user: AuthedUser, filter: LibraryFilter = {}): Promise<Record<string, unknown[]>> {
  if (filter.kind && !LIBRARY_TABLES[filter.kind]) {
    throw new Error(`unknown library kind '${filter.kind}' (expected: ${Object.keys(LIBRARY_TABLES).join(', ')})`);
  }
  const tables = filter.kind ? [LIBRARY_TABLES[filter.kind]] : Object.values(LIBRARY_TABLES);
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    let q = user.client.from(t).select('*');
    if (filter.owner_ref && t === 'indicators') q = q.eq('owner_ref', filter.owner_ref); // owner_ref lives on indicators
    if (filter.id) q = q.eq('id', filter.id);
    if (filter.prefix) q = q.ilike('id', `${filter.prefix}%`);
    const { data, error } = await q;
    if (error) throw new Error(`list ${t}: ${error.message}`);
    out[t] = data ?? [];
  }
  return out;
}

/**
 * Create or correct one library entity (open collaboration; versioned + attributed by
 * the 0010 triggers). The user-scoped path writes as the user (auth.uid() attributes it);
 * the service-role path (OAuth Worker — RLS bypassed) stamps `last_author_id` explicitly.
 */
export async function dbUpsertLibraryEntity(
  user: AuthedUser, kind: string, entity: Record<string, unknown>,
): Promise<{ table: string; id: string; version: number | null }> {
  const table = LIBRARY_TABLES[kind];
  if (!table) throw new Error(`unknown library kind '${kind}' (expected one of: ${Object.keys(LIBRARY_TABLES).join(', ')})`);
  if (!entity || typeof entity.id !== 'string') throw new Error(`library ${kind}: 'id' (string) is required`);
  assertLibraryEntityValid(kind, entity);
  const row = user.serviceRole ? { ...entity, last_author_id: user.userId } : entity;
  const { error } = await user.client.from(table).upsert(row);
  if (error) throw new Error(`upsert ${table} (as ${user.userId}): ${error.message}`);
  const { data: vers } = await user.client.from('library_versions')
    .select('version').eq('entity', table).eq('entity_id', entity.id).order('version', { ascending: false }).limit(1);
  return { table, id: entity.id as string, version: (vers?.[0] as { version?: number })?.version ?? null };
}

/** Append-only version history of one library entity. */
export async function dbLibraryHistory(
  user: AuthedUser, kind: string, id: string,
): Promise<Array<{ version: number; author_id: string | null; created_at: string }>> {
  const table = LIBRARY_TABLES[kind];
  if (!table) throw new Error(`unknown library kind '${kind}'`);
  const { data, error } = await user.client.from('library_versions')
    .select('version,author_id,created_at').eq('entity', table).eq('entity_id', id).order('version');
  if (error) throw new Error(`library history: ${error.message}`);
  return (data ?? []) as never;
}
