// Supabase access for the MCP server (authoring layer — NOT the static core).
//
// Identity model (§9): the stdio MCP is for LOGGED-IN users. The caller supplies a
// Supabase user access token (MCP_USER_TOKEN, obtained by signing in to the web app);
// every tool runs under a USER-SCOPED client so RLS applies as that user (sees own
// drafts + published, writes own drafts via the measure_upsert RPC). No token → the
// server refuses. Promotion to `published` is the only server-authoritative step and
// uses the service_role admin client AFTER the server-side validate() passes.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import type { Measure } from '../src/lib/measure/schema';

function readEnvFile(rel: string) {
  try {
    const raw = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* file may be absent */ }
}
readEnvFile('../.env.supabase.local');
readEnvFile('../.env.local');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Service-role client — used ONLY for the server-authoritative promotion to published. */
export const admin: SupabaseClient | null =
  url && serviceKey && !serviceKey.startsWith('<') ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

export interface AuthedUser { userId: string; email?: string; client: SupabaseClient }

/**
 * Resolve the caller → a user-scoped client (RLS applies). Identity comes from either
 * MCP_USER_TOKEN (a user access token), or a service-account auto-login via
 * MCP_EMAIL + MCP_PASSWORD (fresh token each start — no hourly expiry). null = not logged in.
 */
export async function authedUser(): Promise<AuthedUser | null> {
  let token = process.env.MCP_USER_TOKEN;
  if (!token && process.env.MCP_EMAIL && process.env.MCP_PASSWORD && url && anonKey) {
    const signer = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await signer.auth.signInWithPassword({ email: process.env.MCP_EMAIL, password: process.env.MCP_PASSWORD });
    if (!error && data.session) token = data.session.access_token;
  }
  if (!token || !url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? undefined, client };
}

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
