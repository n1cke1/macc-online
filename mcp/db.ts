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
import type { Measure } from '../src/lib/measure/schema';

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
 * Direct publish (owner decision: no server-side review). Merge → published → version+1 →
 * append a history row attributed to the author. The user-scoped path uses measure_publish
 * (author = auth.uid()); the service-role path uses measure_publish_admin (author passed).
 * Returns the new version and the co-authors (distinct authors across the history).
 */
export async function dbUpsertMeasure(user: AuthedUser, measure: Measure, note?: string): Promise<{
  finalScope: string; version: number | null; ownerId: string | null; contributors: string[];
}> {
  const rpc = user.serviceRole
    ? user.client.rpc('measure_publish_admin', { p_id: measure.id, p_patch: measure, p_author: user.userId, p_note: note ?? null })
    : user.client.rpc('measure_publish', { p_id: measure.id, p_patch: measure, p_note: note ?? null });
  const { data, error } = await rpc;
  if (error) throw new Error(`publish (as ${user.userId}): ${error.message}`);
  const row = data as { version?: number; owner_id?: string; scope?: string } | null;
  const { data: vers } = await user.client.from('measure_versions').select('author_id').eq('measure_id', measure.id);
  const contributors = [...new Set((vers ?? []).map((r) => r.author_id as string).filter(Boolean))];
  return { finalScope: row?.scope ?? 'published', version: row?.version ?? null, ownerId: row?.owner_id ?? null, contributors };
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
  indicator: 'indicators', ref: 'refs', pool: 'pools', subsector: 'subsectors',
};

/** Read the whole registry (raw rows per table) — what an author needs to reuse ids/shapes. */
export async function dbListLibrary(user: AuthedUser): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of Object.values(LIBRARY_TABLES)) {
    const { data, error } = await user.client.from(t).select('*');
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
