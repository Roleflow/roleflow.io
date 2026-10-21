-- Roleflow conversation engine, per-business Instagram Login, Google Calendar,
-- and outreach workers. Additive. Does not read or write tailortalk_* and does
-- not drop existing tables. business_id is acq_workspaces.id.
-- Instagram passwords are never stored. The outreach worker keeps its own
-- browser session outside this database.

create extension if not exists pgcrypto;

alter table public.acq_workspaces
  add column if not exists join_code text;

create unique index if not exists acq_workspaces_join_code_idx
  on public.acq_workspaces (join_code)
  where join_code is not null;

update public.acq_workspaces
  set join_code = lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))
  where join_code is null;

create table if not exists public.acq_members (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id),
  constraint acq_members_role_check check (role in ('owner', 'editor', 'viewer')),
  constraint acq_members_status_check check (status in ('active', 'invited'))
);

alter table public.acq_members enable row level security;
revoke all on table public.acq_members from public, anon;
grant select on table public.acq_members to authenticated;

insert into public.acq_members (business_id, user_id, role, status)
select id, owner_id, 'owner', 'active' from public.acq_workspaces
on conflict (business_id, user_id) do nothing;

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
    )
  );
$$;

create or replace function public.acq_can_edit(p_workspace uuid)
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
            and public.can_edit_business(w.tailortalk_agent_id)
          )
        )
    )
    or exists (
      select 1 from public.acq_members m
      where m.business_id = p_workspace
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'editor')
    )
  );
$$;

create or replace function public.acq_open_workspace(p_name text default 'Acquisition')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := left(btrim(coalesce(nullif(p_name, ''), 'Acquisition')), 80);
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  if v_name is null or char_length(btrim(v_name)) = 0 then
    v_name := 'Acquisition';
  end if;
  select id into v_id
  from public.acq_workspaces
  where owner_id = auth.uid()
  order by created_at
  limit 1;
  if v_id is null then
    v_code := lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    insert into public.acq_workspaces (owner_id, name, join_code)
    values (auth.uid(), v_name, v_code)
    returning id into v_id;
  end if;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_id, auth.uid(), 'owner', 'active')
  on conflict (business_id, user_id) do nothing;
  perform public.acq_ensure(v_id);
  return jsonb_build_object('ok', true, 'agent_id', v_id, 'business_id', v_id);
end;
$$;

create or replace function public.acq_join_workspace(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  select id into v_id
  from public.acq_workspaces
  where join_code = lower(btrim(coalesce(p_code, '')));
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'That join code does not match a business.');
  end if;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_id, auth.uid(), 'editor', 'active')
  on conflict (business_id, user_id) do update
    set status = 'active',
        role = case when public.acq_members.role = 'owner' then 'owner' else 'editor' end;
  return jsonb_build_object('ok', true, 'business_id', v_id);
end;
$$;

revoke all on function public.acq_join_workspace(text) from public, anon;
grant execute on function public.acq_join_workspace(text) to authenticated;

drop policy if exists acq_members_select on public.acq_members;
create policy acq_members_select on public.acq_members
  for select to authenticated using (public.acq_can_read(business_id));

alter table public.acq_settings
  add column if not exists reply_delay_seconds integer not null default 60,
  add column if not exists followup_hours integer not null default 6,
  add column if not exists followup_count integer not null default 3,
  add column if not exists public_comment_replies boolean not null default false,
  add column if not exists booking_fallback_url text not null default 'https://calendar.app.google/8i1gomkozavqYU5b8',
  add column if not exists offer_summary text not null default '',
  add column if not exists icp_notes text not null default '',
  add column if not exists knowledge_base text not null default '',
  add column if not exists onboarding_step text not null default 'instagram',
  add column if not exists live_at timestamptz;

alter table public.acq_settings drop constraint if exists acq_settings_delay_check;
alter table public.acq_settings
  add constraint acq_settings_delay_check check (reply_delay_seconds between 0 and 300);
alter table public.acq_settings drop constraint if exists acq_settings_followup_hours_check;
alter table public.acq_settings
  add constraint acq_settings_followup_hours_check check (followup_hours between 1 and 23);
alter table public.acq_settings drop constraint if exists acq_settings_followup_count_check;
alter table public.acq_settings
  add constraint acq_settings_followup_count_check check (followup_count between 1 and 5);
alter table public.acq_settings drop constraint if exists acq_settings_onboarding_check;
alter table public.acq_settings
  add constraint acq_settings_onboarding_check check (
    onboarding_step in ('instagram', 'calendar', 'voice', 'knowledge', 'caps', 'live')
  );

comment on column public.acq_settings.ig_paused is
  'Outreach-worker safety pause after an Instagram warning, challenge, or action block. Does not disconnect the official Instagram API.';

create schema if not exists private;

create table if not exists private.ig_token_secrets (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  token_encrypted text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.google_token_secrets (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  refresh_encrypted text not null,
  access_encrypted text,
  updated_at timestamptz not null default now()
);

create table if not exists private.acquisition_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on private.ig_token_secrets from public, anon, authenticated;
revoke all on private.google_token_secrets from public, anon, authenticated;
revoke all on private.acquisition_settings from public, anon, authenticated;

insert into private.acquisition_settings (key, value)
values ('cron_secret', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public.acq_put_ig_token(p_business uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_business is null or p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'missing secret';
  end if;
  insert into private.ig_token_secrets (business_id, token_encrypted)
  values (p_business, p_token)
  on conflict (business_id) do update
    set token_encrypted = excluded.token_encrypted, updated_at = now();
end;
$$;

create or replace function public.acq_read_ig_token(p_business uuid)
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
  select token_encrypted into stored from private.ig_token_secrets where business_id = p_business;
  return stored;
end;
$$;

create or replace function public.acq_delete_ig_token(p_business uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  delete from private.ig_token_secrets where business_id = p_business;
end;
$$;

create or replace function public.acq_put_google_token(p_business uuid, p_refresh text, p_access text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into private.google_token_secrets (business_id, refresh_encrypted, access_encrypted)
  values (p_business, p_refresh, p_access)
  on conflict (business_id) do update
    set refresh_encrypted = excluded.refresh_encrypted,
        access_encrypted = excluded.access_encrypted,
        updated_at = now();
end;
$$;

create or replace function public.acq_read_google_token(p_business uuid)
returns table (refresh_encrypted text, access_encrypted text)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  select s.refresh_encrypted, s.access_encrypted
  from private.google_token_secrets s
  where s.business_id = p_business;
end;
$$;

create or replace function public.acq_delete_google_token(p_business uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  delete from private.google_token_secrets where business_id = p_business;
end;
$$;

create or replace function public.acq_read_cron_secret()
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
  select value into stored from private.acquisition_settings where key = 'cron_secret';
  return stored;
end;
$$;

revoke all on function public.acq_put_ig_token(uuid, text) from public, anon, authenticated;
revoke all on function public.acq_read_ig_token(uuid) from public, anon, authenticated;
revoke all on function public.acq_delete_ig_token(uuid) from public, anon, authenticated;
revoke all on function public.acq_put_google_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.acq_read_google_token(uuid) from public, anon, authenticated;
revoke all on function public.acq_delete_google_token(uuid) from public, anon, authenticated;
revoke all on function public.acq_read_cron_secret() from public, anon, authenticated;
grant execute on function public.acq_put_ig_token(uuid, text) to service_role;
grant execute on function public.acq_read_ig_token(uuid) to service_role;
grant execute on function public.acq_delete_ig_token(uuid) to service_role;
grant execute on function public.acq_put_google_token(uuid, text, text) to service_role;
grant execute on function public.acq_read_google_token(uuid) to service_role;
grant execute on function public.acq_delete_google_token(uuid) to service_role;
grant execute on function public.acq_read_cron_secret() to service_role;

create table if not exists public.ig_connections (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  ig_user_id text,
  username text,
  expires_at timestamptz,
  scopes text not null default '',
  status text not null default 'disconnected',
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ig_connections_status_check check (status in ('disconnected', 'connected', 'expired', 'error'))
);

create unique index if not exists ig_connections_user_idx
  on public.ig_connections (ig_user_id)
  where ig_user_id is not null;

create table if not exists public.google_connections (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  email text,
  calendar_id text not null default 'primary',
  expires_at timestamptz,
  status text not null default 'disconnected',
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint google_connections_status_check check (status in ('disconnected', 'connected', 'expired', 'error'))
);

create table if not exists public.acq_oauth_states (
  state text primary key,
  provider text not null,
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint acq_oauth_provider_check check (provider in ('instagram', 'google'))
);

create table if not exists public.ig_webhook_events (
  event_id text primary key,
  business_id uuid references public.acq_workspaces (id) on delete set null,
  kind text not null default '',
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.ig_threads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  igsid text not null,
  username text,
  state text not null default 'qualification',
  lead_status text not null default 'cold',
  score text,
  last_user_message_at timestamptz,
  human_locked boolean not null default false,
  human_locked_by uuid references public.profiles (id) on delete set null,
  followup_count integer not null default 0,
  attributes jsonb not null default '{}'::jsonb,
  offered_slots jsonb not null default '[]'::jsonb,
  target_id uuid references public.acq_targets (id) on delete set null,
  timezone text,
  calendar_event_id text,
  meet_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_threads_business_igsid unique (business_id, igsid),
  constraint ig_threads_state_check check (
    state in ('comment_to_dm', 'qualification', 'recovery', 'booking', 'booked', 'human', 'dead', 'closed')
  ),
  constraint ig_threads_lead_check check (lead_status in ('cold', 'warm', 'hot', 'converted', 'dead')),
  constraint ig_threads_score_check check (score is null or score in ('hot', 'warm', 'cold')),
  constraint ig_threads_followups_check check (followup_count >= 0)
);

create index if not exists ig_threads_business_idx on public.ig_threads (business_id, updated_at desc);

create table if not exists public.ig_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  thread_id uuid not null references public.ig_threads (id) on delete cascade,
  direction text not null,
  body text not null default '',
  voice_note_id uuid,
  meta_mid text,
  kind text not null default 'text',
  created_at timestamptz not null default now(),
  constraint ig_messages_direction_check check (direction in ('in', 'out')),
  constraint ig_messages_mid_unique unique (meta_mid)
);

create index if not exists ig_messages_thread_idx on public.ig_messages (thread_id, created_at);

create table if not exists public.ig_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  thread_id uuid references public.ig_threads (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null,
  attempts integer not null default 0,
  status text not null default 'pending',
  tag text,
  idempotency_key text not null,
  last_error text,
  created_at timestamptz not null default now(),
  constraint ig_outbox_kind_check check (kind in ('reply', 'recovery', 'human', 'comment_private', 'comment_public')),
  constraint ig_outbox_status_check check (status in ('pending', 'running', 'done', 'failed', 'blocked')),
  constraint ig_outbox_tag_check check (tag is null or tag = 'HUMAN_AGENT'),
  constraint ig_outbox_attempts_check check (attempts >= 0),
  constraint ig_outbox_key_unique unique (idempotency_key)
);

create index if not exists ig_outbox_due_idx on public.ig_outbox (run_at) where status = 'pending';

create table if not exists public.ig_send_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ig_send_log_business_idx on public.ig_send_log (business_id, created_at desc);

create table if not exists public.acq_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  role text not null,
  version integer not null,
  sections jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint acq_prompt_role_check check (
    role in ('comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking')
  ),
  constraint acq_prompt_version_check check (version > 0),
  constraint acq_prompt_version_unique unique (business_id, role, version)
);

create table if not exists public.acq_prompt_current (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  role text not null,
  version_id uuid not null references public.acq_prompt_versions (id) on delete cascade,
  primary key (business_id, role)
);

create table if not exists public.acq_dnc (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  handle text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (business_id, handle),
  constraint acq_dnc_handle_check check (handle ~ '^[a-z0-9._]{1,30}$')
);

create table if not exists public.acq_workers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  label text not null default 'Outreach worker',
  key_prefix text not null,
  key_hash text not null,
  enabled boolean not null default true,
  status text not null default 'offline',
  last_heartbeat_at timestamptz,
  last_error text,
  pause_reason text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint acq_workers_status_check check (status in ('offline', 'online', 'paused')),
  constraint acq_workers_pause_check check (
    pause_reason is null or pause_reason in ('warning', 'challenge', 'action_block', 'owner')
  ),
  constraint acq_workers_hash_unique unique (key_hash)
);

create index if not exists acq_workers_business_idx on public.acq_workers (business_id, created_at desc);

create table if not exists public.meta_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  confirmation_code text not null,
  ig_user_id text,
  business_id uuid references public.acq_workspaces (id) on delete set null,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  constraint meta_deletion_code_unique unique (confirmation_code),
  constraint meta_deletion_status_check check (status in ('received', 'completed'))
);

alter table public.ig_connections enable row level security;
alter table public.google_connections enable row level security;
alter table public.acq_oauth_states enable row level security;
alter table public.ig_webhook_events enable row level security;
alter table public.ig_threads enable row level security;
alter table public.ig_messages enable row level security;
alter table public.ig_outbox enable row level security;
alter table public.ig_send_log enable row level security;
alter table public.acq_prompt_versions enable row level security;
alter table public.acq_prompt_current enable row level security;
alter table public.acq_dnc enable row level security;
alter table public.acq_workers enable row level security;
alter table public.meta_deletion_requests enable row level security;

revoke all on table public.ig_connections from public, anon;
revoke all on table public.google_connections from public, anon;
revoke all on table public.acq_oauth_states from public, anon, authenticated;
revoke all on table public.ig_webhook_events from public, anon;
revoke all on table public.ig_threads from public, anon;
revoke all on table public.ig_messages from public, anon;
revoke all on table public.ig_outbox from public, anon, authenticated;
revoke all on table public.ig_send_log from public, anon, authenticated;
revoke all on table public.acq_prompt_versions from public, anon;
revoke all on table public.acq_prompt_current from public, anon;
revoke all on table public.acq_dnc from public, anon;
revoke all on table public.acq_workers from public, anon, authenticated;
revoke all on table public.meta_deletion_requests from public, anon;

grant select, update on table public.ig_connections to authenticated;
grant select, update on table public.google_connections to authenticated;
grant select on table public.ig_webhook_events to authenticated;
grant select on table public.ig_threads to authenticated;
grant select on table public.ig_messages to authenticated;
grant select, insert on table public.acq_prompt_versions to authenticated;
grant select, insert, update on table public.acq_prompt_current to authenticated;
grant select, insert, delete on table public.acq_dnc to authenticated;
grant select (
  id, business_id, label, key_prefix, enabled, status, last_heartbeat_at,
  last_error, pause_reason, created_at, rotated_at
) on table public.acq_workers to authenticated;
grant select on table public.meta_deletion_requests to authenticated;

grant select, insert, update, delete on table public.ig_connections to service_role;
grant select, insert, update, delete on table public.google_connections to service_role;
grant select, insert, update, delete on table public.acq_oauth_states to service_role;
grant select, insert, update, delete on table public.ig_webhook_events to service_role;
grant select, insert, update, delete on table public.ig_threads to service_role;
grant select, insert, update, delete on table public.ig_messages to service_role;
grant select, insert, update, delete on table public.ig_outbox to service_role;
grant select, insert, update, delete on table public.ig_send_log to service_role;
grant select, insert, update, delete on table public.acq_prompt_versions to service_role;
grant select, insert, update, delete on table public.acq_prompt_current to service_role;
grant select, insert, update, delete on table public.acq_dnc to service_role;
grant select, insert, update, delete on table public.acq_workers to service_role;
grant select, insert, update, delete on table public.meta_deletion_requests to service_role;

revoke truncate, references, trigger on table
  public.ig_connections,
  public.google_connections,
  public.acq_oauth_states,
  public.ig_webhook_events,
  public.ig_threads,
  public.ig_messages,
  public.ig_outbox,
  public.ig_send_log,
  public.acq_prompt_versions,
  public.acq_prompt_current,
  public.acq_dnc,
  public.acq_workers,
  public.meta_deletion_requests,
  public.acq_members
from anon, authenticated;

drop policy if exists ig_connections_select on public.ig_connections;
create policy ig_connections_select on public.ig_connections
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists ig_connections_update on public.ig_connections;
create policy ig_connections_update on public.ig_connections
  for update to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists google_connections_select on public.google_connections;
create policy google_connections_select on public.google_connections
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists google_connections_update on public.google_connections;
create policy google_connections_update on public.google_connections
  for update to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists ig_events_select on public.ig_webhook_events;
create policy ig_events_select on public.ig_webhook_events
  for select to authenticated
  using (business_id is not null and public.acq_can_read(business_id));

drop policy if exists ig_threads_select on public.ig_threads;
create policy ig_threads_select on public.ig_threads
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists ig_messages_select on public.ig_messages;
create policy ig_messages_select on public.ig_messages
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists acq_prompt_versions_select on public.acq_prompt_versions;
create policy acq_prompt_versions_select on public.acq_prompt_versions
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_prompt_versions_insert on public.acq_prompt_versions;
create policy acq_prompt_versions_insert on public.acq_prompt_versions
  for insert to authenticated
  with check (public.acq_can_edit(business_id) and (created_by is null or created_by = auth.uid()));

drop policy if exists acq_prompt_current_select on public.acq_prompt_current;
create policy acq_prompt_current_select on public.acq_prompt_current
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_prompt_current_write on public.acq_prompt_current;
create policy acq_prompt_current_write on public.acq_prompt_current
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_dnc_select on public.acq_dnc;
create policy acq_dnc_select on public.acq_dnc
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_dnc_write on public.acq_dnc;
create policy acq_dnc_write on public.acq_dnc
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_workers_select on public.acq_workers;
create policy acq_workers_select on public.acq_workers
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists meta_deletion_select on public.meta_deletion_requests;
create policy meta_deletion_select on public.meta_deletion_requests
  for select to authenticated
  using (business_id is not null and public.acq_can_read(business_id));

create or replace function public.acq_worker_issue(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_id uuid;
begin
  if not public.acq_can_edit(p_business) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;
  v_raw := 'rfw_' || encode(gen_random_bytes(32), 'hex');
  update public.acq_workers
    set enabled = false, status = 'offline', rotated_at = now()
    where business_id = p_business and enabled;
  insert into public.acq_workers (business_id, key_prefix, key_hash, enabled, status)
  values (p_business, left(v_raw, 12), encode(digest(v_raw, 'sha256'), 'hex'), true, 'offline')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'worker_id', v_id, 'api_key', v_raw, 'prefix', left(v_raw, 12));
end;
$$;

create or replace function public.acq_worker_set_enabled(p_worker uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.acq_workers where id = p_worker;
  if v_business is null or not public.acq_can_edit(v_business) then
    raise exception 'not allowed';
  end if;
  update public.acq_workers
    set enabled = p_enabled,
        status = case when p_enabled then 'offline' else 'paused' end,
        pause_reason = case when p_enabled then null else 'owner' end
    where id = p_worker;
  return jsonb_build_object('ok', true, 'worker_id', p_worker, 'enabled', p_enabled);
end;
$$;

create or replace function public.acq_worker_auth(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.acq_workers%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  if p_key is null or length(p_key) < 20 then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  select * into v_row
  from public.acq_workers
  where key_hash = encode(digest(p_key, 'sha256'), 'hex');
  if v_row.id is null or not v_row.enabled then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  update public.acq_workers
    set last_heartbeat_at = now(),
        status = case when status = 'paused' then 'paused' else 'online' end
    where id = v_row.id;
  return jsonb_build_object(
    'ok', true,
    'business_id', v_row.business_id,
    'worker_id', v_row.id,
    'paused', v_row.status = 'paused'
  );
end;
$$;

revoke all on function public.acq_worker_issue(uuid) from public, anon;
revoke all on function public.acq_worker_set_enabled(uuid, boolean) from public, anon;
revoke all on function public.acq_worker_auth(text) from public, anon, authenticated;
grant execute on function public.acq_worker_issue(uuid) to authenticated, service_role;
grant execute on function public.acq_worker_set_enabled(uuid, boolean) to authenticated;
grant execute on function public.acq_worker_auth(text) to service_role;

create or replace function public.acq_claim_outbox(p_limit integer)
returns setof public.ig_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  with picked as (
    select id
    from public.ig_outbox
    where status = 'pending' and run_at <= now()
    order by run_at
    limit least(greatest(coalesce(p_limit, 10), 1), 20)
    for update skip locked
  )
  update public.ig_outbox o
    set status = 'running', attempts = o.attempts + 1
    from picked
    where o.id = picked.id
    returning o.*;
end;
$$;

revoke all on function public.acq_claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.acq_claim_outbox(integer) to service_role;

create or replace function public.meta_deletion_status(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_at timestamptz;
begin
  select status, created_at into v_status, v_at
  from public.meta_deletion_requests
  where confirmation_code = left(btrim(coalesce(p_code, '')), 80);
  if v_status is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'received_at', v_at);
end;
$$;

revoke all on function public.meta_deletion_status(text) from public;
grant execute on function public.meta_deletion_status(text) to anon, authenticated, service_role;

create or replace function public.acq_workspace_freeze()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'owner is fixed';
  end if;
  if tg_op = 'UPDATE' and new.join_code is distinct from old.join_code
     and coalesce(auth.role(), '') <> 'service_role' then
    new.join_code := old.join_code;
  end if;
  return new;
end;
$$;

drop trigger if exists acq_workspaces_freeze on public.acq_workspaces;
create trigger acq_workspaces_freeze
  before update on public.acq_workspaces
  for each row execute function public.acq_workspace_freeze();

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, then re-run to schedule the acquisition tick.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('acquisition-tick');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'acquisition-tick',
    '* * * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/roleflow-acquisition/tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select value from private.acquisition_settings where key = 'cron_secret'), '')
      ),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 60000
    );
    $job$
  );
end
$cron$;
