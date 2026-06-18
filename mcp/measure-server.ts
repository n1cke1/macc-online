// Phase 4 — the measure-authoring MCP server, STDIO transport (local dev).
//
// Identity comes from the service account (auto-login from .env.supabase.local) or
// MCP_USER_TOKEN; see `mcp/supabase.ts`. The server definition itself lives in
// `mcp/server.ts` (`buildServer`) and is shared with the hosted web-HTTP transport
// (`mcp/http-handler.ts`). Library/seed are the file bundle today (Supabase in C).
//
// Run: `npm run mcp` (tsx). Speaks newline-delimited JSON-RPC on stdio.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { library, seedMeasures, getSeedMeasure } from '../src/lib/measure/library';
import { authedUser } from './supabase';
import { buildServer } from './server';

async function main() {
  const user = await authedUser();
  const server = buildServer({ user, library, seedMeasures, getSeedMeasure });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so it never corrupts the JSON-RPC stream on stdout.
  console.error(user
    ? `macc-measure MCP server ready on stdio — authenticated as ${user.email ?? user.userId}`
    : 'macc-measure MCP server ready on stdio — NOT logged in; tools will refuse (login required)');
}
main().catch((e) => { console.error('MCP server failed:', e); process.exit(1); });
