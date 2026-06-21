# Deploy — MACC KZ

The **static core** is a zero-backend bundle (`out/`) deployable to any static host. The reference
target is **Cloudflare Pages** (free, unlimited bandwidth). The **optional collaboration layer** is
Supabase; the only deploy-time work it needs is pointing its Auth redirect URLs at the live domain.

---

## 1. Cloudflare Pages (static core)

### Connect the repo (auto-deploy on every push)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick the GitHub repo `n1cke1/macc-online`, branch **`main`**.
3. Build settings:

   | Setting             | Value           |
   | ------------------- | --------------- |
   | Framework preset    | **None**        |
   | Build command       | `npm run build` |
   | Build output directory | `out`        |
   | Root directory      | *(leave blank)* |

4. **Environment variables** (Settings → Environment variables → Production).

   **(a) Collaboration layer (public, client-inlined).** Enable comments/auth; **omit them to ship
   the pure static core**. Both are public (anon key is RLS-guarded) — copy from your `.env.local`:

   | Variable                        | Source              |
   | ------------------------------- | ------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | from `.env.local`   |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from `.env.local`   |

   > `NEXT_PUBLIC_*` vars are inlined at **build** time, so a rebuild is required after changing them.

   **(b) Curve bake (build-only secret).** `npm run build` runs a `prebuild` step
   (`scripts/bake-from-supabase.ts`) that regenerates `data/kz/model.data.json` from the Supabase
   measure graph, so an MCP/editor change to a measure shows on the curve after the next deploy. The
   canonical curve includes draft measures (kz-2, kz-16, kz-27), which are anon-invisible per RLS, so
   the bake needs the **service-role** key. It is used only at build time to emit static JSON — it is
   **never** inlined into the client bundle (the name lacks the `NEXT_PUBLIC_` prefix, so Next can't
   leak it).

   | Variable                     | Source                   |
   | ---------------------------- | ------------------------ |
   | `SUPABASE_URL`               | from `.env.supabase.local` |
   | `SUPABASE_SERVICE_ROLE_KEY`  | from `.env.supabase.local` |

   > **If you omit these**, the bake is skipped and the committed `model.data.json` snapshot ships
   > as-is — the static core never depends on backend reachability (principle #1). Trigger a fresh
   > Cloudflare deploy whenever you want the live curve to pick up new measures.

5. Set the Node version: add env var `NODE_VERSION = 20` (or commit a `.node-version` file).
6. **Save and Deploy.** First build publishes to `https://macc-online.pages.dev`.

The repo already ships [`public/_redirects`](../public/_redirects) sending `/` → `/ru/`.

### Custom domain (optional, ~$12/yr)

Pages → your project → **Custom domains** → add domain → follow the CNAME instructions.

---

## 2. Supabase (only if the collaboration layer is enabled)

Once you know the live URL (`https://macc-online.pages.dev` and/or the custom domain), point auth at it.

### Auth redirect URLs

Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://macc-online.pages.dev`
- **Redirect URLs** (add every domain you serve from): 
  `https://macc-online.pages.dev/**`, plus the custom domain `/**`, and keep
  `http://localhost:3000/**` for local dev.

### OAuth providers (Google / LinkedIn)

In each provider's console, add the production callback to the authorized redirect URIs:

```
https://<your-supabase-ref>.supabase.co/auth/v1/callback
```

(That callback is the Supabase project's, not the Pages domain — it usually already exists from
local testing; no change needed unless you rotated the provider app.)

### Email notifications (optional `notify` Edge Function)

Set as Edge Function secrets (not in the client bundle):

```bash
supabase secrets set RESEND_API_KEY=... NOTIFY_FROM="MACC KZ <noreply@your-domain>" SITE_URL=https://macc-online.pages.dev
supabase functions deploy notify
```

---

## 3. GitHub Pages — published trust-anchor artifacts (optional)

The verification artifacts are already in the repo and browsable on GitHub. The curve is now baked
from the **measure-notation seed** (`data/kz/library/{graph,measures}.seed.json`) via
`scripts/bake-from-supabase.ts` + the `measure-golden` test (per-measure bit-for-bit parity vs the
original Excel). The Excel workbook (`MACC_KZ_29052026_rev.xlsx`) + `scripts/etl.py` + `scripts/golden.ts`
remain as the **provenance artifact** the seed was derived from (run `npm run etl` to regenerate the
Excel-sourced JSON for cross-checking), but they are no longer in the build path. If you also want a
stable GitHub Pages link, enable **Settings → Pages → Deploy from a branch → `main` / root** — but the
canonical app stays on Cloudflare Pages; GitHub Pages here is just a mirror of the static artifacts.

---

## Pre-deploy checklist

```bash
npm run golden          # → PASS, 188/188 (Excel-provenance cross-check)
npm run measure-golden  # → PASS (measure-notation parity vs Excel, the curve's trust anchor)
npm run bake -- --check # → curve diff vs committed snapshot, no write (needs service-role)
npm run build           # → bakes curve (prebuild) + green static export in out/
```

- [ ] `out/` builds clean
- [ ] golden + measure-golden pass
- [ ] CF Pages public env vars set (or intentionally omitted for pure static core)
- [ ] CF Pages build secret `SUPABASE_SERVICE_ROLE_KEY` set if the live curve should bake from Supabase
- [ ] Supabase Site URL + Redirect URLs include the live domain
- [ ] First deploy loads `/ru/` and `/en/`, sliders recalc, sign-in round-trips
