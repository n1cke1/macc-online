-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security. The contract:
--   • Anonymous users get full READ of non-deleted comments and public scenarios
--     (the static core never authenticates, so public read keeps it working).
--   • Writes require auth and self-ownership (author_id / owner_id = auth.uid()).
--   • Authors edit/delete their own content; status & pin are NOT settable here —
--     they go through SECURITY DEFINER RPCs (0003) gated to reviewer/owner.
--   • Owner can moderate (delete) anything, via a role check helper.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles  enable row level security;
alter table public.comments  enable row level security;
alter table public.scenarios enable row level security;

-- Role helper, SECURITY DEFINER so it can read profiles under RLS.
-- Named app_role (not current_role — that is a reserved SQL keyword/function).
create or replace function public.app_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_reviewer_or_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('reviewer', 'owner');
$$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() = 'owner';
$$;

-- ── profiles ─────────────────────────────────────────────────────────────────
create policy profiles_read_all   on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- Inserts happen via the on-signup trigger (SECURITY DEFINER); no client insert policy.

-- ── comments ─────────────────────────────────────────────────────────────────
-- Read: everyone sees non-deleted comments; authors and owners can still see
-- their own soft-deleted ones (so the UI can show "deleted by you").
create policy comments_read on public.comments for select
  using (not is_deleted or author_id = auth.uid() or public.is_owner());

-- Insert: must be authenticated and stamp yourself as the author.
create policy comments_insert on public.comments for insert
  with check (auth.uid() is not null and author_id = auth.uid());

-- Update body of your own comment ONLY. Crucially, this policy must not let a
-- user flip status/is_pinned — those columns are locked by the guard trigger in
-- 0003 unless the change comes from a privileged RPC.
create policy comments_update_own on public.comments for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Hard delete: owner only (normal "delete" is a soft is_deleted update).
create policy comments_delete_owner on public.comments for delete
  using (public.is_owner());

-- ── scenarios ────────────────────────────────────────────────────────────────
create policy scenarios_read on public.scenarios for select
  using (visibility in ('unlisted', 'public') or owner_id = auth.uid());

create policy scenarios_insert on public.scenarios for insert
  with check (auth.uid() is not null and owner_id = auth.uid());

create policy scenarios_update_own on public.scenarios for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy scenarios_delete_own on public.scenarios for delete
  using (owner_id = auth.uid() or public.is_owner());
