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
