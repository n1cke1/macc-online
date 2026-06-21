-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — fix library_upsert / _admin: insert only the columns the caller supplied.
--
-- 0016/0017 did `insert into <t> select * from jsonb_populate_record(null::<t>, $1)`, which
-- materializes EVERY column — including ones the payload omits — as explicit NULLs, defeating
-- column defaults (e.g. `created_at NOT NULL DEFAULT now()` → null-violation). Scope the insert
-- to the payload's columns so omitted columns fall back to their defaults; on conflict still
-- update only the supplied non-id columns.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.library_upsert(p_entity text, p_row jsonb, p_note text default null)
returns public.library_versions
language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[] := array['objects','resources','products','indicators','refs','subsectors'];
  v_cols text; v_set text; v_ver public.library_versions;
begin
  if auth.uid() is null then raise exception 'authentication required: library_upsert is for logged-in users'; end if;
  if not (p_entity = any(v_allowed)) then raise exception 'library_upsert: unknown entity %', p_entity; end if;
  if (p_row ->> 'id') is null then raise exception 'library_upsert: row must carry an id'; end if;

  perform set_config('app.library_note', coalesce(p_note, ''), true);  -- tx-local → snapshot trigger
  select string_agg(quote_ident(column_name), ', '),
         string_agg(case when column_name <> 'id' then format('%I = excluded.%I', column_name, column_name) end, ', ')
    into v_cols, v_set
    from information_schema.columns
    where table_schema = 'public' and table_name = p_entity and p_row ? column_name;

  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do update set %s',
    p_entity, v_cols, v_cols, p_entity, coalesce(v_set, 'id = excluded.id')
  ) using p_row;

  select * into v_ver from public.library_versions
    where entity = p_entity and entity_id = (p_row ->> 'id') order by version desc limit 1;
  return v_ver;
end; $$;
grant execute on function public.library_upsert(text, jsonb, text) to authenticated;

create or replace function public.library_upsert_admin(p_entity text, p_row jsonb, p_author uuid, p_note text default null)
returns public.library_versions
language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[] := array['objects','resources','products','indicators','refs','subsectors'];
  v_cols text; v_set text; v_ver public.library_versions; v_row jsonb;
begin
  if p_author is null then raise exception 'library_upsert_admin requires an author'; end if;
  if not (p_entity = any(v_allowed)) then raise exception 'library_upsert_admin: unknown entity %', p_entity; end if;
  if (p_row ->> 'id') is null then raise exception 'library_upsert_admin: row must carry an id'; end if;

  perform set_config('app.library_note', coalesce(p_note, ''), true);
  v_row := p_row || jsonb_build_object('last_author_id', p_author);

  select string_agg(quote_ident(column_name), ', '),
         string_agg(case when column_name <> 'id' then format('%I = excluded.%I', column_name, column_name) end, ', ')
    into v_cols, v_set
    from information_schema.columns
    where table_schema = 'public' and table_name = p_entity and v_row ? column_name;

  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do update set %s',
    p_entity, v_cols, v_cols, p_entity, coalesce(v_set, 'id = excluded.id')
  ) using v_row;

  select * into v_ver from public.library_versions
    where entity = p_entity and entity_id = (p_row ->> 'id') order by version desc limit 1;
  return v_ver;
end; $$;
revoke all on function public.library_upsert_admin(text, jsonb, uuid, text) from public, authenticated, anon;
grant execute on function public.library_upsert_admin(text, jsonb, uuid, text) to service_role;
