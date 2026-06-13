// Browser Supabase client — the ONE place the Supabase SDK is instantiated.
// This module is imported only by the collaboration layer, which is itself
// lazy-loaded behind `collabEnabled` (src/lib/config.ts), so the static core
// bundle never pulls in `@supabase/supabase-js`.
//
// Auth is fully client-side (PKCE, session in localStorage) — no server runtime,
// no `@supabase/ssr`, no middleware/route handlers. That keeps the collaboration
// layer compatible with the static export and a $0 static host: the OAuth
// redirect returns to a static page and the SDK exchanges the code in-browser
// (detectSessionInUrl).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from '@/lib/config';

let _client: SupabaseClient | null = null;

/** Lazily create (once) and return the browser client. Call only when collabEnabled. */
export function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase not configured — guard calls with collabEnabled');
  }
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }
  return _client;
}
