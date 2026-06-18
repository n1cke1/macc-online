# Hosted MCP — phase design (§9)

Design contract for turning the local **stdio** measure-authoring MCP into a **remote,
hosted** MCP. Owner priority for this phase (2026-06-18): *«настроить удалённый/хостируемый
MCP, вероятно через Supabase»*. This doc is the source of truth for scope; nothing here is
coded yet.

## 1. Where we are

- The MCP server ([`mcp/measure-server.ts`](../mcp/measure-server.ts)) runs over **stdio**
  (`StdioServerTransport`). It exposes one resource (`schema://measure` → notation + JSON
  Schema) and five tools (`list/get/compute/validate/upsert/history`), all reusing the same
  calc core as the UI.
- Identity ([`mcp/supabase.ts`](../mcp/supabase.ts)): a **service account**
  (`mcp-agent@example.com`) auto-logs-in from `.env.supabase.local`; every tool runs under a
  user-scoped Supabase client (RLS). Writes go through the `measure_publish` RPC (direct
  publish, versioned, attributed — session-10 model).
- Registered in `.mcp.json` as `npx tsx mcp/measure-server.ts`; `claude mcp list → ✓`.

**The one architectural blocker for hosting:** `compute()` (MAC/NPV) evaluates PV through
**HyperFormula** ([`compile.ts`](../src/lib/measure/compile.ts)). HF is a heavy, Node-oriented
bundle — friction in a Deno/Edge serverless runtime. Everything else in the calc path is
already pure-TS and Deno-clean (`guardrails.ts` `evalJs`, `economicsRollup`, `abatementJs`).

## 2. Two things we discovered that de-risk the phase

1. **SDK 1.29 ships a Web-standard transport.**
   `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` exports
   `WebStandardStreamableHTTPServerTransport` whose entry point is
   `handleRequest(request: Request): Promise<Response>`. Its own JSDoc shows the Deno shape:
   ```ts
   Deno.serve((request) => transport.handleRequest(request))
   ```
   → No manual JSON-RPC/SSE protocol work, no Node `http` shim. The MCP server object is
   unchanged; only the transport swaps. **This removes the biggest unknown for Supabase Edge.**

2. **The Deno calc-core pattern is already proven in-repo.**
   [`validate-and-promote/index.ts`](../supabase/functions/validate-and-promote/index.ts)
   already imports `guardrails.ts` / `templates.ts` / `schema.ts` from `src/lib/measure/` and
   bundles `graph.seed.json` via `with { type: 'json' }`, runs in Deno today. The hosted MCP
   Edge Function follows the same import pattern.

Net effect: the phase is mostly **plumbing + one small PV port**, not a rewrite.

## 3. Host decision (the one real fork)

| Option | MCP HTTP transport | HF / PV | Auth | $ | Fit |
|---|---|---|---|---|---|
| **Supabase Edge (Deno)** ← owner-leaning | `WebStandard…handleRequest(Request)` native | HF = friction → **PV port required** | Supabase JWT in `Authorization` header, native | $0 free tier | **Recommended** — same platform as DB/RLS, web-Request transport fits, calc-core pattern proven |
| Cloudflare Worker | Web Request/Response (works), or CF `agents`/`McpAgent` | `nodejs_compat` *might* load HF; risky | JWT header | $0 free tier | Viable, but a second platform to operate; HF-on-Workers unverified |
| Node service (Fly/Render/Railway) | `StreamableHTTPServerTransport` (Node http) native | HF works as-is, **no PV port** | JWT header | small $/mo, not free | Lowest code change, but breaks the $0/self-host ethos and isn't Supabase |

**Recommendation: Supabase Edge.** It matches the owner's lean, keeps one platform, the
web-standard transport fits Deno exactly, and the only cost is the PV port — which is small,
isolated, and parity-gated (and arguably worth doing regardless, to drop a heavy dep from the
server path).

## 4. Workstream A — PV port to pure TS (the only non-plumbing change)

**Goal:** `compute()` produces MAC/NPV with **zero HyperFormula** import, bit-for-bit parity
held by `measure-golden`.

The whole AST whitelist is `add sub mul div sum pv lte gte between (lookup, unused)`. The
pure-TS evaluator `evalJs` already handles all of these **except `pv`**. PV with `fv=0,
type=0` (the only form the model uses) is closed-form:

```
PV(rate, nper, pmt) = -pmt * (1 - (1 + rate)^(-nper)) / rate        // rate ≠ 0
PV(0,    nper, pmt) = -pmt * nper                                    // rate = 0 guard
```

Plan:
1. Add `pv` (and the `^`/`Math.pow` it needs) to `evalJs` in `guardrails.ts`, OR — cleaner —
   lift `evalJs` into its own module `src/lib/measure/eval.ts` as the single pure-TS evaluator,
   and have both `guardrails.ts` and a new pure-TS `economicCore` import it. (Decision D3.)
2. Reimplement `economicCore` and `evalAst`/`evalPredicate` on the pure-TS evaluator. Delete
   the HF import from the runtime calc path.
3. **Keep HF as the parity oracle, not the runtime.** Extend `scripts/measure-golden.ts` to
   assert pure-TS == HF == Excel-cached within the existing tolerance. HF stays a dev/test
   dependency (it already validates the whole curve via `scripts/golden.ts`), it just leaves
   the shipped/served code path.

**Parity risk & mitigation.** HF's PV and a hand-written PV can differ in the last ULPs.
`measure-golden` already passes at rel ~1e-9; the gate is the same tolerance. If a gap appears,
match HF's evaluation order/precision (it computes `(1+r)^-n` then the division) — both use IEEE
doubles, so agreement to ~1e-12 is expected. The golden test makes this a *proof*, not a hope.

**Bonus:** once the server path is HF-free, the UI's lazy calc chunk could also drop HF later
(out of scope here, but the port enables it).

## 5. Workstream B — HTTP transport (shared by all hosts)

Factor the server *definition* out of the *transport* so the same `McpServer` builds once and
binds to either stdio (local dev) or web HTTP (hosted):

- `mcp/server.ts` — `buildServer(deps)` returns a configured `McpServer`. `deps` carries the
  resolved `AuthedUser` + the library, so the tool handlers stay identical.
- `mcp/measure-server.ts` — local stdio entry (unchanged behaviour): resolve service-account
  user → `buildServer` → `StdioServerTransport`.
- Edge entry (Workstream C) — per request: resolve user from the `Authorization` header →
  `buildServer` → `WebStandardStreamableHTTPServerTransport.handleRequest(req)`.

**Statelessness.** Serverless = no sticky sessions. Run the transport in **stateless JSON mode**
(`sessionIdGenerator: undefined`, `enableJsonResponse: true`): each POST is a self-contained
JSON-RPC call, authenticated from its own header, no server-side session map, no SSE stream to
keep alive. This is the documented serverless configuration and matches Edge's request model.

## 6. Workstream C — Supabase Edge Function `mcp`

`supabase/functions/mcp/index.ts`:

```ts
Deno.serve(async (req) => {
  // 1. Auth: Authorization: Bearer <supabase access token> (from web sign-in).
  const user = await authedUserFromHeader(req);          // null → 401 JSON-RPC error
  // 2. Library: load from the Supabase graph tables (Stage-C loader) — runtime = Supabase.
  const library = await loadLibrary(adminOrUserClient);
  // 3. Build the MCP server with {user, library} and a web transport, then hand off.
  const server = buildServer({ user, library });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
});
```

**Library source.** Prefer loading the library from the **Supabase graph tables** via the
existing `src/lib/measure/load-supabase.ts` (`loadLibrary(db)`), not bundled JSON. This honours
the «runtime = Supabase» decision, avoids shipping `graph.seed.json` into the function bundle,
and is one source of truth with the UI (Stage C). The bundled-JSON path
(`with { type: 'json' }`, as in `validate-and-promote`) is the fallback if table loading proves
slow per-invocation (could be memoized across warm invocations). (Decision D4.)

**Notation resource.** `schema://measure` returns `library.notation` + `measure.schema.json`.
The schema JSON can be bundled (it's small, static) or read from a `notation`/`schema` table; bundling is fine.

## 7. Workstream D — Auth (Bearer JWT, per request)

- The web app already mints Supabase session JWTs on sign-in (LinkedIn/Google/email). The MCP
  client sends `Authorization: Bearer <access_token>`.
- `authedUserFromHeader(req)`: read the header → `createClient(url, anon, { global: { headers:
  { Authorization } } })` → `auth.getUser()` → `{ userId, email, client }`. Identical RLS model
  to today's `authedUser`, only the token *source* changes (header vs env).
- **No service-account on the hosted path.** The agent account was a local-dev convenience
  (auto-login from `.env`). Hosted = real signed-in users; the service-account stays only for
  local stdio.
- Token expiry: Supabase access tokens are short-lived (~1h). The pragmatic delivery (per the
  phase plan) is the caller refreshing via the web session and resending the header — full
  OAuth 2.1 / DCR is explicitly out of scope for this phase. (Decision D5.)

## 8. Deploy & secrets

- `supabase functions deploy mcp` (CLI already wired via `scripts/supabase-apply.ts` / the
  session-pooler creds). `SUPABASE_URL` + anon key are auto-injected; `SUPABASE_SERVICE_ROLE_KEY`
  only if the function needs admin (it should **not** — all writes go through the user-scoped
  `measure_publish` RPC, same as today).
- Endpoint: `https://<ref>.functions.supabase.co/mcp`.
- Register for remote clients as an HTTP MCP server (`type: "http"`, `url`, `Authorization`
  header). Local stdio stays in `.mcp.json` for dev.
- **`verify_jwt`**: the function does its own header auth, so deploy with `--no-verify-jwt`
  (or keep gateway JWT verification on and treat it as a first gate — decide at deploy).

## 9. Open decisions to confirm

- **D1 — Host:** Supabase Edge (recommended) vs Cloudflare Worker vs Node service.
- **D2 — PV port now?** Required for Edge/Worker; skippable only for a Node host. Recommend
  doing it regardless (drops a heavy dep, isolated, golden-gated).
- **D3 — Evaluator placement:** extend `evalJs` in `guardrails.ts` vs lift to a shared
  `eval.ts`. Recommend shared module (cleaner, both paths import it).
- **D4 — Edge library source:** Supabase tables (recommended, runtime=Supabase) vs bundled
  `graph.seed.json`.
- **D5 — Token delivery:** header Bearer from web session (recommended, this phase) vs full
  OAuth 2.1/DCR (later phase).
- **D6 — Keep local stdio:** yes (dev), recommended.

## 10. Sequenced steps (each ends green: tsc · measure-golden · build)

1. **A — PV port.** Pure-TS `economicCore`/`evalAst`; `measure-golden` asserts pure-TS == HF ==
   Excel. Remove HF from the runtime calc path. *(Foundational; unblocks any host.)*
2. **B — Transport split.** Extract `buildServer(deps)`; stdio entry unchanged; add a local
   HTTP smoke (Node `WebStandard…` or `StreamableHTTP…`) proving the same tools answer over HTTP.
3. **C — Edge function.** `supabase/functions/mcp/index.ts` + header auth + Supabase library
   loader; deploy; smoke against the live endpoint with a real user JWT.
4. **D — Client wiring & docs.** Document the remote endpoint + header; update memory; decide
   prod `NEXT_PUBLIC_AUTHORING` exposure (carried over from the prod-onboarding tail).

Local stdio MCP remains the dev loop throughout.
