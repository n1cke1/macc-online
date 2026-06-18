// The MCP API handler (apiRoute = /mcp). The OAuth provider routes here only AFTER it
// validated the client's access token, exposing the authenticated user in `ctx.props`
// (set at /authorize). We then run the SAME measure-authoring MCP as the other hosts:
//   • mint a short Supabase JWT from props.userId → a user-scoped client (RLS),
//   • build the server (mcp/server.ts) with the Supabase-loaded library + measures,
//   • drive the Web-standard Streamable-HTTP transport (stateless JSON).
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../../../mcp/server';
import { loadLibrary, loadMeasures } from '../../../src/lib/measure/load-supabase';
import type { AuthedUser } from '../../../mcp/db';
import type { Library, Measure } from '../../../src/lib/measure/schema';
import { mintUserJwt, anonClient, userClient } from './supabase';
import type { Env, UserProps } from './index';

// The authority graph is static → load once per warm isolate.
let libraryCache: Library | null = null;

export const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as unknown as { props?: UserProps }).props;
    if (!props?.userId) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    const anon = anonClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
    const token = await mintUserJwt(props.userId, env.SUPABASE_JWT_SECRET);
    const client = userClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, token);
    const user: AuthedUser = { userId: props.userId, email: props.email, client };

    const library = (libraryCache ??= await loadLibrary(anon));
    const measures = await loadMeasures(client);
    const server = buildServer({
      user,
      library,
      seedMeasures: measures,
      getSeedMeasure: (id: string) => measures.find((m: Measure) => m.id === id),
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  },
};
