-- ─────────────────────────────────────────────────────────────────────────────
-- RLS + scope guard + upsert RPC for the measure-authoring layer.
-- Contract (mirrors §7/§9):
--   • READ: published measures are world-readable (anonymous static core); drafts
--     and scenarios are visible to their owner (and the site owner).
--   • WRITE: requires auth + self-ownership; clients may create draft/scenario only.
--   • Promotion to `published` is server-authoritative — the scope guard blocks any
--     client from setting it; only the service role (the validate-and-promote Edge
--     Function, after running the guardrails) may.
--   • Library objects (technologies/resources/products): world-read, owner-write.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.measures enable row level security;

-- ── measures ─────────────────────────────────────────────────────────────────
create policy measures_read on public.measures for select
  using (scope = 'published' or owner_id = auth.uid() or public.is_owner());

-- Insert: authenticated, self-owned, and NOT published (promotion is server-only).
create policy measures_insert on public.measures for insert
  with check (auth.uid() is not null and owner_id = auth.uid() and scope <> 'published');

create policy measures_update_own on public.measures for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy measures_delete_own on public.measures for delete
  using (owner_id = auth.uid() or public.is_owner());

-- Guard: a client may never set scope='published'. The service role (Edge Function)
-- runs with auth.role() = 'service_role' and is allowed through after validation.
create or replace function public.guard_measure_scope()
returns trigger language plpgsql as $$
begin
  if new.scope = 'published'
     and (tg_op = 'INSERT' or new.scope is distinct from old.scope)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'scope=published is set only by the server-side validator';
  end if;
  return new;
end;
$$;

create trigger measures_guard_scope
  before insert or update on public.measures
  for each row execute function public.guard_measure_scope();

-- (Library-graph RLS lives in 0007, where the normalized objects/resources/products/
-- indicators/refs/pools/subsectors tables are defined.)

-- ── measure_upsert: coarse-grained partial merge (the §8 upsert contract) ─────
-- Top-level JSONB merge (data || patch) — idempotent and race-tolerant. Runs as
-- the caller (SECURITY INVOKER) so RLS + the scope guard still apply: a client can
-- only ever write its own draft/scenario rows. Promoted columns are re-derived
-- from the merged document. A new row never starts published.
create or replace function public.measure_upsert(p_id text, p_patch jsonb, p_scope measure_scope default 'draft')
returns public.measures
language plpgsql security invoker set search_path = public as $$
declare
  v_row  public.measures;
  v_data jsonb;
begin
  if p_scope = 'published' then
    raise exception 'measure_upsert cannot publish; promotion is server-side';
  end if;

  select * into v_row from public.measures where id = p_id;
  v_data := coalesce(v_row.data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);

  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, model_version, review_status, data)
  values (
    p_id,
    auth.uid(),
    coalesce(v_row.scope, p_scope),
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage',
    coalesce((v_data ->> 'schema_version')::int, 1),
    coalesce(v_data ->> 'model_version', v_row.model_version),
    coalesce(v_row.review_status, 'open'),
    v_data
  )
  on conflict (id) do update
    set data           = v_data,
        sector         = coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
        maturity       = v_data ->> 'maturity_stage',
        schema_version = coalesce((v_data ->> 'schema_version')::int, public.measures.schema_version)
  returning * into v_row;

  return v_row;
end;
$$;
