-- Team join link: owner-only, least privilege by default.
--
-- NOT APPLIED. Apply after review, after 20261111120000_business_testers.sql.
--
-- Before this, every business had a join code in acq_workspaces.join_code that
-- anyone who could read the business (viewers and editors too) could see, and
-- acq_join_workspace turned it into full Editor access, including the live
-- setter switch. Any editor could also regenerate it.
--
-- After this:
--   * Join links live in public.acq_join_links, one per business, readable and
--     removable only by the owner (or an admin) through acq_can_manage_team.
--   * Only the owner (or an admin) can create or replace a link.
--   * A link joins as Tester unless the owner picked another role for it
--     (Tester + prompt edits or Editor).
--   * Joining never changes the role of someone who is already a member.
--   * Codes are 24 hex characters (96 bits) instead of 8.
--   * Every old code stops working: acq_join_workspace no longer reads
--     acq_workspaces.join_code, and the old codes are cleared.
--   * Signing up from a link that is on needs no access code (the trigger
--     checks the link server-side). A turned-off or replaced link, or no link,
--     still needs the access code.

-- 1. Join links ---------------------------------------------------------------

create table if not exists public.acq_join_links (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  code text not null unique,
  role text not null default 'tester',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint acq_join_links_role_check check (role in ('tester', 'prompt_editor', 'editor')),
  constraint acq_join_links_code_check check (code ~ '^[0-9a-f]{24}$')
);

alter table public.acq_join_links enable row level security;

drop policy if exists acq_join_links_read on public.acq_join_links;
create policy acq_join_links_read on public.acq_join_links
  for select to authenticated using (public.acq_can_manage_team(business_id));
drop policy if exists acq_join_links_delete on public.acq_join_links;
create policy acq_join_links_delete on public.acq_join_links
  for delete to authenticated using (public.acq_can_manage_team(business_id));
-- No insert or update policy: links are written only by acq_regenerate_join_code.

revoke all on table public.acq_join_links from public, anon, authenticated;
grant select, delete on table public.acq_join_links to authenticated;
grant all on table public.acq_join_links to service_role;

-- 2. Retire the old Editor codes ---------------------------------------------

update public.acq_workspaces set join_code = null where join_code is not null;

-- 3. Only the owner creates a link, and picks its role -----------------------

drop function if exists public.acq_regenerate_join_code(uuid);

create or replace function public.acq_regenerate_join_code(p_business uuid, p_role text default 'tester')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_role text := coalesce(nullif(btrim(p_role), ''), 'tester');
begin
  if auth.uid() is null or p_business is null or not public.acq_can_manage_team(p_business) then
    raise exception 'Only the business owner can change the team link';
  end if;
  if v_role not in ('tester', 'prompt_editor', 'editor') then
    raise exception 'Choose Tester, Tester + prompt edits, or Editor';
  end if;
  v_code := encode(extensions.gen_random_bytes(12), 'hex');
  insert into public.acq_join_links (business_id, code, role, created_by, created_at)
  values (p_business, v_code, v_role, auth.uid(), now())
  on conflict (business_id) do update
    set code = excluded.code,
        role = excluded.role,
        created_by = excluded.created_by,
        created_at = excluded.created_at;
  return jsonb_build_object('ok', true, 'join_code', v_code, 'role', v_role);
end;
$$;

revoke all on function public.acq_regenerate_join_code(uuid, text) from public, anon;
grant execute on function public.acq_regenerate_join_code(uuid, text) to authenticated;

-- 4. Joining uses the link's role and never changes an existing member -------

create or replace function public.acq_join_workspace(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.acq_join_links%rowtype;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  select * into v_link
  from public.acq_join_links
  where code = lower(btrim(coalesce(p_code, '')));
  if v_link.business_id is null then
    return jsonb_build_object('ok', false, 'error', 'That join link does not match a business.');
  end if;
  if exists (select 1 from public.acq_workspaces w where w.id = v_link.business_id and w.owner_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'business_id', v_link.business_id, 'role', 'owner');
  end if;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_link.business_id, auth.uid(), v_link.role, 'active')
  on conflict (business_id, user_id) do nothing;
  select role into v_role from public.acq_members
  where business_id = v_link.business_id and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'business_id', v_link.business_id, 'role', v_role);
end;
$$;

revoke all on function public.acq_join_workspace(text) from public, anon;
grant execute on function public.acq_join_workspace(text) to authenticated;

-- 5. Sign-up from a team join link needs no access code ---------------------
-- The sign-up page can show which business a link joins, without signing in.
-- Returns null for a link that is turned off, replaced, or never existed.

create or replace function public.acq_preview_join(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('business_name', coalesce(nullif(btrim(w.name), ''), 'Business'), 'role', l.role)
  from public.acq_join_links as l
  join public.acq_workspaces as w on w.id = l.business_id
  where length(btrim(coalesce(p_code, ''))) = 24
    and l.code = lower(btrim(p_code));
$$;

revoke all on function public.acq_preview_join(text) from public;
grant execute on function public.acq_preview_join(text) to anon, authenticated;

-- Same as live (20261111120000_business_testers.sql), plus: client-supplied
-- membership markers are stripped, and a join_code that matches a link that
-- is on skips the access code. An invite token that is expired, cancelled, or
-- for another email still raises 'Invalid invite' as before; the sign-up page
-- only sends it for an invite that preview_invite shows as open.

create or replace function private.enforce_signup_access_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected text;
  provided text;
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

  -- A team join link that is on (not turned off or replaced) also skips the
  -- access code. A code that no longer matches falls through to the access
  -- code check below.
  join_code := lower(btrim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  if join_code <> '' then
    select * into join_link from public.acq_join_links as l where l.code = join_code;
    if join_link.business_id is not null then
      new.raw_user_meta_data := (new.raw_user_meta_data - 'access_code' - 'join_code')
        || jsonb_build_object('acq_join_business_id', join_link.business_id, 'acq_join_role', join_link.role);
      return new;
    end if;
  end if;

  select access_code into expected
  from private.signup_settings
  where id = 1;

  provided := coalesce(new.raw_user_meta_data, '{}'::jsonb)->>'access_code';

  if provided is distinct from expected then
    raise exception 'Invalid access code';
  end if;

  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code' - 'join_code';
  return new;
end;
$$;

revoke execute on function private.enforce_signup_access_code() from public, anon, authenticated;

-- Same as live, plus: a join-link sign-up becomes a member with the link's
-- role, and a Tester (or Tester + prompt edits) does not get an empty business
-- of their own.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited uuid;
  acq_invited uuid;
  acq_role text;
  join_business uuid;
  join_role text;
begin
  insert into public.profiles (id, full_name, email, instagram)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'instagram', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when public.profiles.full_name = '' then excluded.full_name
          else public.profiles.full_name
        end,
        instagram = case
          when public.profiles.instagram = '' then excluded.instagram
          else public.profiles.instagram
        end,
        updated_at = now();

  insert into public.onboarding_submissions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  if lower(coalesce(new.email, '')) = 'diego@roleflow.io' then
    insert into public.admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;

  begin
    invited := nullif(new.raw_user_meta_data->>'invite_member_id', '')::uuid;
  exception when invalid_text_representation then
    invited := null;
  end;
  if invited is not null then
    update public.business_members
      set user_id = new.id,
          status = 'active',
          accepted_at = now()
      where id = invited
        and status = 'pending'
        and lower(email) = lower(coalesce(new.email, ''));
  end if;

  begin
    acq_invited := nullif(new.raw_user_meta_data->>'acq_invite_id', '')::uuid;
  exception when invalid_text_representation then
    acq_invited := null;
  end;
  if acq_invited is not null then
    select i.role into acq_role
    from public.acq_invites as i
    where i.id = acq_invited
      and i.accepted_at is null
      and lower(i.email) = lower(coalesce(new.email, ''));
    if acq_role is not null then
      insert into public.acq_members (business_id, user_id, role, status, scopes)
      select i.business_id, new.id, i.role, 'active', i.scopes
      from public.acq_invites as i
      where i.id = acq_invited
      on conflict (business_id, user_id) do nothing;
      update public.acq_invites set accepted_at = now() where id = acq_invited;
    end if;
  end if;

  begin
    join_business := nullif(new.raw_user_meta_data->>'acq_join_business_id', '')::uuid;
  exception when invalid_text_representation then
    join_business := null;
  end;
  join_role := new.raw_user_meta_data->>'acq_join_role';
  if join_business is not null and join_role in ('tester', 'prompt_editor', 'editor') then
    insert into public.acq_members (business_id, user_id, role, status)
    values (join_business, new.id, join_role, 'active')
    on conflict (business_id, user_id) do nothing;
    if acq_role is null then acq_role := join_role; end if;
  end if;

  if acq_role is null or acq_role not in ('tester', 'prompt_editor') then
    perform public.acq_ensure_owned_workspace(new.id, null);
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
