-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — collaboration layer schema (v1.1)
--
-- Three tables: profiles (one per signed-in expert), comments (the decision
-- journal, anchored to curve / project / assumption / scenario), and scenarios
-- (named, saveable lever sets). RLS and the privileged RPCs live in the next
-- two migrations; this file is structure only.
--
-- Anchored review is the point of the whole layer: a comment's (target_type,
-- target_id) pins it to a specific model object — most importantly an individual
-- input assumption (target_id = the assumption `key`, e.g. 'coalPrice'), which is
-- where expert work on the model actually happens.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enums ────────────────────────────────────────────────────────────────────
create type user_role     as enum ('user', 'reviewer', 'owner');
create type comment_target as enum ('curve', 'project', 'assumption', 'scenario');
create type comment_status as enum ('open', 'accepted', 'rejected', 'wontfix');
create type scenario_vis   as enum ('private', 'unlisted', 'public');

-- ── profiles ─────────────────────────────────────────────────────────────────
-- One row per authenticated user, created on first sign-in (trigger in 0003).
-- `role` drives the decision-journal privileges: reviewer/owner can set comment
-- status and pin; owner can delete anything and promote others.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Anonymous',
  avatar_url   text,
  role         user_role not null default 'user',
  created_at   timestamptz not null default now()
);

comment on table public.profiles is 'Public profile + role for each signed-in expert.';

-- ── scenarios ────────────────────────────────────────────────────────────────
-- A named lever set, saveable by signed-in users and comparable in the UI.
-- `levers` is the same {coalPrice, gasPrice, electricityPrice, discountRate}
-- shape the static core URL-encodes for anonymous users. Stamped with the model
-- version it was authored against so it stays interpretable across model swaps.
create table public.scenarios (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  levers        jsonb not null,
  visibility    scenario_vis not null default 'private',
  model_version text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index scenarios_owner_idx      on public.scenarios (owner_id);
create index scenarios_visibility_idx on public.scenarios (visibility);

comment on table public.scenarios is 'Saved, comparable lever sets; stamped with model_version.';

-- ── comments ─────────────────────────────────────────────────────────────────
-- The decision journal. Each root comment (parent_id is null) carries a status;
-- replies inherit their thread via parent_id. Anchored to a model object via
-- (target_type, target_id). Soft-deleted (is_deleted) so threads stay coherent.
create table public.comments (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles (id) on delete cascade,
  target_type   comment_target not null,
  target_id     text not null,                 -- project id, assumption key, scenario id, or 'kz' for the curve
  scenario_id   uuid references public.scenarios (id) on delete set null,
  parent_id     uuid references public.comments (id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 5000),
  status        comment_status not null default 'open',
  is_pinned     boolean not null default false,
  is_deleted    boolean not null default false,
  model_version text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Fast anchor lookup: "all comments on this assumption / project / …".
create index comments_anchor_idx on public.comments (target_type, target_id, created_at);
create index comments_parent_idx on public.comments (parent_id);
create index comments_author_idx on public.comments (author_id);

comment on table public.comments is 'Anchored review comments; root comments carry a decision status.';

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger comments_touch  before update on public.comments
  for each row execute function public.touch_updated_at();
create trigger scenarios_touch before update on public.scenarios
  for each row execute function public.touch_updated_at();
