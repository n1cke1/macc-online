// Env-agnostic Supabase data access for the MCP — no process / node:fs / Deno here, so
// it typechecks and bundles under any runtime (Node, Deno Edge, Cloudflare Workers).
// Identity (how a caller becomes a user-scoped client) lives in the runtime-specific
// `mcp/supabase.ts` (Node/Deno) or the Worker; this module only takes a client.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Measure } from '../src/lib/measure/schema';

/** A resolved caller: their id + a Supabase client scoped to them (RLS applies). */
export interface AuthedUser { userId: string; email?: string; client: SupabaseClient }

export async function dbListMeasures(client: SupabaseClient): Promise<Array<{ id: string; scope: string; data: Measure }>> {
  const { data, error } = await client.from('measures').select('id,scope,data');
  if (error) throw new Error(`list: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, scope: r.scope as string, data: r.data as Measure }));
}

export async function dbGetMeasure(client: SupabaseClient, id: string): Promise<Measure | null> {
  const { data, error } = await client.from('measures').select('data').eq('id', id).maybeSingle();
  if (error) throw new Error(`get: ${error.message}`);
  return (data?.data as Measure) ?? null;
}

/**
 * Direct publish (owner decision: no server-side review). Any logged-in user creates
 * or corrects a measure via the measure_publish RPC: merge → published → version+1 →
 * append a history row attributed to the author (auth.uid()). Returns the new version
 * and the co-authors (distinct authors across the history).
 */
export async function dbUpsertMeasure(user: AuthedUser, measure: Measure, note?: string): Promise<{
  finalScope: string; version: number | null; ownerId: string | null; contributors: string[];
}> {
  const { data, error } = await user.client.rpc('measure_publish', { p_id: measure.id, p_patch: measure, p_note: note ?? null });
  if (error) throw new Error(`publish (as ${user.userId}): ${error.message}`);
  const row = data as { version?: number; owner_id?: string; scope?: string } | null;
  const { data: vers } = await user.client.from('measure_versions').select('author_id').eq('measure_id', measure.id);
  const contributors = [...new Set((vers ?? []).map((r) => r.author_id as string).filter(Boolean))];
  return { finalScope: row?.scope ?? 'published', version: row?.version ?? null, ownerId: row?.owner_id ?? null, contributors };
}

/** Version history of a measure (append-only): version, author, note, time. */
export async function dbMeasureHistory(client: SupabaseClient, id: string): Promise<Array<{ version: number; author_id: string | null; note: string | null; created_at: string }>> {
  const { data, error } = await client.from('measure_versions').select('version,author_id,note,created_at').eq('measure_id', id).order('version');
  if (error) throw new Error(`history: ${error.message}`);
  return (data ?? []) as never;
}
