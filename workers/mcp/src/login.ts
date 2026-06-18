// The default handler — everything the OAuth provider does NOT route to /mcp. It owns
// the /authorize step and our /callback, bridging authentication to Supabase:
//
//   GET /authorize  → parse the OAuth request, stash it in KV under a txn id, and send
//                     the browser to the web app's /connect page (existing Supabase
//                     sign-in: Google / LinkedIn / email).
//   GET /callback   → the web app returns here with the txn + the user's Supabase access
//                     token; verify it, then completeAuthorization() with the user props.
//
// The provider then issues the code and handles /token + refresh on its own. The MCP
// access token it mints carries our `props` → exposed as `ctx.props` to the /mcp handler.
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import { anonClient } from './supabase';
import type { Env, UserProps } from './index';

export const loginHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return authorize(request, env, url);
    if (url.pathname === '/callback') return callback(env, url);
    return landing();
  },
};

/** /authorize — stash the OAuth request, redirect to the web app's Supabase sign-in. */
async function authorize(request: Request, env: Env, url: URL): Promise<Response> {
  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const txn = crypto.randomUUID();
  await env.OAUTH_KV.put(`txn:${txn}`, JSON.stringify(oauthReq), { expirationTtl: 600 });
  const connect = new URL(`${env.WEB_APP_URL.replace(/\/$/, '')}/ru/connect`);
  connect.searchParams.set('txn', txn);
  connect.searchParams.set('cb', `${url.origin}/callback`);
  return Response.redirect(connect.toString(), 302);
}

/** /callback — verify the Supabase identity returned by the web app, complete the grant. */
async function callback(env: Env, url: URL): Promise<Response> {
  const txn = url.searchParams.get('txn');
  const sb = url.searchParams.get('sb');
  if (!txn || !sb) return new Response('missing txn / sb', { status: 400 });

  const raw = await env.OAUTH_KV.get(`txn:${txn}`);
  if (!raw) return new Response('authorization expired — start again', { status: 400 });
  await env.OAUTH_KV.delete(`txn:${txn}`);
  const oauthReq = JSON.parse(raw) as AuthRequest;

  const { data, error } = await anonClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY).auth.getUser(sb);
  if (error || !data.user) return new Response('invalid Supabase session', { status: 401 });

  const props: UserProps = { userId: data.user.id, email: data.user.email ?? undefined };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: data.user.id,
    metadata: { email: data.user.email ?? null },
    scope: oauthReq.scope ?? [],
    props,
  });
  return Response.redirect(redirectTo, 302);
}

function landing(): Response {
  return new Response(
    'macc-measure MCP (OAuth). Add this server URL as a custom connector in your Claude app — it will walk you through signing in.',
    { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}
