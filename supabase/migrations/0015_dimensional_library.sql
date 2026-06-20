-- MACC KZ — units & bridges become first-class library entities (0015).
--
-- L3 (slice 4+): the dimensional vocabulary (unit string → dimension + scale) and the
-- typed bridge registry move into the library so any signed-in user may add or correct
-- them, exactly like objects/resources/etc. The code ships a base seed; these tables are
-- the author-extendable overlay (loaded by load-supabase.ts, merged over the seed).
--
-- Server-side validation (mcp/db.ts assertLibraryEntityValid) gates a write: a unit needs
-- a base-dim vector + finite non-zero scale; a bridge's `expr` must fold to its declared
-- `to`. The DB stores the validated rows; the same attribution + append-only versioning as
-- the rest of the library (0010) applies.

-- ── 1. tables ──
-- A unit: the unit string id, its dimension as an exponent vector over the fixed base dims
-- (jsonb, {} = scalar), and the scale to the canonical base unit.
create table if not exists public.units (
  id             text primary key,        -- the unit string (e.g. 'МВт', 'tCO₂/MWh')
  dim            jsonb not null default '{}'::jsonb,
  scale          double precision not null,
  last_author_id uuid references public.profiles (id) on delete set null
);

-- A bridge: a typed unit conversion. `from`/`to`/`via`/`expr` are jsonb (from/to are SQL
-- keywords → quoted). `expr` is an AST over the `from` + via slots.
create table if not exists public.bridges (
  id             text primary key,
  "from"         jsonb not null,           -- { dim, carrier? }
  via            jsonb not null default '[]'::jsonb, -- [{ name, dim, indicator? }]
  "to"           jsonb not null,           -- { dim, carrier? }
  expr           jsonb not null,
  carrier_rule   text,
  authoring      text,
  last_author_id uuid references public.profiles (id) on delete set null
);

-- ── 2. RLS: world-read, any-authenticated-write (mirrors the rest of the library) ──
alter table public.units   enable row level security;
alter table public.bridges enable row level security;

drop policy if exists units_read on public.units;
create policy units_read on public.units for select using (true);
drop policy if exists bridges_read on public.bridges;
create policy bridges_read on public.bridges for select using (true);

-- ── 3. attribution (BEFORE) + append-only snapshot (AFTER) — reuse the 0010 functions ──
do $do$
declare t text;
begin
  foreach t in array array['units','bridges'] loop
    execute format('drop trigger if exists %I_attribute on public.%I', t, t);
    execute format('create trigger %I_attribute before insert or update on public.%I for each row execute function public.library_attribute()', t, t);
    execute format('drop trigger if exists %I_snapshot on public.%I', t, t);
    execute format('create trigger %I_snapshot after insert or update on public.%I for each row execute function public.library_snapshot()', t, t);
    execute format('drop policy if exists %I_write_any on public.%I', t, t);
    execute format('create policy %I_write_any on public.%I for all using (auth.uid() is not null) with check (auth.uid() is not null)', t, t);
  end loop;
end $do$;
