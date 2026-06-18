-- ─────────────────────────────────────────────────────────────────────────────
-- MACC KZ — service-role publish path for the OAuth MCP host (Cloudflare Worker).
--
-- The project signs user JWTs with ASYMMETRIC keys (ES256), so a trusted server can't
-- mint a user token from a shared secret. The OAuth Worker instead authenticates the
-- user itself (via the OAuth grant) and accesses Supabase with the service_role,
-- scoping by the resolved user id explicitly. Reads filter `published OR owner_id`;
-- writes go through this admin variant of measure_publish that takes the author as an
-- argument instead of auth.uid(). Granted to service_role ONLY — never to authenticated,
-- so a normal client cannot publish on behalf of someone else.
--
-- (The user-scoped path — stdio MCP, Edge, the web editor — keeps using measure_publish
-- with auth.uid(); unchanged.)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.measure_publish_admin(p_id text, p_patch jsonb, p_author uuid, p_note text default null)
returns public.measures
language plpgsql security definer set search_path = public as $$
declare
  v_row  public.measures;
  v_data jsonb;
  v_ver  int;
begin
  if p_author is null then
    raise exception 'measure_publish_admin requires an author';
  end if;

  select * into v_row from public.measures where id = p_id;
  v_data := coalesce(v_row.data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);
  v_ver  := coalesce(v_row.version, 0) + 1;

  insert into public.measures (id, owner_id, scope, sector, maturity, schema_version, data, version, last_author_id)
  values (
    p_id,
    coalesce(v_row.owner_id, p_author),                                -- creator stays owner; corrections keep it
    'published',
    coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    v_data ->> 'maturity_stage',
    coalesce((v_data ->> 'schema_version')::int, 1),
    v_data, v_ver, p_author
  )
  on conflict (id) do update set
    data           = v_data,
    scope          = 'published',
    sector         = coalesce(v_data ->> 'sector_ref', (v_data -> 'sectors' -> 0 ->> 'sector_ref')),
    maturity       = v_data ->> 'maturity_stage',
    schema_version = coalesce((v_data ->> 'schema_version')::int, public.measures.schema_version),
    version        = v_ver,
    last_author_id = p_author
  returning * into v_row;

  insert into public.measure_versions (measure_id, version, data, author_id, note)
  values (p_id, v_ver, v_data, p_author, p_note);

  return v_row;
end;
$$;

revoke all on function public.measure_publish_admin(text, jsonb, uuid, text) from public, authenticated, anon;
grant execute on function public.measure_publish_admin(text, jsonb, uuid, text) to service_role;
