-- TailorTalk facts. Summary pulls must not wipe webhook attributes or history.
-- The registry sync job keeps its name and runs every 5 minutes.
-- The command text is copied inside the database and is not selected out.
-- Does not unschedule acquisition-tick or acq-tailortalk-sync.

alter table public.acq_contacts
  add column if not exists detail_source text not null default 'pull';

alter table public.acq_contacts drop constraint if exists acq_contacts_detail_source_check;
alter table public.acq_contacts
  add constraint acq_contacts_detail_source_check
  check (detail_source in ('pull', 'webhook'));

alter table public.acq_setter_links
  add column if not exists webhook_seen_at timestamptz;

update public.acq_contacts c
set detail_source = 'webhook'
where c.detail_source = 'pull'
  and exists (
    select 1
    from public.acq_conversations v
    join public.acq_messages m on m.conversation_id = v.id
    where v.contact_id = c.id
  );

update public.acq_setter_links l
set webhook_seen_at = sub.seen
from (
  select business_id, max(created_at) as seen
  from public.acq_messages
  group by business_id
) sub
where l.business_id = sub.business_id
  and l.webhook_seen_at is null;

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
      left(coalesce(v_row->>'source_detail', ''), 200),
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
          p_business, v_handle, 'tailortalk', left(coalesce(v_row->>'source_detail', ''), 200),
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
          p_business, v_handle, 'tailortalk', left(coalesce(v_row->>'source_detail', ''), 200),
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
          'tailortalk'
        )
        on conflict (target_id) do nothing;
        if found then
          v_bookings := v_bookings + 1;
        end if;
      end loop;
    end if;

    if v_status = 'converted' then
      insert into public.acq_bookings (agent_id, target_id, show_status, source, scheduled_at)
      values (p_business, v_target, 'scheduled', 'tailortalk', v_last)
      on conflict (target_id) do nothing;
      if found then
        v_bookings := v_bookings + 1;
      end if;
    end if;

    v_role := coalesce(v_row->>'role', 'comment_to_dm');
    if v_changed and coalesce(p_active_roles, '[]'::jsonb) ? v_role then
      perform public.acq_log(
        p_business, v_target, v_role, 'tailortalk.synced', 'done', '', 'tailortalk',
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
  where a.setter_provider = 'tailortalk'
    and l.status = 'connected'
    and extensions.pgp_sym_decrypt(s.agent_id_encrypted, v_key) = btrim(p_agent);
end;
$$;

revoke all on function public.acq_tt_businesses_for_tt_agent(text) from public, anon, authenticated;
grant execute on function public.acq_tt_businesses_for_tt_agent(text) to service_role;

create or replace function public.tailortalk_register_business_agent(
  p_tailortalk_agent_id text,
  p_agent_name text,
  p_access_token text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  agent_uuid uuid;
  v_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_tailortalk_agent_id is null or length(btrim(p_tailortalk_agent_id)) = 0 then
    raise exception 'tailortalk_agent_id is required';
  end if;
  v_name := left(btrim(coalesce(nullif(btrim(p_agent_name), ''), p_tailortalk_agent_id)), 80);
  select id into agent_uuid
  from public.tailortalk_agents
  where tailortalk_agent_id = btrim(p_tailortalk_agent_id);
  if agent_uuid is null then
    agent_uuid := public.tailortalk_upsert_agent(
      btrim(p_tailortalk_agent_id),
      v_name,
      null,
      null,
      null,
      null,
      null,
      nullif(btrim(coalesce(p_access_token, '')), ''),
      false
    );
  else
    if p_access_token is not null and length(btrim(p_access_token)) > 0 then
      perform public.tailortalk_put_secret(agent_uuid, btrim(p_access_token));
    end if;
    update public.tailortalk_agents
      set archived = false,
          updated_at = now()
      where id = agent_uuid
        and archived = true;
  end if;
  return agent_uuid;
end;
$$;

revoke all on function public.tailortalk_register_business_agent(text, text, text) from public, anon, authenticated;
grant execute on function public.tailortalk_register_business_agent(text, text, text) to service_role;

create or replace function public.tailortalk_read_cron_secret()
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  stored text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select value into stored from private.tailortalk_settings where key = 'cron_secret';
  return stored;
end;
$$;

create or replace function public.tailortalk_read_sync_url()
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  stored text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select value into stored from private.tailortalk_settings where key = 'sync_url';
  return stored;
end;
$$;

revoke all on function public.tailortalk_read_cron_secret() from public, anon, authenticated;
revoke all on function public.tailortalk_read_sync_url() from public, anon, authenticated;
grant execute on function public.tailortalk_read_cron_secret() to service_role;
grant execute on function public.tailortalk_read_sync_url() to service_role;

do $$
declare
  v_command text;
begin
  select command into v_command from cron.job where jobname = 'tailortalk-sync-hourly';
  if v_command is null then
    return;
  end if;
  perform cron.unschedule('tailortalk-sync-hourly');
  perform cron.schedule('tailortalk-sync-hourly', '*/5 * * * *', v_command);
end
$$;
