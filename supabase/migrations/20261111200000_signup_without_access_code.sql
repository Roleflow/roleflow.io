-- Sign-up no longer needs an access code.
--
-- private.enforce_signup_access_code keeps its name (the auth.users trigger
-- calls it) and everything else it does today:
--   * membership markers sent by the browser are removed, so they cannot be
--     forged;
--   * an open invite for that email (business_members or acq_invites) joins
--     that business with the invited role; an expired, cancelled or
--     other-email invite token still raises 'Invalid invite';
--   * a team join link that is on joins with the link's role.
-- What changes: with no link (or a turned-off or replaced join link), the
-- sign-up goes through without an access code, and handle_new_user gives the
-- person their own business exactly as a coded sign-up did. Any access_code
-- still sent by an old page is dropped.
--
-- private.signup_settings is left in place, unused, so this is easy to undo:
-- re-apply the function from 20261111180000_join_link_least_privilege.sql.
--
-- Apply BEFORE the frontend change ships: the old page still sends a code,
-- which is ignored, but the new page sends none.

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
  -- A code that no longer matches is ignored: the person signs up like anyone
  -- else, with a business of their own.
  join_code := lower(btrim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  if join_code <> '' then
    select * into join_link from public.acq_join_links as l where l.code = join_code;
    if join_link.business_id is not null then
      new.raw_user_meta_data := (new.raw_user_meta_data - 'access_code' - 'join_code')
        || jsonb_build_object('acq_join_business_id', join_link.business_id, 'acq_join_role', join_link.role);
      return new;
    end if;
  end if;

  -- No access code is needed any more. An old page may still send one; it is
  -- dropped and never stored.
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code' - 'join_code';
  return new;
end;
$$;

revoke execute on function private.enforce_signup_access_code() from public, anon, authenticated;
