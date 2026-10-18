-- Businesses home, name matching, and a pending-publish queue.
-- Apply after 20261014200000_client_setter.sql.
-- The public setter API cannot create an agent or replace workflow instructions.
-- A generated prompt is stored here as pending until it is published from the connector.

alter table public.profiles
  add column if not exists business_name text;

alter table public.onboarding_submissions
  add column if not exists publish_status text not null default 'idle',
  add column if not exists publish_error text,
  add column if not exists publish_agent_id uuid references public.tailortalk_agents (id) on delete set null,
  add column if not exists publish_requested_at timestamptz;

alter table public.onboarding_submissions
  drop constraint if exists onboarding_submissions_publish_status_check;

alter table public.onboarding_submissions
  add constraint onboarding_submissions_publish_status_check
  check (publish_status in ('idle', 'pending', 'published', 'failed'));

create or replace function public.guard_onboarding_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.last_activity_at = now();
  new.user_id = old.user_id;
  new.created_at = old.created_at;

  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if auth.uid() is distinct from old.user_id then
    raise exception 'not allowed';
  end if;

  if old.status in ('integrated', 'live') then
    raise exception 'This onboarding is locked';
  end if;

  if new.status is null or new.status not in ('not_started', 'in_progress', 'submitted') then
    raise exception 'status not allowed';
  end if;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_at = coalesce(old.submitted_at, now());
  end if;

  if new.status <> 'submitted' then
    new.submitted_at = null;
    new.prompt_text = null;
    new.prompt_sections = '{}'::jsonb;
    new.prompt_generated_at = null;
    new.generation_status = 'idle';
    new.generation_error = null;
    new.email_status = 'idle';
    new.email_error = null;
    new.publish_status = 'idle';
    new.publish_error = null;
    new.publish_agent_id = null;
    new.publish_requested_at = null;
  else
    new.prompt_text = old.prompt_text;
    new.prompt_sections = old.prompt_sections;
    new.prompt_generated_at = old.prompt_generated_at;
    new.generation_status = old.generation_status;
    new.generation_error = old.generation_error;
    new.email_status = old.email_status;
    new.email_error = old.email_error;
    new.submitted_at = coalesce(old.submitted_at, new.submitted_at, now());
    new.publish_status = old.publish_status;
    new.publish_error = old.publish_error;
    new.publish_agent_id = old.publish_agent_id;
    new.publish_requested_at = old.publish_requested_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_onboarding_update() from public, anon, authenticated;

create or replace function public.business_name_key(raw text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9]+', '', 'g');
$$;

revoke execute on function public.business_name_key(text) from public, anon, authenticated;
grant execute on function public.business_name_key(text) to postgres, service_role;

create or replace function public.match_client_agent(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  names text[];
  match_id uuid;
  match_count integer;
begin
  if auth.role() in ('anon', 'authenticated')
     and auth.uid() is distinct from p_user_id
     and not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select agent.id
    into match_id
    from public.tailortalk_agents as agent
    where agent.client_id = p_user_id
    limit 1;

  if match_id is not null then
    update public.onboarding_submissions
      set publish_agent_id = match_id
      where user_id = p_user_id
        and publish_status = 'pending'
        and publish_agent_id is null;
    return match_id;
  end if;

  select array_remove(array[
    public.business_name_key(profile.full_name),
    public.business_name_key(profile.business_name),
    public.business_name_key(submission.answers ->> 'clientName')
  ], '')
  into names
  from public.profiles as profile
  left join public.onboarding_submissions as submission on submission.user_id = profile.id
  where profile.id = p_user_id;

  if names is null then
    return null;
  end if;

  select count(*), (array_agg(agent.id order by agent.updated_at desc nulls last))[1]
  into match_count, match_id
  from public.tailortalk_agents as agent
  where agent.client_id is null
    and agent.archived = false
    and (
      public.business_name_key(agent.agent_name) = any (names)
      or public.business_name_key(agent.label) = any (names)
    );

  if match_count = 1 then
    update public.tailortalk_agents
      set client_id = p_user_id
      where id = match_id
        and client_id is null;
    update public.onboarding_submissions
      set publish_agent_id = match_id
      where user_id = p_user_id
        and publish_status = 'pending'
        and publish_agent_id is null;
    return match_id;
  end if;

  return null;
end;
$$;

revoke all on function public.match_client_agent(uuid) from public, anon, authenticated;
grant execute on function public.match_client_agent(uuid) to service_role;

create or replace function public.link_business(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(p_name, ''));
begin
  if uid is null or auth.role() = 'anon' then
    raise exception 'not allowed';
  end if;
  if cleaned = '' then
    raise exception 'Enter a business name';
  end if;

  update public.profiles
    set business_name = cleaned
    where id = uid;

  return public.match_client_agent(uid);
end;
$$;

revoke all on function public.link_business(text) from public, anon;
grant execute on function public.link_business(text) to authenticated;

drop policy if exists tailortalk_prompt_versions_select on public.tailortalk_prompt_versions;
create policy tailortalk_prompt_versions_select on public.tailortalk_prompt_versions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.tailortalk_agents as agent
      where agent.id = tailortalk_prompt_versions.agent_id
        and agent.client_id = auth.uid()
    )
  );

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
where client_id = auth.uid()
   or public.is_admin();

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
where agent.client_id = auth.uid()
   or public.is_admin();

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
where agent.client_id = auth.uid()
   or public.is_admin();

revoke all on table public.client_prompt_versions from public, anon;
grant select on table public.client_prompt_versions to authenticated;
