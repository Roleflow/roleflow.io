-- Roleflow Setter Engine outbox and neutral provider value.
-- Additive. Does not unschedule acquisition-tick, acq-tailortalk-sync, or tailortalk-sync-hourly.
-- Internal table and function names stay. Browser-visible values use engine.

alter table public.acq_settings drop constraint if exists acq_settings_setter_provider_check;
alter table public.acq_settings
  add constraint acq_settings_setter_provider_check
  check (setter_provider in ('roleflow_meta', 'tailortalk', 'engine'));

alter table public.acq_setter_links drop constraint if exists acq_setter_links_provider_check;
alter table public.acq_setter_links
  add constraint acq_setter_links_provider_check
  check (provider in ('tailortalk', 'roleflow_meta', 'engine'));

alter table public.acq_setter_links drop constraint if exists acq_setter_links_status_check;
alter table public.acq_setter_links
  add constraint acq_setter_links_status_check
  check (status in ('disconnected', 'connected', 'error', 'pending'));

alter table public.acq_setter_links
  add column if not exists requested_handle text,
  add column if not exists external_agent_id text;

update public.acq_settings
set setter_provider = 'engine'
where setter_provider = 'tailortalk';

update public.acq_setter_links
set provider = 'engine'
where provider = 'tailortalk';

create table if not exists public.engine_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  applied_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint engine_outbox_kind_check check (kind in ('update_workflow', 'update_settings', 'pause_agent', 'message_lead_draft')),
  constraint engine_outbox_status_check check (status in ('pending', 'applied', 'failed'))
);

create index if not exists engine_outbox_pending_idx
  on public.engine_outbox (created_at)
  where status = 'pending';

alter table public.engine_outbox enable row level security;
revoke all on table public.engine_outbox from public, anon;
grant select on table public.engine_outbox to authenticated;
grant select, insert, update, delete on table public.engine_outbox to service_role;

drop policy if exists engine_outbox_select on public.engine_outbox;
create policy engine_outbox_select on public.engine_outbox
  for select to authenticated
  using (public.acq_can_read(business_id));

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
  if p_kind not in ('update_workflow', 'update_settings', 'pause_agent', 'message_lead_draft') then
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

revoke all on function public.acq_engine_enqueue(uuid, text, jsonb) from public, anon;
grant execute on function public.acq_engine_enqueue(uuid, text, jsonb) to authenticated, service_role;

insert into private.acquisition_settings (key, value)
values ('engine_outbox_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public.acq_read_engine_outbox_secret()
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_secret text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select value into v_secret
  from private.acquisition_settings
  where key = 'engine_outbox_secret';
  return v_secret;
end;
$$;

revoke all on function public.acq_read_engine_outbox_secret() from public, anon, authenticated;
grant execute on function public.acq_read_engine_outbox_secret() to service_role;

create or replace function public.acq_tt_businesses_for_tt_agent(p_agent text)
returns table (business_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_agent is null or btrim(p_agent) = '' then
    return;
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  if v_key is null then
    return;
  end if;
  return query
  select s.business_id
  from private.tt_business_secrets s
  join public.acq_settings a on a.agent_id = s.business_id
  join public.acq_setter_links l on l.business_id = s.business_id
  where a.setter_provider in ('engine', 'tailortalk')
    and l.status = 'connected'
    and extensions.pgp_sym_decrypt(s.agent_id_encrypted, v_key) = btrim(p_agent);
end;
$$;

revoke all on function public.acq_tt_businesses_for_tt_agent(text) from public, anon, authenticated;
grant execute on function public.acq_tt_businesses_for_tt_agent(text) to service_role;

create or replace view public.engine_registry
with (security_invoker = true) as
select
  id,
  tailortalk_agent_id as external_agent_id,
  agent_name,
  label,
  profile_id,
  client_id,
  channels,
  prompt_sections,
  prompt_version_id,
  prompt_updated_at,
  tailortalk_created_at as created_remote,
  archived,
  last_synced_at,
  regexp_replace(coalesce(last_sync_error, ''), 'tailortalk', 'setter engine', 'gi') as last_sync_error,
  last_activity_at
from public.tailortalk_agents;

create or replace view public.engine_lead_cache
with (security_invoker = true) as
select
  agent_id,
  external_id,
  lead_name,
  username,
  lead_contact,
  lead_status,
  category,
  regexp_replace(coalesce(source, ''), 'tailortalk', 'instagram', 'gi') as source,
  last_message_time,
  joined_at,
  total_followups,
  is_converted,
  converted_at
from public.tailortalk_leads;

create or replace view public.engine_lead_stats
with (security_invoker = true) as
select
  agent_id,
  total_leads,
  case when by_status is null then null else regexp_replace(by_status::text, 'tailortalk', 'instagram', 'gi')::jsonb end as by_status,
  case when by_source is null then null else regexp_replace(by_source::text, 'tailortalk', 'instagram', 'gi')::jsonb end as by_source,
  case when by_category is null then null else regexp_replace(by_category::text, 'tailortalk', 'instagram', 'gi')::jsonb end as by_category,
  converted_count,
  conversion_rate,
  computed_at,
  last_activity_at,
  leads_per_day
from public.tailortalk_agent_stats;

create or replace view public.engine_prompt_history
with (security_invoker = true) as
select agent_id, version_id, deployed_at, sections
from public.tailortalk_prompt_versions;

grant select on public.engine_registry to authenticated;
grant select on public.engine_lead_cache to authenticated;
grant select on public.engine_lead_stats to authenticated;
grant select on public.engine_prompt_history to authenticated;

update public.acq_setter_links
set last_test_error = regexp_replace(last_test_error, 'tailortalk', 'setter engine', 'gi')
where last_test_error ilike '%tailortalk%';

update public.acq_setter_links
set last_sync_error = regexp_replace(last_sync_error, 'tailortalk', 'setter engine', 'gi')
where last_sync_error ilike '%tailortalk%';

update public.acq_contacts
set source_detail = regexp_replace(source_detail, 'tailortalk', 'instagram', 'gi')
where source_detail ilike '%tailortalk%';

update public.acq_targets
set source = 'instagram'
where source = 'tailortalk';

update public.acq_targets
set source_detail = regexp_replace(source_detail, 'tailortalk', 'instagram', 'gi')
where source_detail ilike '%tailortalk%';

update public.acq_bookings
set source = 'engine'
where source ilike '%tailortalk%';

update public.acq_activity
set action = replace(action, 'tailortalk', 'engine'),
    actor = case when actor ilike '%tailortalk%' then 'engine' else actor end,
    notes = regexp_replace(coalesce(notes, ''), 'tailortalk', 'setter engine', 'gi')
where action ilike '%tailortalk%'
   or actor ilike '%tailortalk%'
   or coalesce(notes, '') ilike '%tailortalk%';

update public.acq_deals
set tt_report_error = regexp_replace(tt_report_error, 'tailortalk', 'setter engine', 'gi')
where tt_report_error ilike '%tailortalk%';

create or replace function public.acq_tt_apply_batch(p_business uuid, p_rows jsonb, p_active_roles jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_msg jsonb;
  v_book jsonb;
  v_contact uuid;
  v_conversation uuid;
  v_target uuid;
  v_handle text;
  v_status text;
  v_stage text;
  v_current_stage text;
  v_next text;
  v_changed boolean;
  v_role text;
  v_logged integer := 0;
  v_contacts integer := 0;
  v_messages integer := 0;
  v_bookings integer := 0;
  v_ext text;
  v_last timestamptz;
  v_prev_status text;
  v_prev_last timestamptz;
  v_followups integer;
  v_maker boolean;
  v_msg_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_business is null or not exists (select 1 from public.acq_workspaces where id = p_business) then
    raise exception 'unknown business';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception 'batch limit is 100';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_ext := left(btrim(coalesce(v_row->>'external_id', '')), 200);
    v_handle := lower(left(btrim(coalesce(v_row->>'handle', '')), 30));
    if v_ext = '' or v_handle !~ '^[a-z0-9._]{1,30}$' then
      continue;
    end if;
    v_status := case v_row->>'lead_status'
      when 'hot' then 'hot'
      when 'warm' then 'warm'
      when 'cold' then 'cold'
      when 'converted' then 'converted'
      when 'dead' then 'dead'
      else 'cold'
    end;
    v_stage := case v_row->>'stage'
      when 'booked' then 'booked'
      when 'dead' then 'dead'
      when 'qualified' then 'qualified'
      else 'reply'
    end;
    v_followups := least(case when coalesce(v_row->>'followups', '') ~ '^[0-9]+$' then (v_row->>'followups')::integer else 0 end, 100000);
    v_maker := case
      when jsonb_typeof(v_row->'decision_maker') = 'boolean' then (v_row->>'decision_maker')::boolean
      when lower(coalesce(v_row->>'decision_maker', '')) in ('true', 'yes', '1') then true
      when lower(coalesce(v_row->>'decision_maker', '')) in ('false', 'no', '0') then false
      else null
    end;
    v_last := public.acq_safe_timestamptz(v_row->>'last_message_at');

    insert into public.acq_contacts (
      business_id, external_id, name, contact, ig_handle, lead_status, category, source_detail,
      attributes, last_message_at, followups, is_converted, converted_at, detail_source
    ) values (
      p_business,
      v_ext,
      left(coalesce(v_row->>'name', ''), 200),
      left(coalesce(v_row->>'contact', ''), 200),
      nullif(left(coalesce(v_row->>'ig_handle', ''), 80), ''),
      v_status,
      nullif(left(coalesce(v_row->>'category', ''), 40), ''),
      left(regexp_replace(coalesce(v_row->>'source_detail', ''), 'tailortalk', 'instagram', 'gi'), 200),
      case
        when coalesce(v_row->>'detail', '') = 'summary' then '{}'::jsonb
        else coalesce(v_row->'attributes', '{}'::jsonb)
      end,
      v_last,
      v_followups,
      v_status = 'converted',
      case when v_status = 'converted' then coalesce(v_last, now()) else null end,
      case when v_row->>'detail' = 'webhook' then 'webhook' else 'pull' end
    )
    on conflict (business_id, external_id) do update
      set name = case when excluded.name = '' then public.acq_contacts.name else excluded.name end,
          contact = case when excluded.contact = '' then public.acq_contacts.contact else excluded.contact end,
          ig_handle = coalesce(excluded.ig_handle, public.acq_contacts.ig_handle),
          lead_status = excluded.lead_status,
          category = coalesce(excluded.category, public.acq_contacts.category),
          source_detail = case
            when excluded.source_detail = '' then public.acq_contacts.source_detail
            else excluded.source_detail
          end,
          attributes = case
            when coalesce(v_row->>'detail', '') = 'summary' then public.acq_contacts.attributes
            when v_row->'attributes' is null
              or jsonb_typeof(v_row->'attributes') <> 'object'
              or v_row->'attributes' = '{}'::jsonb
              then public.acq_contacts.attributes
            else public.acq_contacts.attributes || (v_row->'attributes')
          end,
          detail_source = case
            when v_row->>'detail' = 'webhook' then 'webhook'
            else public.acq_contacts.detail_source
          end,
          last_message_at = coalesce(excluded.last_message_at, public.acq_contacts.last_message_at),
          followups = excluded.followups,
          is_converted = excluded.is_converted,
          converted_at = coalesce(public.acq_contacts.converted_at, excluded.converted_at),
          updated_at = now()
    returning id into v_contact;
    v_contacts := v_contacts + 1;

    insert into public.acq_conversations (business_id, contact_id, external_id, status)
    values (p_business, v_contact, v_ext, v_status)
    on conflict (contact_id) do update
      set status = excluded.status, external_id = excluded.external_id, updated_at = now()
    returning id into v_conversation;

    v_msg_count := 0;
    if coalesce(v_row->>'detail', '') <> 'summary' and jsonb_typeof(v_row->'messages') = 'array' then
      for v_msg in select value from jsonb_array_elements(v_row->'messages') loop
        exit when v_msg_count >= 30;
        if coalesce(v_msg->>'body', '') = '' or coalesce(v_msg->>'external_id', '') = '' then
          continue;
        end if;
        v_msg_count := v_msg_count + 1;
        insert into public.acq_messages (business_id, conversation_id, external_id, role, body, sent_at)
        values (
          p_business,
          v_conversation,
          left(v_msg->>'external_id', 200),
          case when v_msg->>'role' in ('assistant', 'system') then v_msg->>'role' else 'user' end,
          left(v_msg->>'body', 4000),
          public.acq_safe_timestamptz(v_msg->>'sent_at')
        )
        on conflict (conversation_id, external_id) do nothing;
        if found then
          v_messages := v_messages + 1;
        end if;
      end loop;
    end if;

    v_target := null;
    v_current_stage := null;
    v_prev_status := null;
    v_prev_last := null;
    select id, stage, lead_status, last_message_at
      into v_target, v_current_stage, v_prev_status, v_prev_last
    from public.acq_targets
    where agent_id = p_business and tailortalk_external_id = v_ext
    limit 1;

    if v_target is null then
      select id, stage, lead_status, last_message_at
        into v_target, v_current_stage, v_prev_status, v_prev_last
      from public.acq_targets
      where agent_id = p_business
        and handle = v_handle
        and (tailortalk_external_id is null or tailortalk_external_id = v_ext)
      limit 1;
    end if;

    if v_target is null then
      begin
        insert into public.acq_targets (
          agent_id, handle, source, source_detail, stage, peak_stage, lead_status,
          budget, timeline, decision_maker, fit, tailortalk_external_id, tt_category,
          last_message_at, followups, recovery_due, bio
        ) values (
          p_business, v_handle, 'instagram', left(regexp_replace(coalesce(v_row->>'source_detail', ''), 'tailortalk', 'instagram', 'gi'), 200),
          v_stage, case when v_stage = 'dead' then 'reply' else v_stage end, v_status,
          nullif(v_row->>'budget', ''), nullif(v_row->>'timeline', ''), v_maker, nullif(v_row->>'fit', ''),
          v_ext, nullif(left(coalesce(v_row->>'category', ''), 40), ''),
          v_last, v_followups, coalesce((v_row->>'recovery_due')::boolean, false), ''
        ) returning id into v_target;
      exception when unique_violation then
        v_handle := left(v_handle, 26) || substr(md5(v_ext), 1, 4);
        insert into public.acq_targets (
          agent_id, handle, source, source_detail, stage, peak_stage, lead_status,
          budget, timeline, decision_maker, fit, tailortalk_external_id, tt_category,
          last_message_at, followups, recovery_due, bio
        ) values (
          p_business, v_handle, 'instagram', left(regexp_replace(coalesce(v_row->>'source_detail', ''), 'tailortalk', 'instagram', 'gi'), 200),
          v_stage, case when v_stage = 'dead' then 'reply' else v_stage end, v_status,
          nullif(v_row->>'budget', ''), nullif(v_row->>'timeline', ''), v_maker, nullif(v_row->>'fit', ''),
          v_ext, nullif(left(coalesce(v_row->>'category', ''), 40), ''),
          v_last, v_followups, coalesce((v_row->>'recovery_due')::boolean, false), ''
        ) returning id into v_target;
      end;
      v_changed := true;
    else
      v_next := public.acq_advance_stage(v_current_stage, v_stage);
      v_changed := v_prev_status is distinct from v_status
        or v_current_stage is distinct from v_next
        or v_prev_last is distinct from v_last;
      update public.acq_targets
        set lead_status = v_status,
            stage = v_next,
            budget = coalesce(nullif(v_row->>'budget', ''), budget),
            timeline = coalesce(nullif(v_row->>'timeline', ''), timeline),
            decision_maker = coalesce(v_maker, decision_maker),
            fit = coalesce(nullif(v_row->>'fit', ''), fit),
            tailortalk_external_id = v_ext,
            tt_category = coalesce(nullif(left(coalesce(v_row->>'category', ''), 40), ''), tt_category),
            last_message_at = coalesce(v_last, last_message_at),
            followups = v_followups,
            recovery_due = coalesce((v_row->>'recovery_due')::boolean, false)
        where id = v_target;
    end if;

    update public.acq_contacts
      set target_id = v_target
      where id = v_contact and target_id is distinct from v_target;

    if v_row->>'detail' = 'webhook' then
      update public.acq_setter_links
        set webhook_seen_at = now(),
            updated_at = now()
        where business_id = p_business;
    end if;

    if coalesce(v_row->>'detail', '') <> 'summary' and jsonb_typeof(v_row->'bookings') = 'array' then
      for v_book in select value from jsonb_array_elements(v_row->'bookings') loop
        insert into public.acq_bookings (agent_id, target_id, scheduled_at, show_status, calendar_ref, source)
        values (
          p_business,
          v_target,
          public.acq_safe_timestamptz(v_book->>'scheduled_at'),
          case v_book->>'show_status'
            when 'showed' then 'showed'
            when 'no_show' then 'no_show'
            when 'cancelled' then 'cancelled'
            else 'scheduled'
          end,
          nullif(left(coalesce(v_book->>'calendar_ref', ''), 200), ''),
          'engine'
        )
        on conflict (target_id) do nothing;
        if found then
          v_bookings := v_bookings + 1;
        end if;
      end loop;
    end if;

    if v_status = 'converted' then
      insert into public.acq_bookings (agent_id, target_id, show_status, source, scheduled_at)
      values (p_business, v_target, 'scheduled', 'engine', v_last)
      on conflict (target_id) do nothing;
      if found then
        v_bookings := v_bookings + 1;
      end if;
    end if;

    v_role := coalesce(v_row->>'role', 'comment_to_dm');
    if v_changed and coalesce(p_active_roles, '[]'::jsonb) ? v_role then
      perform public.acq_log(
        p_business, v_target, v_role, 'engine.synced', 'done', '', 'engine',
        jsonb_build_object('external_id', v_ext, 'lead_status', v_status, 'stage', v_stage)
      );
      perform public.acq_bump_role(
        p_business,
        v_role,
        coalesce((select timezone from public.acq_settings where agent_id = p_business), 'Europe/Madrid'),
        null
      );
      v_logged := v_logged + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'contacts', v_contacts,
    'messages', v_messages,
    'bookings', v_bookings,
    'logged', v_logged
  );
end;
$$;



revoke all on function public.acq_tt_apply_batch(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.acq_tt_apply_batch(uuid, jsonb, jsonb) to service_role;
