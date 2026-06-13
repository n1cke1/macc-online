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

4. **Environment variables** (Settings → Environment variables → Production). These enable the
   collaboration layer; **omit them to ship the pure static core**. Both are public (anon key is
   RLS-guarded) — copy the exact values from your local `.env.local`:

   | Variable                        | Source              |
   | ------------------------------- | ------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | from `.env.local`   |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from `.env.local`   |

   > `NEXT_PUBLIC_*` vars are inlined at **build** time, so a rebuild is required after changing them.

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

The verification artifacts (`MACC_KZ_29052026_rev.xlsx`, `scripts/etl.py`, `data/kz/*.json`,
`scripts/golden.ts`) are already in the repo and browsable on GitHub. If you also want a stable
GitHub Pages link, enable **Settings → Pages → Deploy from a branch → `main` / root** — but the
canonical app stays on Cloudflare Pages; GitHub Pages here is just a mirror of the static artifacts.

---

## Pre-deploy checklist

```bash
npm run golden     # → PASS, 188/188
npm run build      # → green, static export in out/
```

- [ ] `out/` builds clean
- [ ] golden test passes
- [ ] CF Pages env vars set (or intentionally omitted for pure static core)
- [ ] Supabase Site URL + Redirect URLs include the live domain
- [ ] First deploy loads `/ru/` and `/en/`, sliders recalc, sign-in round-trips
