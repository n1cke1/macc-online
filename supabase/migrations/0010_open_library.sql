-- MACC KZ — open the whole authority library to logged-in collaboration (0010).
--
-- Owner decision 2026-06-18: extend the session-10 open-measures model to the entire
-- library. ANY signed-in user may add or correct ANY library entity — not only the
-- extensible strata (objects/resources/products, previously owner-write) but also the
-- authority strata (indicators/refs/pools/subsectors), which were read-only.
-- Accountability is kept the open-collaboration way: every write is attributed
-- (`last_author_id`) and snapshotted append-only (`library_versions`), like measures.
--
-- Trust-anchor note: the curve's numbers (indicators) become user-editable. The audit
-- log + provenance on each indicator preserve who-changed-what for verification.

-- ── 1. attribution column (objects/resources/products already carry owner_id) ──
alter table public.indicators add column if not exists last_author_id uuid references public.profiles (id) on delete set null;
alter table public.refs       add column if not exists last_author_id uuid references public.profiles (id) on delete set null;
alter table public.pools      add column if not exists last_author_id uuid references public.profiles (id) on delete set null;
alter table public.subsectors add column if not exists last_author_id uuid references public.profiles (id) on delete set null;
alter table public.objects    add column if not exists last_author_id uuid references public.profiles (id) on delete set null;
alter table public.resources  add column if not exists last_author_id uuid references public.profiles (id) on delete set null;
alter table public.products   add column if not exists last_author_id uuid references public.profiles (id) on delete set null;

-- ── 2. append-only audit/version log (read public) ──
create table if not exists public.library_versions (
  id         bigserial primary key,
  entity     text not null,            -- table name (objects|resources|products|indicators|refs|pools|subsectors)
  entity_id  text not null,
  version    int  not null,
  author_id  uuid references public.profiles (id) on delete set null,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists library_versions_entity_idx on public.library_versions (entity, entity_id, version);
alter table public.library_versions enable row level security;
drop policy if exists library_versions_read on public.library_versions;
create policy library_versions_read on public.library_versions for select using (true);

-- ── 3. attribution (BEFORE) + snapshot (AFTER) triggers on every entity table ──
create or replace function public.library_attribute() returns trigger language plpgsql security definer as $$
begin
  -- auth.uid() is null for service-role / base seed → keep whatever was supplied
  new.last_author_id := coalesce(auth.uid(), new.last_author_id);
  return new;
end $$;

create or replace function public.library_snapshot() returns trigger language plpgsql security definer as $$
declare v int;
begin
  select coalesce(max(version), 0) + 1 into v
    from public.library_versions where entity = tg_table_name and entity_id = new.id;
  insert into public.library_versions (entity, entity_id, version, author_id, data)
  values (tg_table_name, new.id, v, new.last_author_id, to_jsonb(new));
  return null;
end $$;

do $do$
declare t text;
begin
  foreach t in array array['objects','resources','products','indicators','refs','pools','subsectors'] loop
    execute format('drop trigger if exists %I_attribute on public.%I', t, t);
    execute format('create trigger %I_attribute before insert or update on public.%I for each row execute function public.library_attribute()', t, t);
    execute format('drop trigger if exists %I_snapshot on public.%I', t, t);
    execute format('create trigger %I_snapshot after insert or update on public.%I for each row execute function public.library_snapshot()', t, t);
  end loop;
end $do$;

-- ── 4. open write policies (any authenticated user) across the whole library ──
do $do$
declare t text;
begin
  foreach t in array array['objects','resources','products','indicators','refs','pools','subsectors','translations'] loop
    execute format('drop policy if exists %I_write_any on public.%I', t, t);
    execute format('create policy %I_write_any on public.%I for all using (auth.uid() is not null) with check (auth.uid() is not null)', t, t);
  end loop;
end $do$;
