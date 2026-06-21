-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — debt cleanup: complete library note-parity + drop the dissolved pools table.
--
--  1. library_upsert_admin — the service-role twin of library_upsert (0016). The OAuth
--     Worker accesses Supabase as service_role (no auth.uid()), so it needs an author-passing
--     variant to record a note when it corrects a library entity. Mirrors library_upsert:
--     same tx-local note GUC the snapshot trigger reads, same column-scoped upsert.
--  2. library_upsert — re-created without the now-gone `pools` entity in its allow-list.
--  3. drop the `pools` table — dissolved into the indicator hub in R3; nothing reads it
--     (load-supabase, dbListLibrary, supabase-apply all stopped). Its history snapshots in
--     library_versions stay (plain text rows, no FK).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1+2. library upsert (user + admin), note-aware, pools removed from the allow-list ──────
create or replace function public.library_upsert(p_entity text, p_row jsonb, p_note text default null)
returns public.library_versions
language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[] := array['objects','resources','products','indicators','refs','subsectors'];
  v_set text;
  v_ver public.library_versions;
begin
  if auth.uid() is null then raise exception 'authentication required: library_upsert is for logged-in users'; end if;
  if not (p_entity = any(v_allowed)) then raise exception 'library_upsert: unknown entity %', p_entity; end if;
  if (p_row ->> 'id') is null then raise exception 'library_upsert: row must carry an id'; end if;

  perform set_config('app.library_note', coalesce(p_note, ''), true);  -- tx-local → snapshot trigger

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

create or replace function public.library_upsert_admin(p_entity text, p_row jsonb, p_author uuid, p_note text default null)
returns public.library_versions
language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[] := array['objects','resources','products','indicators','refs','subsectors'];
  v_set text;
  v_ver public.library_versions;
  v_row jsonb;
begin
  if p_author is null then raise exception 'library_upsert_admin requires an author'; end if;
  if not (p_entity = any(v_allowed)) then raise exception 'library_upsert_admin: unknown entity %', p_entity; end if;
  if (p_row ->> 'id') is null then raise exception 'library_upsert_admin: row must carry an id'; end if;

  perform set_config('app.library_note', coalesce(p_note, ''), true);
  v_row := p_row || jsonb_build_object('last_author_id', p_author);  -- service-role: stamp the author explicitly

  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into v_set
    from information_schema.columns
    where table_schema = 'public' and table_name = p_entity
      and column_name <> 'id' and v_row ? column_name;

  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict (id) do update set %s',
    p_entity, p_entity, coalesce(v_set, 'id = excluded.id')
  ) using v_row;

  select * into v_ver from public.library_versions
    where entity = p_entity and entity_id = (p_row ->> 'id')
    order by version desc limit 1;
  return v_ver;
end; $$;
revoke all on function public.library_upsert_admin(text, jsonb, uuid, text) from public, authenticated, anon;
grant execute on function public.library_upsert_admin(text, jsonb, uuid, text) to service_role;

-- 3. drop the dissolved pools table (R3) ─────────────────────────────────────────
drop table if exists public.pools cascade;
