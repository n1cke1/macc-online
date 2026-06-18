// Worker-side Supabase clients. The project signs user JWTs with ES256 (asymmetric
// keys), so a trusted server CANNOT mint a user token from a shared secret. The OAuth
// Worker has already authenticated the user (ctx.props.userId), so it accesses Supabase
// with the service_role and scopes by that id explicitly in the data layer (mcp/db.ts,
// migration 0009). No JWT minting.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Anonymous client (world-readable graph + published measures). */
export function anonClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

/** Service-role client — RLS-bypassing; the data layer scopes by user id explicitly. */
export function serviceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
