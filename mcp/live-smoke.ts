// §9 — smoke the DEPLOYED Edge Function over the public internet.
//   • tools/call without a token → refused; schema://measure resource → public;
//   • Bearer <minted JWT> → list/get/compute answer under the user's RLS.
// Usage: MCP_URL=https://<ref>.supabase.co/functions/v1/mcp npx tsx mcp/live-smoke.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function env(file: string, key: string): string {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}
const url = env('.env.supabase.local', 'SUPABASE_URL');
const anonKey = env('.env.local', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const service = env('.env.supabase.local', 'SUPABASE_SERVICE_ROLE_KEY');
const MCP_URL = process.env.MCP_URL || `${url.replace(/\/$/, '')}/functions/v1/mcp`;
const parse = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0].text);
const isErr = (r: unknown) => (r as { isError?: boolean }).isError === true;

async function connect(token?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: 'live-smoke', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

async function main() {
  console.log(`Live endpoint: ${MCP_URL}`);

  // 1) Public resource + tool-call gate without a token.
  const anonC = await connect();
  const res = await anonC.readResource({ uri: 'schema://measure' });
  const payload = JSON.parse((res.contents[0] as { text: string }).text);
  console.log(`no-token: resource → notation+schema: ${!!payload.notation && !!payload.jsonSchema ? '✓' : '✗'}`);
  console.log(`no-token: call list_measures → ${isErr(await anonC.callTool({ name: 'list_measures', arguments: {} })) ? 'REFUSED ✓' : 'ALLOWED ✗'}`);
  await anonC.close();

  // 2) Mint a throwaway user → Bearer token.
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const ts = Date.now();
  const email = `mcp-live+${ts}@example.com`;
  const password = `Pw-live-${ts}`;
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error(`createUser: ${ce.message}`);
  const uid = created.user!.id;
  const { data: sess, error: se } = await anon.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn: ${se.message}`);
  console.log(`user: ${email.split('@')[0]} (${uid.slice(0, 8)}…)`);

  // 3) Authenticated over the internet.
  const authC = await connect(sess.session!.access_token);
  const list = parse(await authC.callTool({ name: 'list_measures', arguments: {} }));
  console.log(`auth: list_measures → count=${list.measures.length} (${list.measures.map((m: { id: string; mac: number }) => `${m.id}@${m.mac.toFixed(1)}`).join(', ')})`);
  const got = parse(await authC.callTool({ name: 'get_measure', arguments: { id: 'kz-2' } }));
  const comp = parse(await authC.callTool({ name: 'compute_measure', arguments: { measure: got } }));
  console.log(`auth: compute kz-2 → MAC=${comp.mac.toFixed(2)} opex=${comp.opex.toFixed(1)} (expect 193.76 / 928.1)`);
  await authC.close();

  await admin.auth.admin.deleteUser(uid);
  if (Math.abs(comp.mac - 193.76) > 0.5) throw new Error(`kz-2 MAC drifted: ${comp.mac}`);
  console.log('LIVE-SMOKE OK — hosted MCP works end-to-end over HTTP, on Supabase Edge.');
}
main().catch((e) => { console.error('LIVE-SMOKE FAIL:', e); process.exit(1); });
