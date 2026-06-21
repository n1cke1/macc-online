-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — R1: measure-as-version. Full-document replace + richer version rows +
-- library note-parity (roadmap R1.3).
--
-- THREE changes, all behind the single ingest gate (src/lib/measure/ingest.ts):
--
--  1. measure_publish / _admin: SHALLOW MERGE → FULL-DOCUMENT REPLACE.
--     0008/0011 did `v_data := stored.data || patch` (JSONB `||`), so a partial write
--     dropped top-level keys it didn't mention (orphaned `sources`, A3). The agent now
--     sends the WHOLE document (get → edit → send), so we store it verbatim (only the
--     id is forced). Merge disappears as a class. Scope honoring + seed baseline backfill
--     are kept from 0011.
--     ⚠️ CALLER CONTRACT: the payload MUST be a complete measure document, not a patch.
--        The MCP/db layer (R1.4) guarantees this; do not apply this migration before that
--        layer is deployed, or a partial write will erase fields.
--
--  2. measure_versions += formula_hash / change_kind / model_version, carried in a single
--     `p_meta jsonb` arg (extensible, minimal signature churn). The ingest gate computes
--     them (normalized-AST hash; structural vs parametric vs prior; baked model version).
--
--  3. library note-parity: library_versions += note, and a `library_upsert(entity,row,note)`
--     RPC that records WHY a trustworthy number changed. The snapshot TRIGGER is kept (so
--     direct multi-client upserts still get history) but made note-aware via a tx-local GUC
--     the RPC sets — no lost-history window, backward compatible.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1+2. version metadata columns ──────────────────────────────────────────────
alter table public.measure_versions add column if not exists formula_hash  text;
alter table public.measure_versions add column if not exists change_kind   text;  -- 'structural' | 'parametric'
alter table public.measure_versions add column if not exists model_version text;

-- Old signatures must go before the meta-carrying overloads (else `create or replace`
-- leaves an ambiguous duplicate). Grants drop with the function.
drop function if exists public.measure_publish(text, jsonb, text);
drop function if exists public.measure_publish_admin(text, jsonb, uuid, text);
drop function if exists public.measure_create(jsonb, text);
drop function if exists public.measure_create_admin(jsonb, uuid, text);

-- ── user publish/correct → full replace, versioned, attributed ──────────────────
create or replace function public.measure_publish(
  p_id text, p_data jsonb, p_note text default null, p_meta jsonb default '{}'::jsonb
) returns public.measures
language plpgsql security definer set search_path = public as $$
declare
  v_row   public.measures;
  v_data  jsonb;
  v_ver   int;
  v_scope text;
  v_uid   uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required: measure_publish is for logged-in users';
  end if;

  select * into v_row from public.measures where id = p_id;

  -- backfill: a seed/import row has no history → snapshot its current state first.
  if v_row.id is not null and not exists (select 1 from public.measure_versions where measure_id = p_id) then
    insert into public.measure_versions (measure_id, version, data, author_id, note)
    values (p_id, coalesce(v_row.version, 1), v_row.data, v_row.owner_id, 'seed/import baseline');
  end if;

  -- R1 FULL-DOCUMENT REPLACE: store the supplied document verbatim (id forced). No merge
  -- with prior data ⇒ a key the author dropped is gone, an orphan can't survive.
  v_data  := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('id', p_id);
  v_ver   := coalesce(v_row.version, 0) + 1;
  v_scope := coalesce(nullif(v_data ->> 'scope', ''), v_row.scope::text, 'draft');

  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (
    p_id, coalesce(v_row.owner_id, v_uid), v_scope::measure_scope,
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage', coalesce((v_data ->> 'schema_version')::int, 1),
    v_data, v_ver, v_uid
  )
  on conflict (id) do update set
    data           = v_data,
    scope          = v_scope::measure_scope,
    sector         = coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    maturity       = v_data ->> 'maturity_stage',
    schema_version = coalesce((v_data ->> 'schema_version')::int, public.measures.schema_version),
    version        = v_ver, last_author_id = v_uid
  returning * into v_row;

  insert into public.measure_versions (measure_id, version, data, author_id, note, formula_hash, change_kind, model_version)
  values (p_id, v_ver, v_data, v_uid, p_note,
          nullif(p_meta ->> 'formula_hash', ''), nullif(p_meta ->> 'change_kind', ''), nullif(p_meta ->> 'model_version', ''));
  return v_row;
end; $$;
grant execute on function public.measure_publish(text, jsonb, text, jsonb) to authenticated;

-- ── service-role publish (OAuth Worker); author passed explicitly ───────────────
create or replace function public.measure_publish_admin(
  p_id text, p_data jsonb, p_author uuid, p_note text default null, p_meta jsonb default '{}'::jsonb
) returns public.measures
language plpgsql security definer set search_path = public as $$
declare
  v_row   public.measures;
  v_data  jsonb;
  v_ver   int;
  v_scope text;
begin
  if p_author is null then
    raise exception 'measure_publish_admin requires an author';
  end if;

  select * into v_row from public.measures where id = p_id;

  if v_row.id is not null and not exists (select 1 from public.measure_versions where measure_id = p_id) then
    insert into public.measure_versions (measure_id, version, data, author_id, note)
    values (p_id, coalesce(v_row.version, 1), v_row.data, v_row.owner_id, 'seed/import baseline');
  end if;

  v_data  := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('id', p_id);
  v_ver   := coalesce(v_row.version, 0) + 1;
  v_scope := coalesce(nullif(v_data ->> 'scope', ''), v_row.scope::text, 'draft');

  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (
    p_id, coalesce(v_row.owner_id, p_author), v_scope::measure_scope,
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage', coalesce((v_data ->> 'schema_version')::int, 1),
    v_data, v_ver, p_author
  )
  on conflict (id) do update set
    data           = v_data,
    scope          = v_scope::measure_scope,
    sector         = coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    maturity       = v_data ->> 'maturity_stage',
    schema_version = coalesce((v_data ->> 'schema_version')::int, public.measures.schema_version),
    version        = v_ver, last_author_id = p_author
  returning * into v_row;

  insert into public.measure_versions (measure_id, version, data, author_id, note, formula_hash, change_kind, model_version)
  values (p_id, v_ver, v_data, p_author, p_note,
          nullif(p_meta ->> 'formula_hash', ''), nullif(p_meta ->> 'change_kind', ''), nullif(p_meta ->> 'model_version', ''));
  return v_row;
end; $$;
revoke all on function public.measure_publish_admin(text, jsonb, uuid, text, jsonb) from public, authenticated, anon;
grant execute on function public.measure_publish_admin(text, jsonb, uuid, text, jsonb) to service_role;

-- ── create (server-allocated id); v1 carries formula_hash + model_version ───────
create or replace function public.measure_create(
  p_data jsonb, p_note text default null, p_meta jsonb default '{}'::jsonb
) returns public.measures language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id text; v_data jsonb; v_scope text; v_row public.measures;
begin
  if v_uid is null then raise exception 'authentication required: measure_create is for logged-in users'; end if;
  v_id    := public.next_measure_id();
  v_data  := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('id', v_id);  -- server owns the id
  v_scope := coalesce(nullif(v_data ->> 'scope', ''), 'draft');
  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (v_id, v_uid, v_scope::measure_scope,
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage', coalesce((v_data ->> 'schema_version')::int, 1), v_data, 1, v_uid)
  returning * into v_row;
  insert into public.measure_versions (measure_id, version, data, author_id, note, formula_hash, change_kind, model_version)
  values (v_id, 1, v_data, v_uid, coalesce(p_note, 'created'),
          nullif(p_meta ->> 'formula_hash', ''), nullif(p_meta ->> 'change_kind', ''), nullif(p_meta ->> 'model_version', ''));
  return v_row;
end; $$;
grant execute on function public.measure_create(jsonb, text, jsonb) to authenticated;

create or replace function public.measure_create_admin(
  p_data jsonb, p_author uuid, p_note text default null, p_meta jsonb default '{}'::jsonb
) returns public.measures language plpgsql security definer set search_path = public as $$
declare v_id text; v_data jsonb; v_scope text; v_row public.measures;
begin
  if p_author is null then raise exception 'measure_create_admin requires an author'; end if;
  v_id    := public.next_measure_id();
  v_data  := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('id', v_id);
  v_scope := coalesce(nullif(v_data ->> 'scope', ''), 'draft');
  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (v_id, p_author, v_scope::measure_scope,
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage', coalesce((v_data ->> 'schema_version')::int, 1), v_data, 1, p_author)
  returning * into v_row;
  insert into public.measure_versions (measure_id, version, data, author_id, note, formula_hash, change_kind, model_version)
  values (v_id, 1, v_data, p_author, coalesce(p_note, 'created'),
          nullif(p_meta ->> 'formula_hash', ''), nullif(p_meta ->> 'change_kind', ''), nullif(p_meta ->> 'model_version', ''));
  return v_row;
end; $$;
revoke all on function public.measure_create_admin(jsonb, uuid, text, jsonb) from public, authenticated, anon;
grant execute on function public.measure_create_admin(jsonb, uuid, text, jsonb) to service_role;

-- ── 3. library note-parity ──────────────────────────────────────────────────────
alter table public.library_versions add column if not exists note text;

-- snapshot trigger, now note-aware: reads a tx-local GUC the RPC sets (null for direct upserts).
create or replace function public.library_snapshot() returns trigger language plpgsql security definer as $$
declare v int; v_note text := nullif(current_setting('app.library_note', true), '');
begin
  select coalesce(max(version), 0) + 1 into v
    from public.library_versions where entity = tg_table_name and entity_id = new.id;
  insert into public.library_versions (entity, entity_id, version, author_id, data, note)
  values (tg_table_name, new.id, v, new.last_author_id, to_jsonb(new), v_note);
  return null;
end $$;

-- library_upsert: upsert a library entity from jsonb + attach a note. Sets the tx-local
-- note GUC so the (same-tx) snapshot trigger records WHY the number changed. Dynamic so it
-- serves every authority table; only columns present in p_row are touched on conflict.
create or replace function public.library_upsert(p_entity text, p_row jsonb, p_note text default null)
returns public.library_versions
language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[] := array['objects','resources','products','indicators','refs','pools','subsectors'];
  v_set text;
  v_ver public.library_versions;
begin
  if auth.uid() is null then raise exception 'authentication required: library_upsert is for logged-in users'; end if;
  if not (p_entity = any(v_allowed)) then raise exception 'library_upsert: unknown entity %', p_entity; end if;
  if (p_row ->> 'id') is null then raise exception 'library_upsert: row must carry an id'; end if;

  perform set_config('app.library_note', coalesce(p_note, ''), true);  -- tx-local → snapshot trigger

  -- only the columns the caller actually supplied are overwritten on conflict.
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into v_set
    from information_schema.columns
    where table_schema = 'public' and table_name = p_entity
      and column_name <> 'id' and p_row ? column_name;

  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict (id) do update set %s',
    p_entity, p_entity, coalesce(v_set, 'id = excluded.id')
  ) using p_row;

  select * into v_ver from public.library_versions
    where entity = p_entity and entity_id = (p_row ->> 'id')
    order by version desc limit 1;
  return v_ver;
end; $$;
grant execute on function public.library_upsert(text, jsonb, text) to authenticated;
revoke all on function public.library_upsert(text, jsonb, text) from public, anon;
grant execute on function public.library_upsert(text, jsonb, text) to service_role;
