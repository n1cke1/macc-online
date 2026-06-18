-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — measure-authoring layer schema (Phase 2).
--
-- The WRITABLE strata of the §1 entity model. Authority data (references, pools,
-- guardrail checks, subsectors, globals) stays in the published library files
-- (data/kz/library/*) as the read-only trust anchor; only the submission/mixed
-- strata are persisted here:
--   • measures              — the authored measures (one JSONB document each)
--   • technologies/resources/products — user-added library objects (overlay on
--     the file-library base; the editor lists base ∪ DB rows)
--
-- Measures are stored as a validated JSONB document (`data`) against
-- data/measure.schema.json — the single schema for UI/API/MCP — plus a few
-- promoted columns for filtering/RLS. Promotion to `published` is server-only
-- (Edge Function, service role); see 0006.
-- ─────────────────────────────────────────────────────────────────────────────

-- scope: published = passed every guardrail, in the trusted curve; draft =
-- personal WIP; scenario = a what-if. (plain terms, no jargon — see the contract.)
create type measure_scope as enum ('published', 'draft', 'scenario');

-- ── measures ─────────────────────────────────────────────────────────────────
create table public.measures (
  id             text primary key,                       -- measure id, e.g. 'kz-2'
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  scope          measure_scope not null default 'draft',
  sector         text,                                   -- primary sector (curve color / filter)
  maturity       text,                                   -- raw | back_calc | computed
  schema_version int  not null default 1,
  model_version  text,
  review_status  comment_status not null default 'open', -- reuses the comment_status enum
  data           jsonb not null,                         -- the full Measure object (§2)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index measures_owner_idx  on public.measures (owner_id);
create index measures_scope_idx  on public.measures (scope);
create index measures_sector_idx on public.measures (sector);

comment on table public.measures is 'Authored measures (JSONB document validated vs measure.schema.json); promotion to published is server-only.';

-- The normalized library graph (objects/resources/products/indicators/refs/pools/
-- subsectors) lives in 0007. updated_at maintenance reuses public.touch_updated_at (0001).
create trigger measures_touch before update on public.measures for each row execute function public.touch_updated_at();
