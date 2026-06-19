// Auth + direct-publish + versioning smoke for the MCP server:
//   • tools refuse without a user token (logged-in only);
//   • a logged-in user publishes DIRECTLY to the model (no review) — even a measure
//     with advisory warnings goes published;
//   • a SECOND user corrects the same measure → version 2, two co-authors, owner
//     unchanged; the history records both.
// Mints two throwaway users via the admin API, drives the server as each, cleans up.
//   npx tsx mcp/auth-smoke.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getSeedMeasure } from '../src/lib/measure/library';

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
  const transport = new StdioClientTransport({
    command: 'npx', args: ['tsx', 'mcp/measure-server.ts'],
    env: { ...(process.env as Record<string, string>), MCP_USER_TOKEN: token ?? '' },
  });
  const client = new Client({ name: 'auth-smoke', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

const admin = createClient(url, service, { auth: { persistSession: false } });

async function mintUser(tag: string): Promise<{ uid: string; token: string; email: string }> {
  const ts = Date.now();
  const email = `mcp-${tag}+${ts}@example.com`;
  const password = `Pw-${tag}-${ts}`;
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error(`createUser(${tag}): ${ce.message}`);
  const signer = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error: se } = await signer.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn(${tag}): ${se.message}`);
  return { uid: created.user!.id, token: sess.session!.access_token, email };
}

async function main() {
  // 1) gate.
  const anonClient = await connect();
  console.log(`no-token create → ${isErr(await anonClient.callTool({ name: 'create_measure', arguments: { measure: { name: { ru: 'x', en: 'x' } } } })) ? 'REFUSED ✓' : 'ALLOWED ✗'}`);
  await anonClient.close();

  // 2) two authors.
  const A = await mintUser('alice');
  const B = await mintUser('bob');
  console.log(`authors: A=${A.uid.slice(0, 8)}…, B=${B.uid.slice(0, 8)}…`);

  // 3) A CREATES a measure — server assigns the id (no collision possible).
  const m = structuredClone(getSeedMeasure('kz-16')) as Partial<ReturnType<typeof getSeedMeasure>> & Record<string, unknown>;
  delete (m as { id?: string }).id;
  (m as { scope?: string }).scope = 'published';
  const ca = await connect(A.token);
  const created = parse(await ca.callTool({ name: 'create_measure', arguments: { measure: m, note: 'created by Alice' } }));
  const id = created.id as string;
  console.log(`A create → id=${id} scope=${created.finalScope} version=${created.version} (v1: ${created.version === 1})`);
  await ca.close();

  // 4) B UPDATES the same id → v2, two co-authors, owner stays A. Unknown id refused.
  const cb = await connect(B.token);
  const upd = parse(await cb.callTool({ name: 'update_measure', arguments: { id, measure: { name: { ru: 'правка Боба', en: 'Bob edit' } }, note: 'corrected by Bob' } }));
  console.log(`B update → version=${upd.version} contributors=${upd.contributors.length} ownerStaysA=${upd.ownerId === A.uid}`);
  console.log(`update unknown id → ${isErr(await cb.callTool({ name: 'update_measure', arguments: { id: 'kz-nope-x', measure: {} } })) ? 'REFUSED ✓' : 'ALLOWED ✗'}`);
  const arch = parse(await cb.callTool({ name: 'set_measure_scope', arguments: { id, scope: 'archived' } }));
  console.log(`archive → finalScope=${arch.finalScope} (soft-delete)`);
  const hist = parse(await cb.callTool({ name: 'measure_history', arguments: { id } }));
  console.log(`history → ${hist.versions.length} versions, ${hist.contributors.length} co-authors`);
  await cb.close();

  // 5) verify in DB + cleanup.
  const row = await admin.from('measures').select('owner_id,scope,version').eq('id', id).single();
  console.log(`DB → owner=${(row.data!.owner_id as string).slice(0, 8)}… scope=${row.data!.scope} version=${row.data!.version} (owner==A: ${row.data!.owner_id === A.uid})`);
  await admin.from('measure_versions').delete().eq('measure_id', id);
  await admin.from('measures').delete().eq('id', id);
  await admin.auth.admin.deleteUser(A.uid);
  await admin.auth.admin.deleteUser(B.uid);
  console.log('cleaned up (measure + 2 users)');
  console.log('AUTH-SMOKE OK');
}
main().catch((e) => { console.error('AUTH-SMOKE FAIL:', e); process.exit(1); });
