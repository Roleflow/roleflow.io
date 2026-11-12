-- Sign-up is by invitation only.
--
-- private.enforce_signup_access_code (same name; the auth.users trigger calls
-- it) now lets a new account through only with:
--   * an open invite for that email (business_members or acq_invites), which
--     joins that business with the invited role, or
--   * a team join link that is on, which joins with the link's role, or
--   * app_metadata.signup_allowed = true, which only the service key can set
--     (an admin adding someone by hand).
-- Anything else (no link, a turned-off or replaced team link) raises
-- 'Sign-up is by invitation'. An expired, cancelled or other-email invite
-- token still raises 'Invalid invite'. There is no access code anywhere.
-- Membership markers sent by the browser are still removed first.
--
-- Existing accounts are not affected (this runs only when an account is
-- created). handle_new_user is unchanged.
--
-- Undo: re-apply the function from 20261111200000_signup_without_access_code.sql.

create or replace function private.enforce_signup_access_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite text;
  member_id uuid;
  acq_invite_id uuid;
  join_code text;
  join_link public.acq_join_links%rowtype;
begin
  -- Never trust these from the client: only this trigger sets them.
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
    - 'invite_member_id' - 'acq_invite_id' - 'acq_join_business_id' - 'acq_join_role';
  invite := coalesce(new.raw_user_meta_data, '{}'::jsonb)->>'invite_token';
  if invite is not null and invite <> '' then
    select m.id into member_id
    from private.business_invite_secrets as s
    join public.business_members as m on m.id = s.member_id
    where s.token_hash = encode(extensions.digest(convert_to(invite, 'utf8'), 'sha256'), 'hex')
      and s.expires_at > now()
      and m.status = 'pending'
      and lower(m.email) = lower(coalesce(new.email, ''));
    if member_id is not null then
      new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code' - 'invite_token')
        || jsonb_build_object('invite_member_id', member_id);
      return new;
    end if;
    select i.id into acq_invite_id
    from public.acq_invites as i
    where i.token = invite
      and i.accepted_at is null
      and (i.expires_at is null or i.expires_at > now())
      and lower(i.email) = lower(coalesce(new.email, ''));
    if acq_invite_id is null then
      raise exception 'Invalid invite';
    end if;
    new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code' - 'invite_token')
      || jsonb_build_object('acq_invite_id', acq_invite_id);
    return new;
  end if;

  -- A team join link that is on joins that business with the link's role.
  join_code := lower(btrim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  if join_code <> '' then
    select * into join_link from public.acq_join_links as l where l.code = join_code;
    if join_link.business_id is not null then
      new.raw_user_meta_data := (new.raw_user_meta_data - 'access_code' - 'join_code')
        || jsonb_build_object('acq_join_business_id', join_link.business_id, 'acq_join_role', join_link.role);
      return new;
    end if;
  end if;

  -- An account made by an admin with the service key (Supabase dashboard or
  -- auth admin API) may set app_metadata.signup_allowed = true. The public
  -- sign-up endpoint cannot set app_metadata, so this cannot be forged.
  if coalesce(new.raw_app_meta_data->>'signup_allowed', '') = 'true' then
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code' - 'join_code';
    return new;
  end if;

  -- No valid invite or team link (or a turned-off or replaced one): no account.
  raise exception 'Sign-up is by invitation';
end;
$$;

revoke execute on function private.enforce_signup_access_code() from public, anon, authenticated;
