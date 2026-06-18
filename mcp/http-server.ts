// §9 — local Node host for the hosted MCP: a node:http bridge to the Web-standard
// handler (`mcp/http-handler.ts`). It converts each Node request to a Web `Request`,
// calls `handleMcpRequest`, and writes the Web `Response` back. The SAME handler runs
// unchanged on Supabase Edge (`Deno.serve(handleMcpRequest)`, step C) — this bridge
// only exists so the identical code is reachable over a real socket under Node for
// development and the HTTP smoke.
//
// Run: `npm run mcp-http` (listens on MCP_HTTP_PORT, default 8787, path /mcp).
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { handleMcpRequest } from './http-handler';

type WebHandler = (request: Request) => Promise<Response>;

const ENDPOINT = '/mcp';

/** Build a Web `Request` from a buffered Node request. */
function toWebRequest(nreq: IncomingMessage, port: number, body: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(nreq.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v != null) headers.set(k, v);
  }
  const method = nreq.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && body.length) init.body = body;
  return new Request(`http://localhost:${port}${nreq.url ?? '/'}`, init);
}

/**
 * Start the bridge on `port`; resolves once listening. `handler` defaults to the
 * file-backed handler; the Edge smoke passes a Supabase-backed one to exercise the
 * exact code the Edge Function runs (`mcp/edge-smoke.ts`).
 */
export function startHttpServer(
  port = Number(process.env.MCP_HTTP_PORT ?? 8787),
  handler: WebHandler = handleMcpRequest,
): Promise<{ server: Server; port: number; url: string }> {
  const server = createServer((nreq, nres) => {
    if (!nreq.url?.startsWith(ENDPOINT)) { nres.writeHead(404).end('not found'); return; }
    const chunks: Buffer[] = [];
    nreq.on('data', (c) => chunks.push(c as Buffer));
    nreq.on('end', async () => {
      try {
        const webRes = await handler(toWebRequest(nreq, port, Buffer.concat(chunks).toString('utf8')));
        const headers: Record<string, string> = {};
        webRes.headers.forEach((v, k) => { headers[k] = v; });
        nres.writeHead(webRes.status, headers);
        nres.end(await webRes.text());
      } catch (e) {
        nres.writeHead(500, { 'content-type': 'application/json' });
        nres.end(JSON.stringify({ error: String(e) }));
      }
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, port, url: `http://localhost:${port}${ENDPOINT}` })));
}

// CLI: run directly to host the server.
if (process.argv[1] && process.argv[1].endsWith('http-server.ts')) {
  startHttpServer().then(({ url }) => console.error(`macc-measure MCP (HTTP) ready on ${url}`));
}
