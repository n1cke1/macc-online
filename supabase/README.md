# Collaboration layer (optional) — Supabase setup

The MACC tool's **static core works with zero backend**. This folder adds the
**optional** collaboration layer: expert sign-in + assumption-anchored review
comments with a decision-journal status workflow + email notifications.

When the two `NEXT_PUBLIC_SUPABASE_*` env vars are **unset**, the app builds and
runs as a pure static bundle — the Supabase client is never loaded (it lives in a
lazy chunk that is only fetched when the layer is enabled). Turning the backend
off at any time leaves the core fully working; comments simply disappear.

## What's here

```
supabase/
  migrations/
    0001_schema.sql        profiles · scenarios · comments + indexes
    0002_rls.sql           Row-Level Security (public read, self-write) + role helpers
    0003_rpcs_triggers.sql profile-on-signup · status/pin guard · reviewer RPCs ·
                           soft-delete · role mgmt · rate-limit · notify webhook
    0004_object_anchors.sql  comment anchors on per-project line items
    0005_measures_schema.sql measures + library (technologies/resources/products)
    0006_measures_rls.sql    RLS · scope guard · measure_upsert
    0007_library_graph.sql   normalized library graph (objects/resources/products/…)
    0008_measure_versions.sql per-edit version log (attributed, append-only)
    0009_measure_publish_admin.sql  publish path
    0010_open_library.sql    open the library to any signed-in author
    0011_respect_scope.sql   honor document scope (draft/published/scenario)
    0012_create_and_archive.sql  split create/update · server-assigned ids · archive
    0013_indicator_subsector.sql limit indicators + subsector on measures
    0014_products_technology_ref.sql  product ↔ technology reference link
  functions/notify/                Deno Edge Function: review email via Resend
  functions/validate-and-promote/  Deno Edge Function: server-side guardrails → publish
  functions/mcp/                   Deno Edge Function: hosted measure-authoring MCP
```

## 1. Create the project & apply migrations

```bash
# Supabase CLI (https://supabase.com/docs/guides/cli)
supabase link --project-ref <your-ref>
supabase db push                 # applies migrations/ in order
# (or paste each .sql into the dashboard SQL editor, in order)
```

## 2. Configure auth providers

Dashboard → **Authentication → Providers**:
- **Google** — enable, paste OAuth client id/secret (Google Cloud Console).
- **LinkedIn (OIDC)** — enable `linkedin_oidc`, paste client id/secret
  (LinkedIn Developers → "Sign in with LinkedIn via OIDC").
- **Email** — enable magic-link (on by default).

Add your site origin(s) to **Authentication → URL Configuration → Redirect URLs**
(e.g. `https://macc-kz.pages.dev/**`, `http://localhost:3000/**`). Auth is
client-side PKCE, so the redirect returns to whatever page the user signed in from.

## 3. Wire the front-end

Copy `.env.example` → `.env.local` and fill in from **Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
```

Rebuild (`npm run build`). The header now shows **Sign in**, and comment threads
appear on the curve, each project drill-down, and each assumption lever.

## 4. Seed an owner

The first time you sign in, a `profiles` row is created with role `user`.
Promote yourself to `owner` once (dashboard SQL editor):

```sql
update public.profiles set role = 'owner' where id = '<your-auth-uid>';
```

Owners/reviewers can then set thread status (open/accepted/rejected/wontfix),
pin, moderate, and promote others via `set_user_role(uid, 'reviewer')`.

## 5. Email notifications (optional)

Deploy the Edge Function and set its secrets:

```bash
supabase functions deploy notify
supabase secrets set RESEND_API_KEY=re_... \
  NOTIFY_FROM="MACC KZ <noreply@your-domain.org>" \
  SITE_URL=https://macc-kz.pages.dev
```

Point the DB trigger at the function (once):

```sql
alter database postgres set app.settings.notify_url =
  'https://<ref>.functions.supabase.co/notify';
alter database postgres set app.settings.service_role_key = '<service-role-jwt>';
```

The `comments_notify` trigger fires only on replies and `@mentions`; it's
wrapped so a failed/unconfigured webhook never blocks a comment insert.
Requires the `pg_net` extension (`create extension if not exists pg_net;`).

## 6. Measure authoring backend (Phase 2)

Adds the writable strata of the §1 entity model (the authority library —
references/pools/checks/subsectors — stays in the published `data/kz/library/*`
files). Apply and deploy:

```bash
supabase db push                          # applies the measures + library migrations (0005–0014) in order
SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt> \
  npm run seed-library                    # loads data/kz/library/graph.seed.json into the graph tables
supabase functions deploy validate-and-promote
# In prod the function gets SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY automatically.
```

Contract:
- **measures** (0005) — one JSONB document each (validated vs `data/measure.schema.json`).
  Read: `published` is world-readable; `draft`/`scenario` are owner-only. Write:
  auth + self-owned; clients may create `draft`/`scenario` only.
- **Promotion to `published` is server-only.** `measures_guard_scope` blocks any
  client from setting it; the `validate-and-promote` function re-runs the four §7
  guardrails (pure-TS, no HyperFormula — see `src/lib/measure/guardrails.ts`,
  pinned equal to the HF `validate()` by `npm run measure-golden`) and publishes
  only if all pass. Call it from the app via `requestPromotion(id)`.
- **measure_upsert(p_id, p_patch, p_scope)** — the §8 coarse-grained partial merge
  (top-level JSONB merge), `SECURITY INVOKER` so RLS + the scope guard apply.
- **Library graph** (0007, Iteration 3) — normalized, English base: `objects` /
  `resources` / `products` (world-read, owner-write), `indicators` (the hub: every
  number, owner + optional `refs` corridor), `refs` / `pools` / `subsectors`
  (authority, read-only), `translations` (separate i18n layer, seeded later).
  Seeded from `data/kz/library/graph.seed.json` via `npm run seed-library`.

> Bundling note: the function imports the shared `guardrails.ts` (+ `ast`/
> `templates`) and the library JSON via relative paths; `validate`/`compile`/
> `@data` are type-only there, so HyperFormula is never pulled into the Deno
> bundle. If the CLI's bundler trips on the cross-dir imports, vendor those few
> files into `functions/_shared/` and adjust the import paths.

## 7. Hosted MCP server (Phase 4 / §9)

The measure-authoring MCP can run remotely as an Edge Function so LLM agents reach the
tools over HTTP (the local stdio server, `npm run mcp`, stays for development). The
server definition (`mcp/server.ts`), tool set and transport are shared across stdio,
the local Node host (`npm run mcp-http`) and the Edge Function — only the runtime and
the library/measures source differ.

```bash
# 1. Pre-bundle for Deno (esbuild inlines the Node-style shared graph + JSON, leaving
#    only npm externals for the import map). Regenerate after changing any module the
#    function pulls in. Output: supabase/functions/mcp/index.ts (committed, generated).
npm run build-edge
# 2. Deploy. --use-api bundles server-side (no Docker); --no-verify-jwt because the
#    handler does its own header auth and schema://measure is public, so the gateway
#    must NOT pre-reject token-less requests. SUPABASE_URL / SUPABASE_ANON_KEY auto-inject.
supabase functions deploy mcp --project-ref <ref> --no-verify-jwt --use-api
# Endpoint: https://<ref>.supabase.co/functions/v1/mcp
```

- **Transport** — Web-standard Streamable-HTTP (`WebStandardStreamableHTTPServerTransport`,
  SDK ≥ 1.29), stateless JSON mode: each POST is a self-contained JSON-RPC call, so the
  serverless instance keeps no session. `server-entry.ts` is a thin
  `Deno.serve(createMcpHandler(...))` over the shared `mcp/http-handler.ts`; it is
  esbuild-bundled to `index.ts` (the deployed file) so the Deno bundler never sees the
  Node-style extensionless / `@data`-alias / attribute-less-JSON imports.
- **Identity** — `Authorization: Bearer <Supabase access token>` (a web-session JWT).
  No token → tools refuse; the `schema://measure` notation resource stays public. There
  is **no** service-account fallback on the hosted path (that is a local-stdio dev aid).
- **Library/measures** — loaded from the 0007 authority tables via `load-supabase.ts`
  (runtime = Supabase), not the file seed. Calc is HyperFormula-free (`eval.ts`), so the
  Deno bundle stays light; `npm run measure-golden` pins the pure-TS core to the HF oracle.
- **Imports** — `supabase/functions/mcp/deno.json` maps the npm specifiers
  (`@modelcontextprotocol/sdk/`, `@supabase/supabase-js`, `zod`); the SDK modules on this
  path import no `node:` built-ins.
- **Register a remote client** (e.g. Claude Code) — an `http` server entry pointing at the
  endpoint, the JWT in the `Authorization` header from an env var:
  ```jsonc
  // .mcp.json (or ~/.claude.json) — for clients OFF this machine. In-repo, the local
  // stdio server (`macc-measure`, auto-login) stays the dev default.
  {
    "mcpServers": {
      "macc-measure-remote": {
        "type": "http",
        "url": "https://<ref>.supabase.co/functions/v1/mcp",
        "headers": { "Authorization": "Bearer ${MACC_MCP_TOKEN}" }
      }
    }
  }
  ```
  Get a token: real users from the web sign-in; for dev, `export MACC_MCP_TOKEN="$(npm run
  -s mcp-token)"` (mints a fresh service-account JWT). Tokens expire ~1h → re-run to
  refresh; auto-refresh / OAuth 2.1 is a later §9 step.
- **Smoke the deployed endpoint:** `MCP_URL=https://<ref>.supabase.co/functions/v1/mcp
  npx tsx mcp/live-smoke.ts` (mints a throwaway user; checks the no-token gate, the public
  resource, and an authenticated compute over the internet).

## Security model (summary)

- **Read:** anyone (anon) reads non-deleted comments and public/unlisted scenarios.
- **Write:** requires auth; you may only insert/edit/delete content you own.
- **Status & pin:** locked by a trigger; settable only via the reviewer/owner
  `SECURITY DEFINER` RPCs — an author cannot accept their own comment.
- **Moderation:** owner can hard-delete; everyone else soft-deletes their own.
- **Anti-spam:** ≤10 comments/user/minute (trigger).
