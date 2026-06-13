-- ─────────────────────────────────────────────────────────────────────────────
-- Privileged RPCs + guard/automation triggers.
--   • Profile auto-creation on first sign-in.
--   • A guard so status/is_pinned can ONLY change through the reviewer/owner RPCs
--     (the open RLS update policy on comments would otherwise allow an author to
--     accept their own comment).
--   • set_comment_status / set_comment_pinned — reviewer-or-owner decision actions.
--   • soft_delete_comment — author or owner.
--   • set_user_role — owner-only role management.
--   • A light insert rate-limit (anti-spam) without extra infra.
--   • notify_on_comment — fire-and-forget email webhook on reply/mention.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Profile on first sign-in ─────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1),
      'Anonymous'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Guard: lock status / is_pinned outside the privileged RPCs ────────────────
-- The RPCs below set a transaction-local flag to bypass this guard.
create or replace function public.guard_comment_privileged_cols()
returns trigger language plpgsql as $$
begin
  if (new.status is distinct from old.status
      or new.is_pinned is distinct from old.is_pinned)
     and current_setting('macc.privileged', true) is distinct from 'on' then
    raise exception 'status/is_pinned may only be changed via a privileged RPC';
  end if;
  return new;
end;
$$;

create trigger comments_guard_privileged
  before update on public.comments
  for each row execute function public.guard_comment_privileged_cols();

-- ── Decision actions (reviewer/owner) ────────────────────────────────────────
create or replace function public.set_comment_status(p_comment uuid, p_status comment_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_reviewer_or_owner() then
    raise exception 'only a reviewer or owner can set comment status';
  end if;
  perform set_config('macc.privileged', 'on', true);
  update public.comments set status = p_status where id = p_comment;
  perform set_config('macc.privileged', 'off', true);
end;
$$;

create or replace function public.set_comment_pinned(p_comment uuid, p_pinned boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_reviewer_or_owner() then
    raise exception 'only a reviewer or owner can pin comments';
  end if;
  perform set_config('macc.privileged', 'on', true);
  update public.comments set is_pinned = p_pinned where id = p_comment;
  perform set_config('macc.privileged', 'off', true);
end;
$$;

-- ── Soft delete (author or owner) ────────────────────────────────────────────
create or replace function public.soft_delete_comment(p_comment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  select author_id into v_author from public.comments where id = p_comment;
  if v_author is null then raise exception 'comment not found'; end if;
  if v_author <> auth.uid() and not public.is_owner() then
    raise exception 'only the author or an owner can delete this comment';
  end if;
  update public.comments set is_deleted = true, body = '[deleted]' where id = p_comment;
end;
$$;

-- ── Role management (owner only) ─────────────────────────────────────────────
create or replace function public.set_user_role(p_user uuid, p_role user_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'only an owner can set roles';
  end if;
  update public.profiles set role = p_role where id = p_user;
end;
$$;

-- ── Anti-spam: cap inserts per user per minute ───────────────────────────────
create or replace function public.rate_limit_comments()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
  from public.comments
  where author_id = new.author_id and created_at > now() - interval '1 minute';
  if recent >= 10 then
    raise exception 'rate limit: too many comments, slow down';
  end if;
  return new;
end;
$$;

create trigger comments_rate_limit
  before insert on public.comments
  for each row execute function public.rate_limit_comments();

-- ── Email notification webhook (reply / mention) ─────────────────────────────
-- Fire-and-forget POST to the `notify` Edge Function, which resolves recipients
-- and sends via Resend. Wrapped so a missing pg_net / failed POST never blocks
-- the insert. Only fires for replies or @-mentions (the function dedupes/validates).
-- Configure once per project:
--   alter database postgres set app.settings.notify_url = 'https://<ref>.functions.supabase.co/notify';
--   alter database postgres set app.settings.service_role_key = '<service-role-jwt>';
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := current_setting('app.settings.notify_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
begin
  if v_url is null or v_url = '' then
    return new;  -- notifications not configured; no-op
  end if;
  if new.parent_id is null and position('@' in new.body) = 0 then
    return new;  -- not a reply and no mention; nothing to notify
  end if;
  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(v_key, '')
      ),
      body    := jsonb_build_object('comment_id', new.id)
    );
  exception when others then
    -- swallow: notification failure must never roll back the comment
    null;
  end;
  return new;
end;
$$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_on_comment();
