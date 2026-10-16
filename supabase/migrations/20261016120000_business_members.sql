-- Business members and invite bypass.
-- Apply after 20261015120000_businesses.sql.
-- Does not deploy an edge function and does not store agent tokens.
--
-- A member sees only the businesses they belong to. Invite tokens live in
-- private.business_invite_secrets, which is not granted to the API.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.tailortalk_agents (id) on delete cascade,
  email text not null,
  user_id uuid references public.profiles (id) on delete set null,
  role text not null,
  status text not null default 'pending',
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint business_members_role_check check (role in ('viewer', 'editor')),
  constraint business_members_status_check check (status in ('pending', 'active', 'revoked')),
  constraint business_members_email_agent unique (agent_id, email)
);

create unique index if not exists business_members_agent_user
  on public.business_members (agent_id, user_id)
  where user_id is not null;

create index if not exists business_members_user_idx
  on public.business_members (user_id)
  where status = 'active';

create table if not exists private.business_invite_secrets (
  member_id uuid primary key references public.business_members (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);

revoke all on table private.business_invite_secrets from public, anon, authenticated;

create or replace function public.business_invite_put(p_member uuid, p_hash text, p_expires timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('anon', 'authenticated') then
    raise exception 'not allowed';
  end if;
  insert into private.business_invite_secrets (member_id, token_hash, expires_at)
  values (p_member, p_hash, p_expires)
  on conflict (member_id) do update
    set token_hash = excluded.token_hash,
        expires_at = excluded.expires_at;
end;
$$;

create or replace function public.business_invite_clear(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('anon', 'authenticated') then
    raise exception 'not allowed';
  end if;
  delete from private.business_invite_secrets where member_id = p_member;
end;
$$;

revoke all on function public.business_invite_put(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.business_invite_clear(uuid) from public, anon, authenticated;
grant execute on function public.business_invite_put(uuid, text, timestamptz) to service_role;
grant execute on function public.business_invite_clear(uuid) to service_role;

alter table public.business_members enable row level security;

revoke all on table public.business_members from public, anon;
grant select on table public.business_members to authenticated;

create or replace function public.can_read_business(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.tailortalk_agents as agent
      where agent.id = p_agent
        and agent.client_id = auth.uid()
    )
    or exists (
      select 1 from public.business_members as member
      where member.agent_id = p_agent
        and member.user_id = auth.uid()
        and member.status = 'active'
    );
$$;

create or replace function public.can_edit_business(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.tailortalk_agents as agent
      where agent.id = p_agent
        and agent.client_id = auth.uid()
    )
    or exists (
      select 1 from public.business_members as member
      where member.agent_id = p_agent
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role = 'editor'
    );
$$;

create or replace function public.can_manage_members(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.tailortalk_agents as agent
      where agent.id = p_agent
        and agent.client_id = auth.uid()
    );
$$;

revoke all on function public.can_read_business(uuid) from public, anon;
revoke all on function public.can_edit_business(uuid) from public, anon;
revoke all on function public.can_manage_members(uuid) from public, anon;
grant execute on function public.can_read_business(uuid) to authenticated;
grant execute on function public.can_edit_business(uuid) to authenticated;
grant execute on function public.can_manage_members(uuid) to authenticated;

drop policy if exists tailortalk_agents_select on public.tailortalk_agents;
create policy tailortalk_agents_select on public.tailortalk_agents
  for select to authenticated
  using (public.can_read_business(id));

drop policy if exists tailortalk_leads_select on public.tailortalk_leads;
create policy tailortalk_leads_select on public.tailortalk_leads
  for select to authenticated
  using (public.can_read_business(agent_id));

drop policy if exists tailortalk_stats_select on public.tailortalk_agent_stats;
create policy tailortalk_stats_select on public.tailortalk_agent_stats
  for select to authenticated
  using (public.can_read_business(agent_id));

drop policy if exists tailortalk_prompt_versions_select on public.tailortalk_prompt_versions;
create policy tailortalk_prompt_versions_select on public.tailortalk_prompt_versions
  for select to authenticated
  using (public.can_read_business(agent_id));

drop policy if exists business_members_select on public.business_members;
create policy business_members_select on public.business_members
  for select to authenticated
  using (public.can_manage_members(agent_id) or user_id = auth.uid());

create or replace view public.client_ai_setters
with (security_invoker = true) as
select
  id,
  client_id,
  coalesce(nullif(btrim(agent_name), ''), nullif(btrim(label), ''), 'AI Setter') as agent_name,
  case when archived then 'paused' else 'active' end as status,
  prompt_sections,
  prompt_updated_at,
  last_activity_at,
  tailortalk_created_at as created_at
from public.tailortalk_agents
where public.can_read_business(id);

create or replace view public.client_ai_setter_stats
with (security_invoker = true) as
select
  stats.agent_id,
  stats.total_leads,
  stats.by_status,
  stats.by_source,
  stats.by_category,
  stats.converted_count,
  stats.conversion_rate,
  stats.last_activity_at,
  stats.leads_per_day
from public.tailortalk_agent_stats as stats
join public.tailortalk_agents as agent on agent.id = stats.agent_id
where public.can_read_business(agent.id);

create or replace view public.client_ai_setter_leads
with (security_invoker = true) as
select
  leads.agent_id,
  leads.lead_name,
  leads.username,
  leads.lead_status as stage,
  leads.last_message_time,
  leads.is_converted,
  leads.category,
  leads.lead_contact
from public.tailortalk_leads as leads
join public.tailortalk_agents as agent on agent.id = leads.agent_id
where public.can_read_business(agent.id);

create or replace view public.client_prompt_versions
with (security_invoker = true) as
select
  versions.agent_id,
  versions.version_id,
  versions.deployed_at,
  versions.sections,
  versions.recorded_at
from public.tailortalk_prompt_versions as versions
join public.tailortalk_agents as agent on agent.id = versions.agent_id
where public.can_read_business(agent.id);

create or replace view public.business_access
with (security_invoker = true) as
select
  agent.id as agent_id,
  case
    when public.is_admin() then 'admin'
    when agent.client_id = auth.uid() then 'owner'
    else coalesce(member.role, 'viewer')
  end as role
from public.tailortalk_agents as agent
left join public.business_members as member
  on member.agent_id = agent.id
 and member.user_id = auth.uid()
 and member.status = 'active'
where public.can_read_business(agent.id);

revoke all on table public.business_access from public, anon;
grant select on table public.business_access to authenticated;

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
  if row is null then
    return null;
  end if;
  return jsonb_build_object(
    'email', row.email,
    'role', row.role,
    'status', row.status,
    'business_name', row.business_name
  );
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  member uuid;
  agent uuid;
  mail text;
  member_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select email into mail from auth.users where id = auth.uid();
  select m.id, m.agent_id, m.status into member, agent, member_status
  from private.business_invite_secrets as secret
  join public.business_members as m on m.id = secret.member_id
  where secret.token_hash = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
    and secret.expires_at > now()
    and lower(m.email) = lower(coalesce(mail, ''))
    and (
      m.status = 'pending'
      or (m.status = 'active' and m.user_id = auth.uid())
    );
  if member is null then
    return null;
  end if;
  if member_status = 'pending' then
    update public.business_members
      set user_id = auth.uid(),
          status = 'active',
          accepted_at = now()
      where id = member;
  end if;
  delete from private.business_invite_secrets where member_id = member;
  return agent;
end;
$$;

revoke all on function public.preview_invite(text) from public;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.preview_invite(text) to anon, authenticated;
grant execute on function public.accept_invite(text) to authenticated;

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
    if member_id is null then
      raise exception 'Invalid invite';
    end if;
    new.raw_user_meta_data := (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code' - 'invite_token')
      || jsonb_build_object('invite_member_id', member_id);
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

revoke all on function private.enforce_signup_access_code() from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited uuid;
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

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
