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
  functions/notify/        Deno Edge Function: review email via Resend
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

## Security model (summary)

- **Read:** anyone (anon) reads non-deleted comments and public/unlisted scenarios.
- **Write:** requires auth; you may only insert/edit/delete content you own.
- **Status & pin:** locked by a trigger; settable only via the reviewer/owner
  `SECURITY DEFINER` RPCs — an author cannot accept their own comment.
- **Moderation:** owner can hard-delete; everyone else soft-deletes their own.
- **Anti-spam:** ≤10 comments/user/minute (trigger).
