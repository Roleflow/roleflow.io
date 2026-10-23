-- Engine sync notice. Rows stay pending until the operator marks them done or failed.
-- Does not enable studio sync, does not message leads, and does not write the live workspace.

alter table public.engine_outbox
  add column if not exists result_agent_id text,
  add column if not exists notified_at timestamptz;

alter table public.engine_outbox drop constraint if exists engine_outbox_status_check;
alter table public.engine_outbox add constraint engine_outbox_status_check
  check (status in ('pending', 'applied', 'done', 'failed'));

alter table public.engine_outbox drop constraint if exists engine_outbox_kind_check;
alter table public.engine_outbox add constraint engine_outbox_kind_check check (
  kind in (
    'update_workflow', 'update_settings', 'pause_agent', 'resume_agent', 'message_lead_draft',
    'deploy', 'create_tool', 'update_tool', 'create_agent', 'connect_instagram'
  )
);

create index if not exists engine_outbox_unnotified_idx
  on public.engine_outbox (business_id, created_at)
  where status = 'pending' and notified_at is null;

create or replace function public.acq_engine_enqueue(p_business uuid, p_kind text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_payload jsonb;
  v_agent text;
begin
  if not public.acq_can_edit(p_business) then
    raise exception 'not allowed';
  end if;
  if p_kind not in (
    'update_workflow', 'update_settings', 'pause_agent', 'resume_agent', 'message_lead_draft',
    'deploy', 'create_tool', 'update_tool', 'create_agent', 'connect_instagram'
  ) then
    raise exception 'unknown kind';
  end if;
  v_payload := coalesce(p_payload, '{}'::jsonb)
    - 'api_key' - 'token' - 'access_token' - 'webhook_secret' - 'authorization';
  select external_agent_id into v_agent
  from public.acq_setter_links
  where business_id = p_business;
  if v_agent is not null and btrim(v_agent) <> '' then
    v_payload := v_payload || jsonb_build_object('external_agent_id', btrim(v_agent));
  end if;
  insert into public.engine_outbox (business_id, kind, payload, status)
  values (p_business, p_kind, v_payload, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.acq_workflow_text(p_sections jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_keys text[] := array['exclusion', 'non_negotiables', 'role', 'guardrails', 'knowledge', 'workflow', 'objections'];
  v_heads text[] := array[
    '# Highest Priority Rule (Exclusion)',
    '# Non-Negotiables',
    '# The Role',
    '# The Guardrails',
    '# Context and Knowledge',
    '# Workflow Logic',
    '# Objection Handling'
  ];
  v_out text := '';
  i integer;
  v_body text;
  v_head text;
begin
  for i in 1..7 loop
    v_head := v_heads[i];
    v_body := btrim(coalesce(p_sections->>v_keys[i], ''));
    if v_body <> v_head and left(v_body, char_length(v_head) + 1) is distinct from v_head || E'\n' then
      v_body := v_head || E'\n\n' || v_body;
    end if;
    if v_out <> '' then
      v_out := v_out || E'\n\n';
    end if;
    v_out := v_out || v_body;
  end loop;
  return v_out;
end;
$$;

create or replace function public.acq_save_inbound_prompt(p_business uuid, p_sections jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
  v_id uuid;
  v_key text;
begin
  if not public.acq_can_edit(p_business) then
    raise exception 'not allowed';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'sections required';
  end if;
  foreach v_key in array array['exclusion', 'non_negotiables', 'role', 'guardrails', 'knowledge', 'workflow', 'objections']
  loop
    if coalesce(p_sections->>v_key, '') = '' then
      raise exception 'missing section';
    end if;
  end loop;
  select coalesce(max(version), 0) + 1 into v_version
  from public.acq_prompt_versions
  where business_id = p_business and role = 'inbound_manager';
  insert into public.acq_prompt_versions (business_id, role, version, sections, created_by)
  values (p_business, 'inbound_manager', v_version, p_sections, auth.uid())
  returning id into v_id;
  insert into public.acq_prompt_current (business_id, role, version_id)
  values (p_business, 'inbound_manager', v_id)
  on conflict (business_id, role) do update set version_id = excluded.version_id;
  perform public.acq_engine_enqueue(p_business, 'update_workflow', jsonb_build_object(
    'role', 'inbound_manager',
    'version', v_version,
    'version_id', v_id,
    'workspace_id', p_business,
    'sections', p_sections,
    'workflow_text', public.acq_workflow_text(p_sections)
  ));
  perform public.acq_engine_enqueue(p_business, 'deploy', jsonb_build_object(
    'role', 'inbound_manager',
    'version', v_version,
    'version_id', v_id,
    'workspace_id', p_business
  ));
  return jsonb_build_object('ok', true, 'version', v_version, 'version_id', v_id, 'sync', 'pending');
end;
$$;

drop function if exists public.acq_save_agent_tool(uuid, text, text, text, jsonb);

create or replace function public.acq_save_agent_tool(
  p_business uuid,
  p_role text,
  p_kind text,
  p_name text,
  p_config jsonb,
  p_tool uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_tool;
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_config jsonb := coalesce(p_config, '{}'::jsonb) - 'api_key' - 'token' - 'access_token' - 'authorization' - 'bytes';
  v_type text;
  v_op text := 'create_tool';
begin
  if not public.acq_can_edit(p_business) then
    raise exception 'not allowed';
  end if;
  if p_kind not in ('media', 'document', 'sheet', 'api', 'booking', 'event') then
    raise exception 'unknown tool';
  end if;
  if v_name = '' then
    raise exception 'name required';
  end if;
  if p_role is null or p_role = '' then
    p_role := 'inbound_manager';
  end if;
  if v_id is not null then
    update public.acq_agent_tools
    set agent_role = p_role,
        kind = p_kind,
        name = v_name,
        config = v_config
    where id = v_id
      and business_id = p_business
    returning id into v_id;
    if v_id is null then
      raise exception 'unknown tool';
    end if;
    v_op := 'update_tool';
  else
    insert into public.acq_agent_tools (business_id, agent_role, kind, name, config)
    values (p_business, p_role, p_kind, v_name, v_config)
    returning id into v_id;
  end if;
  v_type := case when coalesce(v_config->>'media_type', '') = 'voice' then 'media' else p_kind end;
  perform public.acq_engine_enqueue(p_business, v_op, jsonb_build_object(
    'tool_id', v_id,
    'name', v_name,
    'kind', p_kind,
    'tool_type', v_type,
    'media_type', nullif(v_config->>'media_type', ''),
    'agent_role', p_role,
    'workspace_id', p_business,
    'config', v_config
  ));
  return jsonb_build_object('ok', true, 'id', v_id, 'op', v_op, 'sync', 'pending');
end;
$$;

create or replace function public.acq_enqueue_create_agent(
  p_business uuid,
  p_version uuid,
  p_personality text,
  p_languages text,
  p_timezone text,
  p_followup_hours integer,
  p_followup_count integer,
  p_booking text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sections jsonb;
  v_hours integer := coalesce(p_followup_hours, 6);
  v_count integer := coalesce(p_followup_count, 3);
  v_zone text := left(btrim(coalesce(p_timezone, '')), 80);
  v_booking text := left(btrim(coalesce(p_booking, '')), 500);
  v_tools jsonb := '[]'::jsonb;
  v_tool uuid;
  v_id uuid;
begin
  if not public.acq_can_edit(p_business) then
    raise exception 'not allowed';
  end if;
  if exists (
    select 1 from public.acq_setter_links
    where business_id = p_business and external_agent_id = 'eujfwcrm'
  ) then
    raise exception 'not allowed';
  end if;
  select sections into v_sections
  from public.acq_prompt_versions
  where id = p_version and business_id = p_business and role = 'inbound_manager';
  if v_sections is null then
    raise exception 'missing prompt';
  end if;
  if v_hours < 1 or v_hours > 23 then
    v_hours := 6;
  end if;
  if v_count < 1 or v_count > 5 then
    v_count := 3;
  end if;
  if v_zone is null or v_zone !~ '^[A-Za-z0-9/_+-]{1,80}$' then
    v_zone := 'Europe/Madrid';
  end if;
  update public.acq_settings
  set setter_provider = 'engine',
      timezone = v_zone,
      followup_hours = v_hours,
      followup_count = v_count
  where agent_id = p_business;
  if v_booking <> '' then
    insert into public.acq_agent_tools (business_id, agent_role, kind, name, config)
    values (p_business, 'inbound_manager', 'booking', 'Booking', jsonb_build_object('calendar_link', v_booking))
    returning id into v_tool;
    v_tools := jsonb_build_array(jsonb_build_object(
      'tool_id', v_tool,
      'name', 'Booking',
      'kind', 'booking',
      'tool_type', 'booking',
      'config', jsonb_build_object('calendar_link', v_booking)
    ));
  end if;
  v_id := public.acq_engine_enqueue(p_business, 'create_agent', jsonb_build_object(
    'workspace_id', p_business,
    'version_id', p_version,
    'personality', left(btrim(coalesce(p_personality, '')), 500),
    'languages', left(btrim(coalesce(p_languages, '')), 120),
    'timezone', v_zone,
    'followup_settings', jsonb_build_object('hours', v_hours, 'count', v_count),
    'tools', v_tools,
    'workflow_text', public.acq_workflow_text(v_sections)
  ));
  return v_id;
end;
$$;

create or replace function public.acq_request_instagram_connection(p_workspace uuid, p_username text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_handle text := lower(regexp_replace(coalesce(p_username, ''), '^@+', ''));
  v_notes text := left(btrim(coalesce(p_notes, '')), 500);
  v_row public.acq_channel_connect_requests;
  v_name text;
  v_outbox uuid;
begin
  if v_user is null then
    raise exception 'Sign in to connect Instagram.';
  end if;
  if not public.acq_can_edit(p_workspace) then
    raise exception 'You cannot edit this business.';
  end if;
  if v_handle !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'Enter the Instagram Business username.';
  end if;

  select * into v_row
  from public.acq_channel_connect_requests
  where workspace_id = p_workspace
    and channel = 'instagram'
    and status in ('pending', 'in_progress')
  order by created_at desc
  limit 1
  for update;

  if v_row.id is null then
    begin
      insert into public.acq_channel_connect_requests (workspace_id, channel, username, status, notes, requested_by)
      values (p_workspace, 'instagram', v_handle, 'pending', nullif(v_notes, ''), v_user)
      returning * into v_row;
    exception when unique_violation then
      update public.acq_channel_connect_requests
      set username = v_handle,
          notes = nullif(v_notes, ''),
          updated_at = now()
      where workspace_id = p_workspace
        and channel = 'instagram'
        and status in ('pending', 'in_progress')
      returning * into v_row;
    end;
  else
    update public.acq_channel_connect_requests
    set username = v_handle,
        notes = nullif(v_notes, ''),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  end if;

  select name into v_name from public.acq_workspaces where id = p_workspace;
  insert into public.acq_notifications (business_id, title, body)
  values (
    p_workspace,
    'Instagram connection waiting',
    'Connecting @' || v_handle || ' for ' || coalesce(v_name, 'this business') || '. We will finish this for you.'
  );

  v_outbox := public.acq_engine_enqueue(p_workspace, 'connect_instagram', jsonb_build_object(
    'workspace_id', p_workspace,
    'request_id', v_row.id,
    'handle', v_row.username
  ));

  return jsonb_build_object(
    'id', v_row.id,
    'workspace_id', v_row.workspace_id,
    'username', v_row.username,
    'status', v_row.status,
    'outbox_id', v_outbox
  );
end;
$$;

create or replace function public.acq_service_only()
returns void
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;
end;
$$;

create or replace function public.acq_claim_sync_notice(p_business uuid)
returns table (id uuid, op text, workspace_id uuid, business_name text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_fresh integer;
begin
  perform public.acq_service_only();
  select count(*) into v_fresh
  from public.engine_outbox
  where business_id = p_business
    and status = 'pending'
    and notified_at is null
    and created_at > now() - interval '60 seconds';
  if v_fresh > 0 then
    return;
  end if;
  return query
  update public.engine_outbox as o
  set notified_at = now()
  from public.acq_workspaces as w
  where o.business_id = p_business
    and w.id = o.business_id
    and o.status = 'pending'
    and o.notified_at is null
  returning o.id, o.kind, o.business_id, w.name;
end;
$$;

create or replace function public.acq_release_sync_notice(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.acq_service_only();
  update public.engine_outbox
  set notified_at = null
  where id = any(coalesce(p_ids, array[]::uuid[]))
    and status = 'pending';
end;
$$;

create or replace function public.acq_engine_outbox_pending()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.acq_service_only();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', item.id,
      'workspace_id', item.business_id,
      'op', item.kind,
      'payload', item.payload - 'api_key' - 'token' - 'access_token' - 'webhook_secret' - 'authorization',
      'created_at', item.created_at,
      'external_agent_id', item.external_agent_id
    ) order by item.created_at)
    from (
      select o.id, o.business_id, o.kind, o.payload, o.created_at, l.external_agent_id
      from public.engine_outbox o
      left join public.acq_setter_links l on l.business_id = o.business_id
      where o.status = 'pending'
      order by o.created_at
      limit 50
    ) as item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.acq_engine_outbox_settle(
  p_id uuid,
  p_status text,
  p_agent_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case
    when p_status in ('done', 'applied') then 'done'
    when p_status = 'failed' then 'failed'
    else null
  end;
  v_business uuid;
  v_agent text := nullif(left(btrim(coalesce(p_agent_id, '')), 80), '');
  v_error text := left(btrim(coalesce(p_error, '')), 500);
begin
  perform public.acq_service_only();
  if v_status is null then
    raise exception 'status must be done or failed';
  end if;
  update public.engine_outbox
  set status = v_status,
      applied_at = now(),
      error = case when v_status = 'failed' then coalesce(nullif(v_error, ''), 'Could not apply.') else null end,
      result_agent_id = case when v_status = 'done' then coalesce(v_agent, result_agent_id) else result_agent_id end
  where id = p_id
    and status = 'pending'
  returning business_id into v_business;
  if v_business is null then
    return jsonb_build_object('ok', false, 'error', 'That item is not pending.');
  end if;
  if v_status = 'done' and v_agent is not null then
    insert into public.acq_setter_links (business_id, provider, status, external_agent_id, updated_at)
    values (v_business, 'engine', 'connected', v_agent, now())
    on conflict (business_id) do update
      set provider = 'engine',
          status = 'connected',
          external_agent_id = excluded.external_agent_id,
          last_sync_error = null,
          updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_status, 'business_id', v_business, 'result_agent_id', v_agent);
end;
$$;

revoke all on function public.acq_workflow_text(jsonb) from public, anon;
revoke all on function public.acq_enqueue_create_agent(uuid, uuid, text, text, text, integer, integer, text) from public, anon;
revoke all on function public.acq_save_agent_tool(uuid, text, text, text, jsonb, uuid) from public, anon;
revoke all on function public.acq_service_only() from public, anon, authenticated;
revoke all on function public.acq_claim_sync_notice(uuid) from public, anon, authenticated;
revoke all on function public.acq_release_sync_notice(uuid[]) from public, anon, authenticated;
revoke all on function public.acq_engine_outbox_pending() from public, anon, authenticated;
revoke all on function public.acq_engine_outbox_settle(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.acq_workflow_text(jsonb) to authenticated, service_role;
grant execute on function public.acq_enqueue_create_agent(uuid, uuid, text, text, text, integer, integer, text) to authenticated, service_role;
grant execute on function public.acq_save_agent_tool(uuid, text, text, text, jsonb, uuid) to authenticated, service_role;
grant execute on function public.acq_service_only() to service_role;
grant execute on function public.acq_claim_sync_notice(uuid) to service_role;
grant execute on function public.acq_release_sync_notice(uuid[]) to service_role;
grant execute on function public.acq_engine_outbox_pending() to service_role;
grant execute on function public.acq_engine_outbox_settle(uuid, text, text, text) to service_role;
