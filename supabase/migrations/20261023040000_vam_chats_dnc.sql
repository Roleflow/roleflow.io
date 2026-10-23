-- Per-conversation chat fields, the Value Add Marketing setter link, and a
-- service-role read of the linked agent token for a sheet fetch.
-- studio_setter_sync stays off. This file inserts no messages and no handles.
-- udnnperp stays blocked on the generic acquisition connect path.

alter table public.acq_messages
  add column if not exists sender text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.acq_messages drop constraint if exists acq_messages_sender_check;
alter table public.acq_messages
  add constraint acq_messages_sender_check
  check (sender is null or sender in ('ai', 'human', 'lead'));

create index if not exists acq_messages_conversation_idx
  on public.acq_messages (conversation_id, created_at desc);

update public.acq_workspaces w
set tailortalk_agent_id = a.id,
    updated_at = now()
from public.tailortalk_agents a
where w.id = '1351d2ac-79bb-545d-8da0-c49ecff28a47'
  and a.tailortalk_agent_id = 'udnnperp';

insert into public.acq_setter_links (
  business_id, provider, external_agent_id, agent_hint, status, updated_at
) values (
  '1351d2ac-79bb-545d-8da0-c49ecff28a47',
  'engine',
  'udnnperp',
  'ntrtnxfad',
  'connected',
  now()
)
on conflict (business_id) do update
set provider = excluded.provider,
    external_agent_id = excluded.external_agent_id,
    agent_hint = excluded.agent_hint,
    status = excluded.status,
    updated_at = now();

update public.acq_settings
set studio_setter_sync = false
where agent_id = '1351d2ac-79bb-545d-8da0-c49ecff28a47';

create or replace function public.acq_read_linked_agent_token(p_business uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_token text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select s.access_token into v_token
  from public.acq_setter_links l
  join public.tailortalk_agents a on a.tailortalk_agent_id = l.external_agent_id
  join private.tailortalk_agent_secrets s on s.agent_id = a.id
  where l.business_id = p_business
    and s.access_token is not null
    and length(s.access_token) >= 8
  limit 1;
  return v_token;
end;
$$;

revoke all on function public.acq_read_linked_agent_token(uuid) from public, anon, authenticated;
grant execute on function public.acq_read_linked_agent_token(uuid) to service_role;
