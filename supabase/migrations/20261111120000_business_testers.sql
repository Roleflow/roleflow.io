-- Business testers: let a business owner give someone access to one business
-- so they can use the Agentic Setter practice chat.
--
-- NOT APPLIED. Apply after review, after 20261103200000_outreacher_pricing.sql.
-- Additive except for the function bodies it replaces (acq_can_read,
-- acq_accept_invite, preview_invite, private.enforce_signup_access_code,
-- handle_new_user) and the acq_invites policies, which it tightens.
--
-- New member roles:
--   tester         opens the practice chat and reads the setter prompt.
--   prompt_editor  tester, plus saving the setter prompt.
-- Neither role can read leads, chats, settings, Instagram, billing, or any
-- other business data. They are left out of acq_can_read and acq_can_edit, so
-- every existing RLS policy and every function gate that uses those keeps them
-- out. They reach the practice chat only through client-dashboard, which
-- checks public.acq_access() per action.

-- 1. Roles ------------------------------------------------------------------

alter table public.acq_members drop constraint if exists acq_members_role_check;
alter table public.acq_members
  add constraint acq_members_role_check
  check (role in ('owner', 'editor', 'viewer', 'tester', 'prompt_editor'));

alter table public.acq_invites
  add column if not exists role text not null default 'editor',
  add column if not exists invited_by uuid references public.profiles (id) on delete set null,
  add column if not exists expires_at timestamptz;

alter table public.acq_invites drop constraint if exists acq_invites_role_check;
alter table public.acq_invites
  add constraint acq_invites_role_check
  check (role in ('editor', 'viewer', 'tester', 'prompt_editor'));

create index if not exists acq_invites_open_email_idx
  on public.acq_invites (business_id, lower(email))
  where accepted_at is null;

-- 2. Read access no longer includes testers ---------------------------------
-- Same body as live, except the member branch now lists the roles that read.

create or replace function public.acq_can_read(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_workspace is not null and (
    public.is_admin()
    or exists (
      select 1 from public.acq_workspaces w
      where w.id = p_workspace
        and (
          w.owner_id = auth.uid()
          or (
            w.tailortalk_agent_id is not null
            and public.can_read_business(w.tailortalk_agent_id)
          )
        )
    )
    or exists (
      select 1 from public.acq_members m
      where m.business_id = p_workspace
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'editor', 'viewer')
    )
  );
$$;

-- 3. Per-business access summary --------------------------------------------

create or replace function public.acq_can_manage_team(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_workspace is not null and (
    public.is_admin()
    or exists (
      select 1 from public.acq_workspaces w
      where w.id = p_workspace and w.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.acq_members m
      where m.business_id = p_workspace
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = 'owner'
    )
  );
$$;

create or replace function public.acq_access(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_edit boolean;
  v_team boolean;
begin
  if auth.uid() is null or p_workspace is null then
    return jsonb_build_object('role', null, 'can_edit', false, 'can_test', false, 'can_edit_prompt', false, 'can_manage_team', false);
  end if;
  v_edit := public.acq_can_edit(p_workspace);
  v_team := public.acq_can_manage_team(p_workspace);
  if public.is_admin() then
    v_role := 'admin';
  elsif exists (select 1 from public.acq_workspaces w where w.id = p_workspace and w.owner_id = auth.uid()) then
    v_role := 'owner';
  else
    select m.role into v_role
    from public.acq_members m
    where m.business_id = p_workspace
      and m.user_id = auth.uid()
      and m.status = 'active';
    if v_role is null and v_edit then
      v_role := 'editor';
    end if;
  end if;
  return jsonb_build_object(
    'role', v_role,
    'can_edit', v_edit,
    'can_test', coalesce(v_edit or v_role in ('tester', 'prompt_editor'), false),
    'can_edit_prompt', coalesce(v_edit or v_role = 'prompt_editor', false),
    'can_manage_team', v_team
  );
end;
$$;

-- Businesses this person can only test. The panel and the businesses page use
-- it to list them, because acq_workspaces RLS does not show them to testers.
create or replace function public.acq_my_tester_businesses()
returns table (business_id uuid, name text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.name, m.role, w.created_at
  from public.acq_members m
  join public.acq_workspaces w on w.id = m.business_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and m.role in ('tester', 'prompt_editor')
  order by w.name;
$$;

revoke all on function public.acq_can_manage_team(uuid) from public, anon;
revoke all on function public.acq_access(uuid) from public, anon;
revoke all on function public.acq_my_tester_businesses() from public, anon;
grant execute on function public.acq_can_manage_team(uuid) to authenticated, service_role;
grant execute on function public.acq_access(uuid) to authenticated, service_role;
grant execute on function public.acq_my_tester_businesses() to authenticated;

-- 4. Only the owner (or an admin) manages invites ---------------------------
-- Before this, anyone who could read the business could read invite tokens,
-- and any editor could create one.

drop policy if exists acq_invites_read on public.acq_invites;
create policy acq_invites_read on public.acq_invites
  for select to authenticated using (public.acq_can_manage_team(business_id));
drop policy if exists acq_invites_insert on public.acq_invites;
create policy acq_invites_insert on public.acq_invites
  for insert to authenticated with check (public.acq_can_manage_team(business_id));
drop policy if exists acq_invites_update on public.acq_invites;
create policy acq_invites_update on public.acq_invites
  for update to authenticated
  using (public.acq_can_manage_team(business_id))
  with check (public.acq_can_manage_team(business_id));
drop policy if exists acq_invites_delete on public.acq_invites;
create policy acq_invites_delete on public.acq_invites
  for delete to authenticated using (public.acq_can_manage_team(business_id));

-- 5. Accepting an invite keeps its role and is safe to repeat ---------------

create or replace function public.acq_accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.acq_invites%rowtype;
  v_email text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select lower(email) into v_email from public.profiles where id = auth.uid();
  select * into v_invite from public.acq_invites where token = p_token;
  if v_invite.id is null then
    raise exception 'That invite is no longer open';
  end if;
  if v_email is null or v_email <> lower(v_invite.email) then
    raise exception 'Sign in with the invited email';
  end if;
  if v_invite.accepted_at is not null then
    select role into v_role from public.acq_members
    where business_id = v_invite.business_id and user_id = auth.uid() and status = 'active';
    if v_role is null then
      raise exception 'That invite is no longer open';
    end if;
    return jsonb_build_object('ok', true, 'business_id', v_invite.business_id, 'role', v_role);
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'That invite has expired. Ask the owner for a new one.';
  end if;
  insert into public.acq_members (business_id, user_id, role, status, scopes)
  values (v_invite.business_id, auth.uid(), coalesce(v_invite.role, 'editor'), 'active', v_invite.scopes)
  on conflict (business_id, user_id) do update
    set status = 'active',
        role = case when public.acq_members.role = 'owner' then 'owner' else excluded.role end,
        scopes = excluded.scopes;
  update public.acq_invites set accepted_at = now() where id = v_invite.id;
  select role into v_role from public.acq_members
  where business_id = v_invite.business_id and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'business_id', v_invite.business_id, 'role', v_role);
end;
$$;

revoke all on function public.acq_accept_invite(text) from public, anon;
grant execute on function public.acq_accept_invite(text) to authenticated;

-- 6. The sign-up page can show who an acq invite is for -------------------
-- Same as live for business_members invites, then falls back to acq_invites.

create or replace function public.preview_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  row record;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select m.email, m.role, m.status, coalesce(nullif(btrim(agent.agent_name), ''), nullif(btrim(agent.label), ''), 'Business') as business_name
    into row
  from private.business_invite_secrets as secret
  join public.business_members as m on m.id = secret.member_id
  join public.tailortalk_agents as agent on agent.id = m.agent_id
  where secret.token_hash = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
    and secret.expires_at > now();
  if row is not null then
    return jsonb_build_object(
      'email', row.email,
      'role', row.role,
      'status', row.status,
      'business_name', row.business_name
    );
  end if;
  select i.email, i.role, coalesce(nullif(btrim(w.name), ''), 'Business') as business_name
    into row
  from public.acq_invites as i
  join public.acq_workspaces as w on w.id = i.business_id
  where i.token = p_token
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > now());
  if row is null then
    return null;
  end if;
  return jsonb_build_object(
    'email', row.email,
    'role', row.role,
    'status', 'pending',
    'business_name', row.business_name
  );
end;
$$;

-- 7. Sign-up with an open acq invite does not need the access code ---------
-- Same as live, plus the acq_invites branch.

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
begin
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

  select access_code into expected
  from private.signup_settings
  where id = 1;

  provided := coalesce(new.raw_user_meta_data, '{}'::jsonb)->>'access_code';

  if provided is distinct from expected then
    raise exception 'Invalid access code';
  end if;

  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code';
  return new;
end;
$$;

revoke execute on function private.enforce_signup_access_code() from public, anon, authenticated;

-- 8. New account from an acq invite: add the membership, and do not open an
-- empty business of their own when they were invited as a tester.
-- Same as live, plus the acq_invite_id branch.

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

  if acq_role is null or acq_role not in ('tester', 'prompt_editor') then
    perform public.acq_ensure_owned_workspace(new.id, null);
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
