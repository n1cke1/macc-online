// Worker-side Supabase identity. The OAuth provider has already authenticated the user
// (ctx.props.userId); to run the MCP tools under that user's RLS we mint a short
// Supabase-compatible access token (HS256, the project JWT secret) with Web Crypto and
// build a user-scoped client — so the exact same data layer (mcp/db.ts) + server
// (mcp/server.ts) as the other hosts work unchanged. No node/Deno APIs here.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const seg = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** Mint a short-lived (5 min) Supabase access token (HS256) for a user id. The project
 * signs JWTs with HS256 + the legacy JWT secret, so Supabase accepts this as that user. */
export async function mintUserJwt(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const data = `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg({ sub: userId, role: 'authenticated', aud: 'authenticated', iss: 'supabase', iat: now, exp: now + 300 })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

/** Anonymous client (world-readable graph + published measures). */
export function anonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

/** User-scoped client (RLS applies as the token's `sub`). */
export function userClient(url: string, anonKey: string, token: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
