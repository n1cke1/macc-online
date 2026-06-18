// §9 — the hosted MCP request handler, Web-standard (Request → Response).
//
// This is the host-agnostic core: `(request: Request) => Promise<Response>`, exactly
// the shape `Deno.serve` (Supabase Edge, `supabase/functions/mcp`) and the local
// node:http bridge (`mcp/http-server.ts`) both expect. Per request (serverless =
// stateless):
//   1. resolve the user from `Authorization: Bearer <Supabase JWT>` (null → tools refuse),
//   2. build a fresh server bound to that user + the library/measures,
//   3. drive it through the Web-standard Streamable-HTTP transport in JSON mode.
//
// Stateless JSON mode (`sessionIdGenerator: undefined`, `enableJsonResponse: true`):
// every POST is a self-contained JSON-RPC call — no server-side session map, no SSE
// stream to keep alive — which is what a serverless runtime needs.
//
// `createMcpHandler(deps)` lets the host choose where the library/measures come from:
// the file seed (Node host + smoke; the default export) or the Supabase authority
// tables (Edge — `load-supabase.ts`). The default keeps Node callers unchanged.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { library as fileLibrary, seedMeasures as fileSeed } from '../src/lib/measure/library';
import { authedUserFromHeader, type AuthedUser } from './supabase';
import { buildServer } from './server';
import type { Library, Measure } from '../src/lib/measure/schema';

export interface HandlerDeps {
  /** Resolve the library for a request (memoize upstream if costly — it is static). */
  getLibrary: () => Promise<Library> | Library;
  /** Resolve the peer/seed measures (published from the DB, or the file seed). */
  getMeasures: (user: AuthedUser | null) => Promise<Measure[]> | Measure[];
}

/** Default: the bundled file seed (Node host + smoke). Edge passes Supabase loaders. */
const fileDeps: HandlerDeps = {
  getLibrary: () => fileLibrary,
  getMeasures: () => fileSeed,
};

/** Build a `(Request) => Promise<Response>` handler over the given library/measures source. */
export function createMcpHandler(deps: HandlerDeps = fileDeps) {
  return async function handleMcpRequest(request: Request): Promise<Response> {
    const user = await authedUserFromHeader(request.headers.get('authorization'));
    const [library, measures] = await Promise.all([deps.getLibrary(), deps.getMeasures(user)]);
    const getSeedMeasure = (id: string) => measures.find((m) => m.id === id);
    const server = buildServer({ user, library, seedMeasures: measures, getSeedMeasure });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      // JSON mode buffers the full response, so it is safe to tear down afterwards.
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  };
}

/** The default file-backed handler (Node host + HTTP smoke). */
export const handleMcpRequest = createMcpHandler();
