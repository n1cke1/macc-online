-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — normalized library graph (Iteration 3).
--
-- The authoring library as a connected, normalized graph (English base; translation
-- is a separate layer — `translations`). The Indicator is the hub: every library
-- number (capex_ud, ef, price, carbon_footprint, eff …) is a row in `indicators`
-- with owner_kind+owner_ref and an optional reference (refs) it is checked against.
--
-- Storage of record (the source seed is data/kz/library/graph.seed.json; load it
-- with scripts/seed-library.ts). Writable strata: objects/resources/products (the
-- object library, owner-write). Authority strata: refs/pools/subsectors/indicators
-- (read-only; seeded server-side). The published curve (model.data.json) is separate.
--
-- (Table `refs`, not `references` — the latter is a reserved SQL word.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── objects (library technologies) ───────────────────────────────────────────
create table public.objects (
  id           text primary key,
  owner_id     uuid references public.profiles (id) on delete set null,  -- null = base/system seed
  name         text not null,                                            -- English base
  kind         text,                                                     -- capital_asset | modernization | practice | infrastructure
  description  text,
  rules        text,
  lifetime_yrs numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.resources (
  id         text primary key,
  owner_id   uuid references public.profiles (id) on delete set null,
  name       text not null,
  unit       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id          text primary key,
  owner_id    uuid references public.profiles (id) on delete set null,
  name        text not null,
  unit        text,
  service_unit text,
  sector_ref  text,
  object_ref  text references public.objects (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── refs (reference corridors) + pools + subsectors (authority) ───────────────
create table public.refs (
  id        text primary key,
  type      text,
  range_min numeric not null,
  range_max numeric not null,
  unit      text,
  source    jsonb
);

create table public.pools (
  id                    text primary key,
  caps_ref              text,
  annual_flow           numeric not null,
  unit                  text,
  sector_ref            text,
  baseline_emissions_kt numeric
);

create table public.subsectors (
  id         text primary key,
  sector_ref text not null,
  name       text not null
);

-- ── indicators (the hub) ──────────────────────────────────────────────────────
create table public.indicators (
  id            text primary key,
  key           text not null,                                       -- capex_ud | ef | price | carbon_footprint | …
  owner_kind    text not null check (owner_kind in ('object','resource','product','global')),
  owner_ref     text not null,
  value         numeric not null,
  unit          text,
  reference_ref text references public.refs (id) on delete set null,
  provenance    jsonb,
  created_at    timestamptz not null default now()
);
create index indicators_owner_idx on public.indicators (owner_kind, owner_ref);

comment on table public.indicators is 'Hub: every library number, owned by an object/resource/product/global, optionally checked vs a ref.';

-- ── translations (separate i18n layer; English base lives on the rows above) ──
create table public.translations (
  entity_kind text not null,   -- object | resource | product | subsector | …
  entity_ref  text not null,
  field       text not null,   -- name | description | rules | …
  locale      text not null,   -- e.g. 'ru'
  text        text not null,
  primary key (entity_kind, entity_ref, field, locale)
);

create trigger objects_touch   before update on public.objects   for each row execute function public.touch_updated_at();
create trigger resources_touch before update on public.resources for each row execute function public.touch_updated_at();
create trigger products_touch  before update on public.products  for each row execute function public.touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.objects      enable row level security;
alter table public.resources    enable row level security;
alter table public.products     enable row level security;
alter table public.refs         enable row level security;
alter table public.pools        enable row level security;
alter table public.subsectors   enable row level security;
alter table public.indicators   enable row level security;
alter table public.translations enable row level security;

-- objects/resources/products: world-read, owner-write (base seed rows have owner_id null → not client-editable).
create policy objects_read       on public.objects   for select using (true);
create policy objects_insert     on public.objects   for insert with check (auth.uid() is not null and owner_id = auth.uid());
create policy objects_update_own on public.objects   for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy objects_delete_own on public.objects   for delete using (owner_id = auth.uid() or public.is_owner());

create policy resources_read       on public.resources for select using (true);
create policy resources_insert     on public.resources for insert with check (auth.uid() is not null and owner_id = auth.uid());
create policy resources_update_own on public.resources for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy resources_delete_own on public.resources for delete using (owner_id = auth.uid() or public.is_owner());

create policy products_read       on public.products for select using (true);
create policy products_insert     on public.products for insert with check (auth.uid() is not null and owner_id = auth.uid());
create policy products_update_own on public.products for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy products_delete_own on public.products for delete using (owner_id = auth.uid() or public.is_owner());

-- authority strata: world-read, no client write (seeded server-side; service role bypasses RLS).
create policy refs_read         on public.refs         for select using (true);
create policy pools_read        on public.pools        for select using (true);
create policy subsectors_read   on public.subsectors   for select using (true);
create policy indicators_read   on public.indicators   for select using (true);
create policy translations_read on public.translations for select using (true);
