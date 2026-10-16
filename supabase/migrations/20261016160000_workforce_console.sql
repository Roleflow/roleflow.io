-- Expose sync time and lead timestamps on the views the console already reads.
-- Apply after 20261016140000_business_assets.sql.
-- Adds columns at the end of each view. No new table, bucket, function, or secret.

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
  tailortalk_created_at as created_at,
  last_synced_at,
  last_sync_error
from public.tailortalk_agents
where public.can_read_business(id);

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
  leads.lead_contact,
  leads.joined_at,
  leads.converted_at,
  leads.total_followups
from public.tailortalk_leads as leads
join public.tailortalk_agents as agent on agent.id = leads.agent_id
where public.can_read_business(agent.id);
