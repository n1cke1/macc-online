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
import type { AuthedUser } from './db';

// Re-export the env-agnostic data layer so existing importers keep using `./supabase`.
export { dbListMeasures, dbGetMeasure, dbUpsertMeasure, dbMeasureHistory, type AuthedUser } from './db';

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
