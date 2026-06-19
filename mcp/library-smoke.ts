// Open-library smoke for the MCP server (migration 0010):
//   • library tools refuse without a user token (logged-in only);
//   • a logged-in user ADDS a new object + indicator to the shared registry;
//   • list_library shows them; a correction bumps the version; history attributes both
//     edits to the author; the DB row carries last_author_id = the user.
// Mints a throwaway user via the admin API, drives the stdio server as them, cleans up.
//   npx tsx mcp/library-smoke.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function env(file: string, key: string): string {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}
const url = env('.env.supabase.local', 'SUPABASE_URL') || env('.env.local', 'NEXT_PUBLIC_SUPABASE_URL');
const anon = env('.env.local', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
const service = env('.env.supabase.local', 'SUPABASE_SERVICE_ROLE_KEY');
const parse = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0].text);
const isErr = (r: unknown) => (r as { isError?: boolean }).isError === true;

async function connect(token?: string) {
  // No token → skip the .env service-account auto-login so the gate test really refuses.
  // With a token → let the server read .env for SUPABASE_URL/ANON to validate it.
  const extra: Record<string, string> = token ? { MCP_USER_TOKEN: token } : { MCP_USER_TOKEN: '', MCP_SKIP_ENV_FILE: '1' };
  const transport = new StdioClientTransport({
    command: 'npx', args: ['tsx', 'mcp/measure-server.ts'],
    env: { ...(process.env as Record<string, string>), ...extra },
  });
  const client = new Client({ name: 'library-smoke', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

const admin = createClient(url, service, { auth: { persistSession: false } });

async function mintUser(tag: string) {
  const ts = Date.now();
  const email = `mcp-${tag}+${ts}@example.com`;
  const password = `Pw-${tag}-${ts}`;
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error(`createUser: ${ce.message}`);
  const signer = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error: se } = await signer.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn: ${se.message}`);
  return { uid: created.user!.id, token: sess.session!.access_token, email };
}

async function main() {
  const ts = Date.now();
  const objId = `obj-libtest-${ts}`;
  const indId = `ind-libtest-${ts}`;

  // 1) gate
  const anonClient = await connect();
  console.log(`no-token upsert_library_entity → ${isErr(await anonClient.callTool({ name: 'upsert_library_entity', arguments: { kind: 'object', entity: { id: 'x' } } })) ? 'REFUSED ✓' : 'ALLOWED ✗'}`);
  console.log(`no-token list_library → ${isErr(await anonClient.callTool({ name: 'list_library', arguments: {} })) ? 'REFUSED ✓' : 'ALLOWED ✗'}`);
  await anonClient.close();

  // 2) author
  const A = await mintUser('libauthor');
  console.log(`author A=${A.email.split('@')[0]} (${A.uid.slice(0, 8)}…)`);
  const ca = await connect(A.token);

  // 3) add a NEW object + indicator (authority stratum — previously read-only)
  const obj = parse(await ca.callTool({ name: 'upsert_library_entity', arguments: { kind: 'object', entity: { id: objId, name: 'Smoke test asset', kind: 'structure' } } }));
  const ind = parse(await ca.callTool({ name: 'upsert_library_entity', arguments: { kind: 'indicator', entity: { id: indId, key: 'capex_ud', owner_kind: 'object', owner_ref: objId, value: 123, unit: '$/kW' } } }));
  console.log(`add object → ${obj.table}/${obj.id} v${obj.version} by ${obj.author.slice(0, 8)}…`);
  console.log(`add indicator → ${ind.table}/${ind.id} v${ind.version} (authority write OK)`);

  // 4) list_library sees them
  const lib = parse(await ca.callTool({ name: 'list_library', arguments: {} }));
  const seenObj = (lib.objects as { id: string }[]).some((o) => o.id === objId);
  const seenInd = (lib.indicators as { id: string }[]).some((i) => i.id === indId);
  console.log(`list_library → objects=${lib.objects.length} indicators=${lib.indicators.length} | sees new object=${seenObj} indicator=${seenInd}`);

  // 5) correct the indicator → version 2
  const ind2 = parse(await ca.callTool({ name: 'upsert_library_entity', arguments: { kind: 'indicator', entity: { id: indId, key: 'capex_ud', owner_kind: 'object', owner_ref: objId, value: 150, unit: '$/kW' } } }));
  const hist = parse(await ca.callTool({ name: 'library_history', arguments: { kind: 'indicator', id: indId } }));
  console.log(`correct indicator → v${ind2.version}; history=${hist.versions.length} versions, contributors=${hist.contributors.length}`);
  await ca.close();

  // 6) verify attribution in DB + cleanup
  const row = await admin.from('indicators').select('value,last_author_id').eq('id', indId).single();
  console.log(`DB indicator → value=${row.data!.value} last_author==A: ${row.data!.last_author_id === A.uid}`);

  const ok = seenObj && seenInd && ind2.version === 2 && hist.versions.length === 2 && row.data!.value === 150 && row.data!.last_author_id === A.uid;

  await admin.from('library_versions').delete().in('entity_id', [objId, indId]);
  await admin.from('indicators').delete().eq('id', indId);
  await admin.from('objects').delete().eq('id', objId);
  await admin.auth.admin.deleteUser(A.uid);
  console.log('cleaned up (object + indicator + versions + user)');
  if (!ok) { console.error('LIBRARY-SMOKE FAIL'); process.exit(1); }
  console.log('LIBRARY-SMOKE OK');
}
main().catch((e) => { console.error('LIBRARY-SMOKE FAIL:', e); process.exit(1); });
