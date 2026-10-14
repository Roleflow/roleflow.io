-- Client link for the white-label AI setter on /account/.
-- Apply after 20261014180000_tailortalk_registry.sql.
-- Idempotent. Does not call an API and does not deploy an edge function.
--
-- client_id is the client's profile id (the same id as auth.uid()).
-- Existing profile_id links are copied across. One client, one agent.
-- A trigger keeps client_id and profile_id the same value.
--
-- A signed-in client can select only the agent linked to them, that agent's
-- stats, and that agent's leads. Tokens stay in private.tailortalk_agent_secrets.
-- anon and authenticated still have no grant on that table. Prompt history and
-- contact phone numbers stay admin-only.
--
-- The client page reads the three views below, which expose no token, no
-- provider id, and no sync error text.

alter table public.tailortalk_agents
  add column if not exists client_id uuid references public.profiles (id) on delete set null;

alter table public.tailortalk_leads
  add column if not exists username text;

alter table public.tailortalk_agent_stats
  add column if not exists by_category jsonb not null default '{}'::jsonb;

-- If two agents were linked to one profile, keep the newest link.
with ranked as (
  select id,
    row_number() over (partition by profile_id order by updated_at desc, created_at desc, id desc) as n
  from public.tailortalk_agents
  where profile_id is not null
)
update public.tailortalk_agents as agent
set profile_id = null
from ranked
where agent.id = ranked.id
  and ranked.n > 1;

update public.tailortalk_agents
set client_id = profile_id
where client_id is null
  and profile_id is not null;

create unique index if not exists tailortalk_agents_client_id
  on public.tailortalk_agents (client_id);

create or replace function public.tailortalk_align_client_link()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.client_id is null then
      new.client_id := new.profile_id;
    elsif new.profile_id is null then
      new.profile_id := new.client_id;
    end if;
    return new;
  end if;
  if new.client_id is distinct from old.client_id then
    new.profile_id := new.client_id;
  elsif new.profile_id is distinct from old.profile_id then
    new.client_id := new.profile_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tailortalk_align_client_link on public.tailortalk_agents;
create trigger tailortalk_align_client_link
  before insert or update on public.tailortalk_agents
  for each row execute function public.tailortalk_align_client_link();

revoke all on function public.tailortalk_align_client_link() from public, anon, authenticated;

drop policy if exists tailortalk_agents_select on public.tailortalk_agents;
create policy tailortalk_agents_select on public.tailortalk_agents
  for select to authenticated
  using (public.is_admin() or client_id = auth.uid());

drop policy if exists tailortalk_leads_select on public.tailortalk_leads;
create policy tailortalk_leads_select on public.tailortalk_leads
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.tailortalk_agents as agent
      where agent.id = tailortalk_leads.agent_id
        and agent.client_id = auth.uid()
    )
  );

drop policy if exists tailortalk_stats_select on public.tailortalk_agent_stats;
create policy tailortalk_stats_select on public.tailortalk_agent_stats
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.tailortalk_agents as agent
      where agent.id = tailortalk_agent_stats.agent_id
        and agent.client_id = auth.uid()
    )
  );

-- Contacts and prompt history stay admin-only. Re-assert that here so a
-- client cannot read phone numbers or earlier prompt versions.
drop policy if exists tailortalk_contacts_select on public.tailortalk_contacts;
create policy tailortalk_contacts_select on public.tailortalk_contacts
  for select to authenticated
  using (public.is_admin());

drop policy if exists tailortalk_prompt_versions_select on public.tailortalk_prompt_versions;
create policy tailortalk_prompt_versions_select on public.tailortalk_prompt_versions
  for select to authenticated
  using (public.is_admin());

revoke all on table private.tailortalk_agent_secrets from public, anon, authenticated;
revoke all on table private.tailortalk_settings from public, anon, authenticated;

create or replace view public.client_ai_setters
with (security_invoker = true) as
select
  id,
  client_id,
  coalesce(nullif(btrim(agent_name), ''), nullif(btrim(label), ''), 'AI Setter') as agent_name,
  case when archived then 'paused' else 'active' end as status,
  prompt_sections,
  prompt_updated_at,
  last_activity_at
from public.tailortalk_agents
where client_id = auth.uid()
   or public.is_admin();

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
where agent.client_id = auth.uid()
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
  leads.category
from public.tailortalk_leads as leads
join public.tailortalk_agents as agent on agent.id = leads.agent_id
where agent.client_id = auth.uid()
   or public.is_admin();

revoke all on table public.client_ai_setters from public, anon;
revoke all on table public.client_ai_setter_stats from public, anon;
revoke all on table public.client_ai_setter_leads from public, anon;
grant select on table public.client_ai_setters to authenticated;
grant select on table public.client_ai_setter_stats to authenticated;
grant select on table public.client_ai_setter_leads to authenticated;
