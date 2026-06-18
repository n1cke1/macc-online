// §9 — local proof of the EDGE handler's logic, without a Deno deploy.
//
// Builds the SAME `createMcpHandler` the Edge Function uses — library + measures loaded
// from the live Supabase authority tables (load-supabase.ts), identity from the Bearer
// header — and drives it over a real HTTP socket via the node:http bridge. This covers
// everything except the Deno runtime itself (import resolution at deploy time):
//   • library loads from Supabase (not the file seed) and computes kz-2 correctly;
//   • measures come from the DB (published);
//   • no token → tools refuse, notation resource public; Bearer JWT → tools answer.
//   npx tsx mcp/edge-smoke.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpHandler } from './http-handler';
import { loadLibrary, loadMeasures } from '../src/lib/measure/load-supabase';
import { startHttpServer } from './http-server';
import type { AuthedUser } from './supabase';
import type { Library } from '../src/lib/measure/schema';

function env(file: string, key: string): string {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}
const url = env('.env.supabase.local', 'SUPABASE_URL') || env('.env.local', 'NEXT_PUBLIC_SUPABASE_URL');
const anonKey = env('.env.local', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const service = env('.env.supabase.local', 'SUPABASE_SERVICE_ROLE_KEY');
const parse = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0].text);
const isErr = (r: unknown) => (r as { isError?: boolean }).isError === true;

async function connect(endpoint: string, token?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: 'edge-smoke', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

async function main() {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });

  // The Edge Function's exact handler: Supabase-backed library + measures.
  let libraryCache: Library | null = null;
  const handler = createMcpHandler({
    getLibrary: async () => (libraryCache ??= await loadLibrary(anon)),
    getMeasures: async (user: AuthedUser | null) => loadMeasures(user?.client ?? anon),
  });

  const { server } = await startHttpServer(0, handler);
  const port = (server.address() as { port: number }).port;
  const ep = `http://localhost:${port}/mcp`;
  console.log(`Edge-equivalent handler (Supabase-backed) on ${ep}`);

  // 1) Public resource + gate without a token.
  const anonC = await connect(ep);
  const res = await anonC.readResource({ uri: 'schema://measure' });
  const payload = JSON.parse((res.contents[0] as { text: string }).text);
  console.log(`no-token: resource → notation+schema: ${!!payload.notation && !!payload.jsonSchema ? '✓' : '✗'}`);
  console.log(`no-token: list_measures → ${isErr(await anonC.callTool({ name: 'list_measures', arguments: {} })) ? 'REFUSED ✓' : 'ALLOWED ✗'}`);
  await anonC.close();

  // 2) Mint a throwaway user → Bearer token.
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const ts = Date.now();
  const email = `mcp-edge+${ts}@example.com`;
  const password = `Pw-edge-${ts}`;
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error(`createUser: ${ce.message}`);
  const uid = created.user!.id;
  const { data: sess, error: se } = await anon.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn: ${se.message}`);
  const token = sess.session!.access_token;
  console.log(`user: ${email.split('@')[0]} (${uid.slice(0, 8)}…)`);

  // 3) Authenticated: list / get / compute — proving the Supabase-loaded library is right.
  const authC = await connect(ep, token);
  const list = parse(await authC.callTool({ name: 'list_measures', arguments: {} }));
  console.log(`auth: list_measures → count=${list.measures.length} (e.g. ${list.measures.slice(0, 3).map((m: { id: string; mac: number }) => `${m.id}@${m.mac.toFixed(1)}`).join(', ')})`);
  const got = parse(await authC.callTool({ name: 'get_measure', arguments: { id: 'kz-2' } }));
  const comp = parse(await authC.callTool({ name: 'compute_measure', arguments: { measure: got } }));
  console.log(`auth: compute kz-2 (Supabase library) → MAC=${comp.mac.toFixed(2)} opex=${comp.opex.toFixed(1)} (expect 193.76 / 928.1)`);
  await authC.close();

  // 4) Cleanup.
  await admin.auth.admin.deleteUser(uid);
  await new Promise<void>((r) => server.close(() => r()));

  if (Math.abs(comp.mac - 193.76) > 0.5) throw new Error(`kz-2 MAC drifted under the Supabase library: ${comp.mac}`);
  console.log('EDGE-SMOKE OK (Edge handler logic verified against live Supabase; deploy runs the same code in Deno)');
}
main().catch((e) => { console.error('EDGE-SMOKE FAIL:', e); process.exit(1); });
