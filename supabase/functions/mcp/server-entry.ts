// Supabase Edge Function: the hosted measure-authoring MCP (§9).
//
// A THIN wrapper — `Deno.serve` over the shared Web-standard handler
// (`mcp/http-handler.ts`). The MCP server definition, the tool set and the transport
// are all shared verbatim with the local stdio (`mcp/measure-server.ts`) and Node-HTTP
// (`mcp/http-server.ts`) entries; only the runtime + the library/measures source differ:
//   • identity — `Authorization: Bearer <Supabase JWT>` (the web session token);
//   • library  — the 0007 authority tables via `load-supabase.ts` (runtime = Supabase),
//                not the bundled file seed;
//   • measures — published rows (anon-visible) for the pool peer-sum + get fallback.
//
// Deploy:  supabase functions deploy mcp --no-verify-jwt
//   --no-verify-jwt because this function does its OWN header auth and the notation
//   resource (`schema://measure`) is intentionally public — the gateway must not reject
//   token-less requests. SUPABASE_URL / SUPABASE_ANON_KEY are auto-injected secrets.
// Endpoint: https://<ref>.functions.supabase.co/mcp
import { createClient } from '@supabase/supabase-js';
import { createMcpHandler } from '../../../mcp/http-handler.ts';
import { loadLibrary, loadMeasures } from '../../../src/lib/measure/load-supabase.ts';
import type { Library } from '../../../src/lib/measure/schema.ts';
import type { AuthedUser } from '../../../mcp/supabase.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

// The authority graph is static → load once per warm instance. Published measures
// (peer pool sums + the get fallback) can change, so load those per request, under the
// caller's client when signed in (sees their drafts too), else anon (published only).
let libraryCache: Library | null = null;
const handle = createMcpHandler({
  getLibrary: async () => (libraryCache ??= await loadLibrary(anon)),
  getMeasures: async (user: AuthedUser | null) => loadMeasures(user?.client ?? anon),
});

Deno.serve(handle);
