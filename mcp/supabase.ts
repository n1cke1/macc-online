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

// Cross-runtime so the same module loads under Node (stdio / local HTTP host) AND Deno
// (Supabase Edge). Node reads creds from process.env (seeded from the .env files below);
// Edge reads them from Deno.env (SUPABASE_URL / SUPABASE_ANON_KEY auto-injected).
declare const Deno: { env: { get(k: string): string | undefined } } | undefined;
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
function getEnv(key: string): string | undefined {
  if (typeof Deno !== 'undefined' && Deno?.env) return Deno.env.get(key);
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

function readEnvFile(rel: string) {
  try {
    const raw = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* file may be absent */ }
}
// Node only: seed process.env from the local env files (Edge has no such files — and
// MCP_SKIP_ENV_FILE lets a test run the genuinely-token-less path — see mcp/smoke.ts).
if (isNode && !process.env.MCP_SKIP_ENV_FILE) {
  readEnvFile('../.env.supabase.local');
  readEnvFile('../.env.local');
}

const url = getEnv('SUPABASE_URL') || getEnv('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

/** Service-role client — used ONLY for the server-authoritative promotion to published. */
export const admin: SupabaseClient | null =
  url && serviceKey && !serviceKey.startsWith('<') ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

export interface AuthedUser { userId: string; email?: string; client: SupabaseClient }

/**
 * Token → user-scoped client (RLS applies as that user). The single identity primitive
 * behind both transports: stdio resolves the token from env, hosted HTTP from the
 * `Authorization` header. null = invalid/expired token (caller refuses).
 */
export async function userFromToken(token: string): Promise<AuthedUser | null> {
  if (!token || !url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? undefined, client };
}

/**
 * Resolve the stdio caller → a user-scoped client. Identity comes from either
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
  return token ? userFromToken(token) : null;
}

/**
 * Resolve the hosted caller from a request's `Authorization: Bearer <jwt>` header
 * (a Supabase access token from signing in to the web app). null = missing/invalid.
 */
export async function authedUserFromHeader(authHeader: string | null): Promise<AuthedUser | null> {
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  return m ? userFromToken(m[1].trim()) : null;
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
