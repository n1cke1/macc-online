-- MACC KZ — measure write path: respect the document's scope + complete the history.
--
-- Owner feedback 2026-06-19 (after the first real authoring round overwrote a seeded
-- measure): the previous "always publish" stance (0008) pushed every upsert — even a
-- `scope:"draft"` work-in-progress — straight into the live model. Two fixes here,
-- applied to BOTH write paths (measure_publish = user/auth.uid(); measure_publish_admin
-- = OAuth Worker/service-role):
--   1. HONOR the document scope. A new measure defaults to `draft` when scope is absent;
--      it reaches `published` only when the document says so. Editing keeps the existing
--      scope when the patch omits it (never silently un-publishes).
--   2. COMPLETE the version log. Measures seeded by a direct insert have version=1 but no
--      measure_versions row, so the first edit looked like it "started at v2". Backfill the
--      current state as its own version before bumping, so history lines up (v1 seed, v2 edit).

create or replace function public.measure_publish(p_id text, p_patch jsonb, p_note text default null)
returns public.measures
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

  -- backfill: a row created by direct seed/import has no history → snapshot its current
  -- state as its current version so the append-only log is complete and versions align.
  if v_row.id is not null and not exists (select 1 from public.measure_versions where measure_id = p_id) then
    insert into public.measure_versions (measure_id, version, data, author_id, note)
    values (p_id, coalesce(v_row.version, 1), v_row.data, v_row.owner_id, 'seed/import baseline');
  end if;

  v_data  := coalesce(v_row.data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);
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

  insert into public.measure_versions (measure_id, version, data, author_id, note)
  values (p_id, v_ver, v_data, v_uid, p_note);
  return v_row;
end;
$$;
grant execute on function public.measure_publish(text, jsonb, text) to authenticated;

create or replace function public.measure_publish_admin(p_id text, p_patch jsonb, p_author uuid, p_note text default null)
returns public.measures
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

  v_data  := coalesce(v_row.data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);
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

  insert into public.measure_versions (measure_id, version, data, author_id, note)
  values (p_id, v_ver, v_data, p_author, p_note);
  return v_row;
end;
$$;
revoke all on function public.measure_publish_admin(text, jsonb, uuid, text) from public, authenticated, anon;
grant execute on function public.measure_publish_admin(text, jsonb, uuid, text) to service_role;
