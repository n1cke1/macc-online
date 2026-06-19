-- MACC KZ — explicit create (server-allocated id) + soft-delete scope (0012).
--
-- Owner decision 2026-06-19, after a connector authoring round overwrote a seeded
-- measure: split the write path into CREATE vs UPDATE so an LLM can never collide with
-- an existing id.
--   • CREATE — the SERVER allocates the next free id (kz-N, N ≥ 27 so the canonical
--     1–26 curve is never touched); the client supplies only content. v1 + history.
--   • UPDATE — keeps using measure_publish/_admin (id must already exist; the MCP layer
--     refuses an unknown id). Versioned + attributed as before.
--   • LIFECYCLE — a new `archived` scope is a soft-delete: hidden from the published
--     curve, but the row + full history stay. (No hard delete — the model is auditable.)

-- soft-delete scope value (safe in a tx on PG12+/17; not used in this same file).
alter type public.measure_scope add value if not exists 'archived';

-- next free canonical id, serialized by an advisory lock so concurrent creates differ.
create or replace function public.next_measure_id() returns text
language plpgsql security definer set search_path = public as $$
declare v_max int;
begin
  perform pg_advisory_xact_lock(987654321);
  select coalesce(max((substring(id from '^kz-([0-9]+)$'))::int), 0) into v_max
    from public.measures where id ~ '^kz-[0-9]+$';
  return 'kz-' || (greatest(v_max, 26) + 1);  -- floor at 26 → first new id is kz-27
end; $$;

-- user create (author = auth.uid()); scope honored, defaults to draft.
create or replace function public.measure_create(p_data jsonb, p_note text default null)
returns public.measures language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id text; v_data jsonb; v_scope text; v_row public.measures;
begin
  if v_uid is null then raise exception 'authentication required: measure_create is for logged-in users'; end if;
  v_id   := public.next_measure_id();
  v_data := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('id', v_id);  -- server owns the id
  v_scope := coalesce(nullif(v_data ->> 'scope', ''), 'draft');
  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (v_id, v_uid, v_scope::measure_scope,
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage', coalesce((v_data ->> 'schema_version')::int, 1), v_data, 1, v_uid)
  returning * into v_row;
  insert into public.measure_versions (measure_id, version, data, author_id, note)
  values (v_id, 1, v_data, v_uid, coalesce(p_note, 'created'));
  return v_row;
end; $$;
grant execute on function public.measure_create(jsonb, text) to authenticated;

-- service-role create (OAuth Worker); author passed explicitly.
create or replace function public.measure_create_admin(p_data jsonb, p_author uuid, p_note text default null)
returns public.measures language plpgsql security definer set search_path = public as $$
declare v_id text; v_data jsonb; v_scope text; v_row public.measures;
begin
  if p_author is null then raise exception 'measure_create_admin requires an author'; end if;
  v_id   := public.next_measure_id();
  v_data := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('id', v_id);
  v_scope := coalesce(nullif(v_data ->> 'scope', ''), 'draft');
  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (v_id, p_author, v_scope::measure_scope,
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage', coalesce((v_data ->> 'schema_version')::int, 1), v_data, 1, p_author)
  returning * into v_row;
  insert into public.measure_versions (measure_id, version, data, author_id, note)
  values (v_id, 1, v_data, p_author, coalesce(p_note, 'created'));
  return v_row;
end; $$;
revoke all on function public.measure_create_admin(jsonb, uuid, text) from public, authenticated, anon;
grant execute on function public.measure_create_admin(jsonb, uuid, text) to service_role;
