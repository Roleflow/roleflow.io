-- Pluggable setter provider. TailorTalk API keys stay in private, encrypted
-- with pgcrypto. The browser can read connection status only.
-- Additive. Does not unschedule acquisition-tick or tailortalk-sync-hourly.

create extension if not exists pgcrypto with schema extensions;

alter table public.acq_settings
  add column if not exists setter_provider text not null default 'roleflow_meta';

alter table public.acq_settings drop constraint if exists acq_settings_setter_provider_check;
alter table public.acq_settings
  add constraint acq_settings_setter_provider_check
  check (setter_provider in ('roleflow_meta', 'tailortalk'));

insert into private.acquisition_settings (key, value)
values ('tt_token_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table if not exists private.tt_business_secrets (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  api_key_encrypted bytea not null,
  agent_id_encrypted bytea not null,
  webhook_secret_encrypted bytea not null,
  updated_at timestamptz not null default now()
);

revoke all on private.tt_business_secrets from public, anon, authenticated;

create table if not exists public.acq_setter_links (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  provider text not null default 'tailortalk',
  agent_hint text,
  status text not null default 'disconnected',
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  last_synced_at timestamptz,
  last_sync_error text,
  last_sync_counts jsonb not null default '{}'::jsonb,
  webhook_hint text,
  updated_at timestamptz not null default now(),
  constraint acq_setter_links_provider_check check (provider in ('tailortalk', 'roleflow_meta')),
  constraint acq_setter_links_status_check check (status in ('disconnected', 'connected', 'error'))
);

alter table public.acq_setter_links enable row level security;
revoke all on table public.acq_setter_links from public, anon;
grant select on table public.acq_setter_links to authenticated;
grant select, insert, update, delete on table public.acq_setter_links to service_role;

drop policy if exists acq_setter_links_select on public.acq_setter_links;
create policy acq_setter_links_select on public.acq_setter_links
  for select to authenticated using (public.acq_can_read(business_id));

create table if not exists public.acq_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  external_id text not null,
  name text not null default '',
  contact text not null default '',
  ig_handle text,
  lead_status text not null default 'cold',
  category text,
  source_detail text not null default '',
  target_id uuid references public.acq_targets (id) on delete set null,
  attributes jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  followups integer not null default 0,
  is_converted boolean not null default false,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_contacts_external_unique unique (business_id, external_id),
  constraint acq_contacts_status_check check (lead_status in ('cold', 'warm', 'hot', 'converted', 'dead'))
);

create index if not exists acq_contacts_business_status_idx
  on public.acq_contacts (business_id, lead_status);

create table if not exists public.acq_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  contact_id uuid not null references public.acq_contacts (id) on delete cascade,
  external_id text not null,
  status text not null default 'cold',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_conversations_contact_unique unique (contact_id),
  constraint acq_conversations_status_check check (status in ('cold', 'warm', 'hot', 'converted', 'dead'))
);

create index if not exists acq_conversations_business_idx
  on public.acq_conversations (business_id, updated_at desc);

create table if not exists public.acq_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  conversation_id uuid not null references public.acq_conversations (id) on delete cascade,
  external_id text not null,
  role text not null,
  body text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint acq_messages_external_unique unique (conversation_id, external_id),
  constraint acq_messages_role_check check (role in ('user', 'assistant', 'system'))
);

create index if not exists acq_messages_business_idx
  on public.acq_messages (business_id, created_at desc);

create table if not exists public.acq_tt_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  event_key text not null,
  trigger text not null,
  payload jsonb not null default '{}'::jsonb,
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  constraint acq_tt_events_key_unique unique (business_id, event_key)
);

alter table public.acq_contacts enable row level security;
alter table public.acq_conversations enable row level security;
alter table public.acq_messages enable row level security;
alter table public.acq_tt_events enable row level security;

revoke all on table public.acq_contacts from public, anon;
revoke all on table public.acq_conversations from public, anon;
revoke all on table public.acq_messages from public, anon;
revoke all on table public.acq_tt_events from public, anon;

grant select on table public.acq_contacts to authenticated;
grant select on table public.acq_conversations to authenticated;
grant select on table public.acq_messages to authenticated;
grant select on table public.acq_tt_events to authenticated;

grant select, insert, update, delete on table public.acq_contacts to service_role;
grant select, insert, update, delete on table public.acq_conversations to service_role;
grant select, insert, update, delete on table public.acq_messages to service_role;
grant select, insert, update, delete on table public.acq_tt_events to service_role;

drop policy if exists acq_contacts_select on public.acq_contacts;
create policy acq_contacts_select on public.acq_contacts
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists acq_conversations_select on public.acq_conversations;
create policy acq_conversations_select on public.acq_conversations
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists acq_messages_select on public.acq_messages;
create policy acq_messages_select on public.acq_messages
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists acq_tt_events_select on public.acq_tt_events;
create policy acq_tt_events_select on public.acq_tt_events
  for select to authenticated using (public.acq_can_read(business_id));

alter table public.acq_deals
  add column if not exists tt_report_status text,
  add column if not exists tt_report_error text,
  add column if not exists tt_order_id text;

update public.acq_deals
  set tt_report_status = 'skipped'
  where tt_report_status is null;

alter table public.acq_deals
  alter column tt_report_status set default 'pending';

alter table public.acq_deals
  alter column tt_report_status set not null;

alter table public.acq_deals drop constraint if exists acq_deals_tt_report_check;
alter table public.acq_deals
  add constraint acq_deals_tt_report_check
  check (tt_report_status in ('pending', 'reported', 'skipped', 'error'));

create or replace function public.acq_deals_freeze_tt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.tt_report_status := 'pending';
      new.tt_report_error := null;
      new.tt_order_id := null;
    else
      new.tt_report_status := old.tt_report_status;
      new.tt_report_error := old.tt_report_error;
      new.tt_order_id := old.tt_order_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists acq_deals_freeze_tt on public.acq_deals;
create trigger acq_deals_freeze_tt
  before insert or update on public.acq_deals
  for each row execute function public.acq_deals_freeze_tt();

create or replace function public.acq_user_can_edit(p_business uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_business is not null and p_user is not null and (
    exists (select 1 from public.admins where user_id = p_user)
    or exists (
      select 1 from public.acq_workspaces w
      where w.id = p_business and w.owner_id = p_user
    )
    or exists (
      select 1 from public.acq_members m
      where m.business_id = p_business
        and m.user_id = p_user
        and m.status = 'active'
        and m.role in ('owner', 'editor')
    )
    or exists (
      select 1
      from public.acq_workspaces w
      join public.tailortalk_agents agent on agent.id = w.tailortalk_agent_id
      where w.id = p_business and agent.client_id = p_user
    )
    or exists (
      select 1
      from public.acq_workspaces w
      join public.business_members member on member.agent_id = w.tailortalk_agent_id
      where w.id = p_business
        and member.user_id = p_user
        and member.status = 'active'
        and member.role = 'editor'
    )
  );
$$;

revoke all on function public.acq_user_can_edit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acq_user_can_edit(uuid, uuid) to service_role;

create or replace function public.acq_put_tt_secret(
  p_business uuid,
  p_api_key text,
  p_agent_id text,
  p_webhook_secret text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_business is null
     or p_api_key is null or length(btrim(p_api_key)) < 8
     or p_agent_id is null or length(btrim(p_agent_id)) = 0
     or p_webhook_secret is null or length(btrim(p_webhook_secret)) < 16 then
    raise exception 'missing secret';
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  if v_key is null or length(v_key) < 16 then
    raise exception 'token key missing';
  end if;
  insert into private.tt_business_secrets (
    business_id, api_key_encrypted, agent_id_encrypted, webhook_secret_encrypted
  ) values (
    p_business,
    extensions.pgp_sym_encrypt(btrim(p_api_key), v_key),
    extensions.pgp_sym_encrypt(btrim(p_agent_id), v_key),
    extensions.pgp_sym_encrypt(btrim(p_webhook_secret), v_key)
  )
  on conflict (business_id) do update
    set api_key_encrypted = excluded.api_key_encrypted,
        agent_id_encrypted = excluded.agent_id_encrypted,
        webhook_secret_encrypted = excluded.webhook_secret_encrypted,
        updated_at = now();
end;
$$;

create or replace function public.acq_read_tt_secret(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_row private.tt_business_secrets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  select * into v_row from private.tt_business_secrets where business_id = p_business;
  if v_row.business_id is null or v_key is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'api_key', extensions.pgp_sym_decrypt(v_row.api_key_encrypted, v_key),
    'agent_id', extensions.pgp_sym_decrypt(v_row.agent_id_encrypted, v_key),
    'webhook_secret', extensions.pgp_sym_decrypt(v_row.webhook_secret_encrypted, v_key)
  );
end;
$$;

create or replace function public.acq_delete_tt_secret(p_business uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  delete from private.tt_business_secrets where business_id = p_business;
end;
$$;

revoke all on function public.acq_put_tt_secret(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.acq_read_tt_secret(uuid) from public, anon, authenticated;
revoke all on function public.acq_delete_tt_secret(uuid) from public, anon, authenticated;
grant execute on function public.acq_put_tt_secret(uuid, text, text, text) to service_role;
grant execute on function public.acq_read_tt_secret(uuid) to service_role;
grant execute on function public.acq_delete_tt_secret(uuid) to service_role;

create or replace function public.acq_safe_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

revoke all on function public.acq_safe_timestamptz(text) from public, anon, authenticated;
grant execute on function public.acq_safe_timestamptz(text) to service_role;

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
      attributes, last_message_at, followups, is_converted, converted_at
    ) values (
      p_business,
      v_ext,
      left(coalesce(v_row->>'name', ''), 200),
      left(coalesce(v_row->>'contact', ''), 200),
      nullif(left(coalesce(v_row->>'ig_handle', ''), 80), ''),
      v_status,
      nullif(left(coalesce(v_row->>'category', ''), 40), ''),
      left(coalesce(v_row->>'source_detail', ''), 200),
      coalesce(v_row->'attributes', '{}'::jsonb),
      v_last,
      v_followups,
      v_status = 'converted',
      case when v_status = 'converted' then coalesce(v_last, now()) else null end
    )
    on conflict (business_id, external_id) do update
      set name = excluded.name,
          contact = excluded.contact,
          ig_handle = coalesce(excluded.ig_handle, public.acq_contacts.ig_handle),
          lead_status = excluded.lead_status,
          category = coalesce(excluded.category, public.acq_contacts.category),
          source_detail = excluded.source_detail,
          attributes = excluded.attributes,
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
    if jsonb_typeof(v_row->'messages') = 'array' then
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

    if jsonb_typeof(v_row->'bookings') = 'array' then
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

-- One-off mint for operators. Returns the raw rfw_ key once and stores only a hash.
-- Callable by service_role, or by postgres / supabase_admin (Supabase SQL / MCP).
-- Not granted to signed-in users. The panel keeps using acq_worker_issue.
create or replace function public.acq_mint_worker_key(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  if p_business is null or not exists (select 1 from public.acq_workspaces where id = p_business) then
    raise exception 'unknown business';
  end if;
  v_raw := 'rfw_' || encode(extensions.gen_random_bytes(32), 'hex');
  update public.acq_workers
    set enabled = false, status = 'offline', rotated_at = now()
    where business_id = p_business and enabled;
  insert into public.acq_workers (business_id, key_prefix, key_hash, enabled, status, label)
  values (
    p_business,
    left(v_raw, 12),
    encode(extensions.digest(v_raw, 'sha256'), 'hex'),
    true,
    'offline',
    'Minted worker'
  )
  returning id into v_id;
  return jsonb_build_object('ok', true, 'worker_id', v_id, 'api_key', v_raw, 'prefix', left(v_raw, 12));
end;
$$;

revoke all on function public.acq_mint_worker_key(uuid) from public, anon, authenticated;
grant execute on function public.acq_mint_worker_key(uuid) to service_role;

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, then re-run to schedule acq-tailortalk-sync.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('acq-tailortalk-sync');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'acq-tailortalk-sync',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acq-tailortalk',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select value from private.acquisition_settings where key = 'cron_secret'), '')
      ),
      body := '{"action":"sync"}'::jsonb,
      timeout_milliseconds := 120000
    );
    $job$
  );
end
$cron$;
