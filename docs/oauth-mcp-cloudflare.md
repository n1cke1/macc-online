# OAuth remote MCP on Cloudflare Workers — phase design

Goal: a remote MCP server the **Claude apps** (claude.ai web / iOS / Desktop custom
connectors) can add — which requires **OAuth 2.1 + Dynamic Client Registration**, not a
static Bearer header. Owner decision (2026-06-18): host on a **Cloudflare Worker** with
**`@cloudflare/workers-oauth-provider`**. The existing Supabase Edge MCP (header-auth)
stays usable for Claude Code; this adds the OAuth-capable host for the apps.

Nothing here is built yet — this is the contract.

## Why this shape

- The Claude apps only attach a remote MCP through an OAuth handshake (metadata → DCR →
  authorize → token → refresh). **Supabase Auth is not a generic OAuth AS with DCR for
  third-party clients** — it signs in OUR app, so we must run the Authorization Server.
- `@cloudflare/workers-oauth-provider` (0.8.0) is purpose-built for exactly this: it
  serves the metadata, DCR (`/register`), `/authorize`, `/token`, refresh and revoke,
  stores grants/clients/tokens in Workers KV, and hands our MCP handler the authenticated
  user via `ctx.props`. Anthropic's own remote-MCP-with-auth template uses it.
- Our MCP already speaks **Web Request/Response** (`handleMcpRequest`) and the calc core
  is **HyperFormula-free** (`eval.ts`) — both run on the Workers runtime unchanged. So the
  Worker work is the OAuth layer + a Supabase identity bridge, not an MCP rewrite.

## Components

```
Claude app ──OAuth──▶ Cloudflare Worker ( @cloudflare/workers-oauth-provider )
                         ├─ /.well-known/* , /register , /authorize , /token  (lib)
                         ├─ defaultHandler  → login bridge to Supabase (web app)
                         └─ apiHandler /mcp → our buildServer()+handleRequest, as the user
                                               (mint a Supabase JWT from user_id → RLS)
                       Supabase: user login (Google/LinkedIn/email) + measures/library (RLS)
```

1. **OAuthProvider wrapper** (`workers/mcp/src/index.ts`):
   ```ts
   export default new OAuthProvider({
     apiRoute: '/mcp',
     apiHandler: mcpApiHandler,          // our MCP, user from ctx.props
     defaultHandler: loginHandler,       // /authorize → Supabase login bridge
     authorizeEndpoint: '/authorize',
     tokenEndpoint: '/token',
     clientRegistrationEndpoint: '/register',
   });
   ```
   KV namespace `OAUTH_KV` holds clients/grants/tokens.

2. **`mcpApiHandler`** — reuse `buildServer` + the Web-standard transport. The user comes
   from `ctx.props` (set at authorize), NOT a Bearer header. For data access AS the user,
   mint a short Supabase JWT (HS256 with the project JWT secret, Web Crypto — already the
   plan from the API-key idea) → user-scoped Supabase client → existing RLS + measure_publish.

3. **`loginHandler` (`/authorize`) — the Supabase bridge.** The OAuth provider routes
   `/authorize` here. Flow:
   - stash the OAuth request (the provider gives a parsed `oauthReqInfo`) and redirect the
     user to the **web app** `/[locale]/connect?...` (reuses the existing Supabase sign-in:
     Google / LinkedIn / email magic-link);
   - after sign-in the web page redirects back to the Worker callback with the user's
     short-lived Supabase access token (or a one-time handle);
   - the Worker verifies it server-side (`auth.getUser`), then calls
     `env.OAUTH_PROVIDER.completeAuthorization({ request: oauthReqInfo, userId, scope,
     metadata, props: { userId, email } })` → redirects to the app's `redirect_uri` with the
     code. The provider then handles `/token` + refresh on its own.
   - A minimal consent screen can live on the Worker; login itself is delegated to Supabase.

4. **Web app `/connect` route** (`app/[locale]/connect/page.tsx`): a thin page that signs
   the user in (existing auth) and hands the identity back to the Worker callback. Reuses
   the collab auth UI; renders nothing security-sensitive beyond the redirect.

5. **Secrets / bindings** (Worker): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (to mint user JWTs), `OAUTH_KV`
   binding, and a cookie/signing secret for the provider. `wrangler.toml` config.

## Build / deploy

- `workers/mcp/` with `wrangler.toml`; deps `@cloudflare/workers-oauth-provider`,
  `@modelcontextprotocol/sdk`, `@supabase/supabase-js`. Wrangler's esbuild bundles the
  shared TS (`mcp/`, `src/lib/measure/`) — extensionless + JSON imports resolve under
  esbuild; the `@data` alias is type-only (erased) or aliased in the build.
- `wrangler kv namespace create OAUTH_KV`; `wrangler secret put …` for each secret;
  `wrangler deploy`. Endpoint: a `workers.dev` subdomain or a custom domain (e.g.
  `mcp.<domain>`). The owner runs deploy (CF account / `wrangler login`).

## Open inputs (from the owner)

- **CF auth for deploy** — `wrangler login` or a CF API token (like the Supabase access
  token; owner provides / runs deploy).
- **KV namespace** — created once (`wrangler kv namespace create`).
- **Supabase JWT secret** — Dashboard → Settings → API → JWT Secret → a Worker secret.
- **Login-bridge UX** — reuse the web app `/connect` route (recommended) vs a Worker-hosted
  login form.
- **Worker URL** — `*.workers.dev` to start, optional custom domain later.

## Sequence (each step verifiable)

1. **Scaffold** `workers/mcp/` — wrangler.toml, OAuthProvider wiring skeleton, stub handlers
   (no owner creds needed). Local typecheck.
2. **MCP api handler** — port `buildServer`/transport; user from `ctx.props`; JWT-mint for
   data. Unit-smoke the handler shape.
3. **Login bridge** — `/authorize` handler + web `/connect` route + Worker callback +
   `completeAuthorization`.
4. **Wire secrets + KV; `wrangler dev`** — local OAuth dance with the MCP Inspector / a test
   client.
5. **Deploy + connect from the Claude app** — the real acceptance test (add the connector,
   sign in, call a tool).

The Supabase Edge MCP (header-auth) is unaffected and remains for Claude Code.
