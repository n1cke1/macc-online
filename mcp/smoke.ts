// Smoke test for mcp/measure-server.ts WITHOUT a user token: the instruction resource
// is public, but every tool is gated to logged-in users (see mcp/auth-smoke.ts for the
// authenticated path). `npx tsx mcp/smoke.ts`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  const transport = new StdioClientTransport({
    command: 'npx', args: ['tsx', 'mcp/measure-server.ts'],
    // MCP_SKIP_ENV_FILE → no service-account auto-login, so this is a true no-token run.
    env: { ...(process.env as Record<string, string>), MCP_USER_TOKEN: '', MCP_SKIP_ENV_FILE: '1' },
  });
  const client = new Client({ name: 'smoke', version: '0.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log('tools:', tools.tools.map((t) => t.name).join(', '));

  const res = await client.readResource({ uri: 'schema://measure' });
  const doc = JSON.parse((res.contents[0] as { text: string }).text);
  console.log('resource schema://measure → uiHelp groups:', Object.keys(doc.uiHelp).join(', '));

  const guide = await client.readResource({ uri: 'guide://measure' });
  const guideText = (guide.contents[0] as { text: string }).text;
  console.log(`resource guide://measure → ${(guideText.length / 1024).toFixed(1)} kB, workflow section: ${guideText.includes('# D. Workflow') ? '✓' : '✗'}`);

  const gtool = await client.callTool({ name: 'get_authoring_guide', arguments: {} });
  const gtext = ((gtool as { content: { text: string }[] }).content)[0].text;
  console.log(`tool get_authoring_guide (no token) → ${(gtext.length / 1024).toFixed(1)} kB, guide+schema: ${gtext.includes('# D. Workflow') && gtext.includes('JSON Schema') ? '✓' : '✗'}`);

  const r = await client.callTool({ name: 'list_measures', arguments: {} });
  const refused = (r as { isError?: boolean }).isError === true;
  console.log(`list_measures without token → ${refused ? 'REFUSED ✓ (login required)' : 'ALLOWED ✗'}`);

  await client.close();
  if (!refused) { console.error('SMOKE FAIL: tools must refuse without a user token'); process.exit(1); }
  console.log('SMOKE OK (resource public; tools gated)');
}
main().catch((e) => { console.error('SMOKE FAIL:', e); process.exit(1); });
