// §9 — HTTP smoke for the hosted MCP. Proves the SAME tools answer over a real
// Streamable-HTTP socket (the Edge target), with identity from the `Authorization`
// header instead of stdio env:
//   • no token            → tools refuse, notation resource still public;
//   • Bearer <Supabase JWT> → list/get/compute/validate answer under the user's RLS.
// Starts the node:http bridge in-process, mints a throwaway user, drives it with the
// SDK Client + StreamableHTTPClientTransport, cleans up.
//   npx tsx mcp/http-smoke.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from './http-server';

function env(file: string, key: string): string {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}
const url = env('.env.supabase.local', 'SUPABASE_URL') || env('.env.local', 'NEXT_PUBLIC_SUPABASE_URL');
const anon = env('.env.local', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const service = env('.env.supabase.local', 'SUPABASE_SERVICE_ROLE_KEY');
const parse = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0].text);
const isErr = (r: unknown) => (r as { isError?: boolean }).isError === true;

/** Connect an MCP Client over HTTP, optionally with a Bearer token. */
async function connect(endpoint: string, token?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: 'http-smoke', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function main() {
  const { server, url: endpoint } = await startHttpServer(0); // 0 = ephemeral port
  // node assigns a real port for ":0"; rebuild the endpoint from the actual address.
  const port = (server.address() as { port: number }).port;
  const ep = `http://localhost:${port}/mcp`;
  console.log(`HTTP MCP listening on ${ep}  (advertised ${endpoint})`);

  // 1) Public resource + tool gate WITHOUT a token.
  const anonC = await connect(ep);
  const res = await anonC.client.readResource({ uri: 'schema://measure' });
  const payload = JSON.parse((res.contents[0] as { text: string }).text);
  console.log(`no-token: resource schema://measure → notation+schema present: ${!!payload.notation && !!payload.jsonSchema ? '✓' : '✗'}`);
  console.log(`no-token: list_measures → ${isErr(await anonC.client.callTool({ name: 'list_measures', arguments: {} })) ? 'REFUSED ✓' : 'ALLOWED ✗'}`);
  await anonC.client.close();

  // 2) Mint a throwaway user → Bearer token.
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const ts = Date.now();
  const email = `mcp-http+${ts}@example.com`;
  const password = `Pw-http-${ts}`;
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error(`createUser: ${ce.message}`);
  const uid = created.user!.id;
  const signer = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error: se } = await signer.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn: ${se.message}`);
  const token = sess.session!.access_token;
  console.log(`user: ${email.split('@')[0]} (${uid.slice(0, 8)}…)`);

  // 3) Authenticated: list / get / compute / validate over HTTP.
  const authC = await connect(ep, token);
  const list = parse(await authC.client.callTool({ name: 'list_measures', arguments: {} }));
  console.log(`auth: list_measures → user=${list.user} count=${list.measures.length} (e.g. ${list.measures.slice(0, 2).map((m: { id: string; mac: number }) => `${m.id}@${m.mac.toFixed(1)}`).join(', ')})`);
  const got = parse(await authC.client.callTool({ name: 'get_measure', arguments: { id: 'kz-2' } }));
  const comp = parse(await authC.client.callTool({ name: 'compute_measure', arguments: { measure: got } }));
  console.log(`auth: get+compute kz-2 → MAC=${comp.mac.toFixed(2)} opex=${comp.opex.toFixed(1)} (expect 193.76 / 928.1)`);
  const val = parse(await authC.client.callTool({ name: 'validate_measure', arguments: { measure: got } }));
  console.log(`auth: validate kz-2 → eligible=${val.eligibleForModel} untagged=${val.untagged.length}`);
  await authC.client.close();

  // 4) Cleanup.
  await admin.auth.admin.deleteUser(uid);
  await new Promise<void>((r) => server.close(() => r()));

  const macOk = Math.abs(comp.mac - 193.76) < 0.5;
  if (!macOk) throw new Error(`kz-2 MAC drifted: ${comp.mac}`);
  console.log('HTTP-SMOKE OK');
}
main().catch((e) => { console.error('HTTP-SMOKE FAIL:', e); process.exit(1); });
