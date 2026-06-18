-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — direct publish + versioning + co-authorship (Phase 4 policy change).
--
-- New stance (owner decision 2026-06-18): authored measures and corrections to
-- existing ones go STRAIGHT to `published` WITHOUT a server-side review gate — but
-- every change is versioned and attributed. Open collaboration: ANY logged-in user
-- may create or correct ANY measure; the version history records who changed what.
--
--   • `measures.version` / `last_author_id` — current version + who last wrote it.
--   • `measure_versions` — an append-only snapshot per change, with `author_id`.
--   • `measure_publish(id, patch, note)` — the single write path: merge → published →
--     version+1 → history row (author = auth.uid()). SECURITY DEFINER, but requires
--     an authenticated caller. Co-authors = distinct author_id over the history.
--   • The old scope-guard (published only via service_role) is REMOVED — publish is
--     now direct. `validate()` still runs in the app/MCP but only as advisory info.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.measures add column if not exists version int not null default 1;
alter table public.measures add column if not exists last_author_id uuid references public.profiles (id) on delete set null;

-- ── append-only version history ────────────────────────────────────────────────
create table if not exists public.measure_versions (
  measure_id text not null references public.measures (id) on delete cascade,
  version    int  not null,
  data       jsonb not null,
  author_id  uuid references public.profiles (id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  primary key (measure_id, version)
);
create index if not exists measure_versions_author_idx on public.measure_versions (author_id);

alter table public.measure_versions enable row level security;
drop policy if exists measure_versions_read on public.measure_versions;
create policy measure_versions_read on public.measure_versions for select using (true);
-- No client insert/update/delete policy: history is written only by measure_publish
-- (SECURITY DEFINER) — it cannot be edited or forged from the client.

-- ── drop the server-authoritative promotion gate (publish is direct now) ─────────
drop trigger if exists measures_guard_scope on public.measures;

-- ── the single write path: create/correct → published, versioned, attributed ─────
create or replace function public.measure_publish(p_id text, p_patch jsonb, p_note text default null)
returns public.measures
language plpgsql security definer set search_path = public as $$
declare
  v_row  public.measures;
  v_data jsonb;
  v_ver  int;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required: measure_publish is for logged-in users';
  end if;

  select * into v_row from public.measures where id = p_id;
  v_data := coalesce(v_row.data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);
  v_ver  := coalesce(v_row.version, 0) + 1;

  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (
    p_id,
    coalesce(v_row.owner_id, v_uid),                                   -- creator stays owner; corrections keep it
    'published',                                                       -- direct publish (no review)
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage',
    coalesce((v_data ->> 'schema_version')::int, 1),
    v_data, v_ver, v_uid
  )
  on conflict (id) do update set
    data           = v_data,
    scope          = 'published',
    sector         = coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    maturity       = v_data ->> 'maturity_stage',
    schema_version = coalesce((v_data ->> 'schema_version')::int, public.measures.schema_version),
    version        = v_ver,
    last_author_id = v_uid
  returning * into v_row;

  insert into public.measure_versions (measure_id, version, data, author_id, note)
  values (p_id, v_ver, v_data, v_uid, p_note);

  return v_row;
end;
$$;

grant execute on function public.measure_publish(text, jsonb, text) to authenticated;
