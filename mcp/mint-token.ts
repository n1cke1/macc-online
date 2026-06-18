// §9 — print a fresh Supabase access token for the hosted MCP's `Authorization`
// header. Signs in the service account (MCP_EMAIL / MCP_PASSWORD from
// .env.supabase.local) and prints ONLY the JWT on stdout, so it can be captured:
//
//   export MACC_MCP_TOKEN="$(npm run -s mcp-token)"
//
// then a remote client (or curl) sends `Authorization: Bearer $MACC_MCP_TOKEN`.
// Tokens expire in ~1h — re-run to refresh (auto-refresh / OAuth is a later §9 step).
// Real users get their token from the web sign-in instead of this dev helper.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function env(file: string, key: string): string {
  try {
    const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : '';
  } catch { return ''; }
}
const url = env('.env.supabase.local', 'SUPABASE_URL') || env('.env.local', 'NEXT_PUBLIC_SUPABASE_URL');
const anon = env('.env.local', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const email = env('.env.supabase.local', 'MCP_EMAIL');
const password = env('.env.supabase.local', 'MCP_PASSWORD');

async function main() {
  if (!url || !anon || !email || !password) {
    console.error('mint-token: missing SUPABASE_URL / anon key / MCP_EMAIL / MCP_PASSWORD in .env files');
    process.exit(1);
  }
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error(`mint-token: sign-in failed: ${error?.message ?? 'no session'}`);
    process.exit(1);
  }
  // ONLY the token on stdout (diagnostics go to stderr) so `$(...)` capture is clean.
  console.error(`token for ${email} (expires ~1h)`);
  process.stdout.write(data.session.access_token);
}
main().catch((e) => { console.error('mint-token failed:', e); process.exit(1); });
