-- Outreacher controller state. NOT APPLIED. Do not deploy outreach-controller with this file.
-- Additive only. It does not change client_machines uniqueness, proxies, or direct-message switches.
-- One shared worker can hold two or three browser profiles. Each profile binds one business,
-- one process slot, and one proxy. A proxy without its own profile is not a separate login.
-- The current managed desktop is not represented here and is not marked ready.

create table if not exists public.outreacher_workers (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  capacity integer not null default 3,
  status text not null default 'unconfigured',
  desktop_capability text not null default 'unverified',
  proxy_mode text not null default 'unset',
  interaction text not null default 'computer_use',
  shell_control boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreacher_workers_capacity_check check (capacity in (2, 3)),
  constraint outreacher_workers_status_check check (status in (
    'unconfigured', 'offline', 'unsupported', 'ready', 'paused', 'revoked'
  )),
  constraint outreacher_workers_desktop_check check (desktop_capability in ('unverified', 'unsupported', 'reported')),
  constraint outreacher_workers_proxy_check check (proxy_mode in ('unset', 'os_shared', 'process_binding')),
  constraint outreacher_workers_interaction_check check (interaction = 'computer_use'),
  constraint outreacher_workers_shell_check check (shell_control = false),
  constraint outreacher_workers_ready_check check (
    status <> 'ready' or (desktop_capability = 'reported' and proxy_mode = 'process_binding')
  )
);

create table if not exists public.outreacher_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  worker_id uuid references public.outreacher_workers (id) on delete restrict,
  profile_key text not null,
  process_slot integer not null,
  proxy_id uuid references public.outreach_proxies (id) on delete restrict,
  ig_username text,
  session_state text not null default 'unknown',
  status text not null default 'unconfigured',
  controller_seen_at timestamptz,
  test_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreacher_profiles_key_check check (profile_key ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  constraint outreacher_profiles_slot_check check (process_slot between 1 and 3),
  constraint outreacher_profiles_session_check check (session_state in (
    'ok', 'expired', 'checkpoint', 'action_block', 'unknown'
  )),
  constraint outreacher_profiles_status_check check (status in (
    'unconfigured', 'needs_proxy', 'needs_login', 'offline', 'unsupported', 'ready', 'paused', 'revoked'
  )),
  constraint outreacher_profiles_username_check check (ig_username is null or ig_username ~ '^[a-z0-9._]{1,30}$'),
  constraint outreacher_profiles_ready_check check (
    status <> 'ready' or (proxy_id is not null and worker_id is not null)
  )
);

create unique index if not exists outreacher_profiles_one_business
  on public.outreacher_profiles (business_id)
  where status <> 'revoked';

create unique index if not exists outreacher_profiles_slot
  on public.outreacher_profiles (worker_id, process_slot)
  where worker_id is not null and status <> 'revoked';

create unique index if not exists outreacher_profiles_key
  on public.outreacher_profiles (worker_id, profile_key)
  where worker_id is not null and status <> 'revoked';

create unique index if not exists outreacher_profiles_proxy
  on public.outreacher_profiles (proxy_id)
  where proxy_id is not null and status <> 'revoked';

create table if not exists public.outreacher_worker_routes (
  worker_id uuid primary key references public.outreacher_workers (id) on delete cascade,
  transport text not null default 'controller_channel',
  enabled boolean not null default false,
  channel_url text,
  desktop_capability text not null default 'unverified',
  proxy_mode text not null default 'unset',
  updated_at timestamptz not null default now(),
  constraint outreacher_worker_routes_transport_check check (transport = 'controller_channel'),
  constraint outreacher_worker_routes_desktop_check check (desktop_capability in ('unverified', 'unsupported', 'reported')),
  constraint outreacher_worker_routes_proxy_check check (proxy_mode in ('unset', 'os_shared', 'process_binding')),
  constraint outreacher_worker_routes_url_check check (
    channel_url is null
    or channel_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9-]+)?/v1/channels/[a-z0-9_-]+/[a-z0-9_-]+$'
  )
);

create table if not exists private.outreacher_controller_secrets (
  worker_id uuid primary key references public.outreacher_workers (id) on delete cascade,
  alias_token text,
  signing_key text,
  updated_at timestamptz not null default now()
);

create table if not exists public.outreacher_controller_state (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  paused boolean not null default true,
  killed boolean not null default false,
  desired_version integer,
  observed_version integer,
  controller_status text not null default 'needs_setup',
  profile_id uuid references public.outreacher_profiles (id) on delete set null,
  last_error text not null default '',
  control_generation integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint outreacher_controller_status_check check (controller_status in (
    'needs_setup', 'unsupported', 'offline', 'queued', 'accepted', 'acknowledged',
    'observed', 'failed', 'expired'
  ))
);

create table if not exists public.outreacher_workflow_versions (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  version integer not null,
  document jsonb not null,
  document_sha256 text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, version),
  constraint outreacher_workflow_version_check check (version > 0),
  constraint outreacher_workflow_draft_check check ((document ->> 'draft_only') = 'true'),
  constraint outreacher_workflow_hours_check check ((document ->> 'active_hours') = '16'),
  constraint outreacher_workflow_poll_check check ((document ->> 'poll_interval_min') = '30')
);

create table if not exists public.outreacher_commands (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  profile_id uuid references public.outreacher_profiles (id) on delete set null,
  worker_id uuid references public.outreacher_workers (id) on delete set null,
  proxy_id uuid references public.outreach_proxies (id) on delete set null,
  operation text not null,
  workflow_version integer not null,
  payload jsonb not null default '{}'::jsonb,
  payload_sha256 text not null,
  idempotency_key text not null,
  status text not null default 'needs_setup',
  signature text,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  accepted_at timestamptz,
  acknowledged_at timestamptz,
  observed_at timestamptz,
  lease_worker_id uuid,
  lease_profile_id uuid,
  last_error text not null default '',
  test_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreacher_commands_operation_check check (operation in (
    'set_workflow', 'pause', 'resume', 'kill', 'reconcile'
  )),
  constraint outreacher_commands_status_check check (status in (
    'queued', 'needs_setup', 'unsupported', 'accepted', 'acknowledged', 'observed',
    'failed', 'expired', 'superseded', 'offline'
  )),
  constraint outreacher_commands_observed_path check (
    status <> 'observed' or (observed_at is not null and acknowledged_at is not null)
  ),
  unique (business_id, idempotency_key)
);

create index if not exists outreacher_commands_business_idx
  on public.outreacher_commands (business_id, created_at desc);

create table if not exists public.outreacher_results (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  result_key text not null,
  command_id uuid not null references public.outreacher_commands (id) on delete cascade,
  outcome text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, result_key),
  constraint outreacher_results_outcome_check check (outcome in ('observed', 'failed'))
);

create table if not exists public.outreacher_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  profile_id uuid,
  command_id uuid,
  kind text not null,
  handle text,
  source text,
  bio_facts jsonb not null default '[]'::jsonb,
  draft_text text,
  dedup_key text,
  test_only boolean not null default false,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint outreacher_activity_kind_check check (kind in (
    'prospect_seen', 'draft_prepared', 'duplicate_skipped', 'qualification',
    'command_queued', 'command_accepted', 'command_acknowledged', 'command_observed',
    'command_failed', 'command_expired', 'command_refused', 'misrouted'
  )),
  constraint outreacher_activity_source_check check (source is null or source in ('new_follower', 'post_liker')),
  constraint outreacher_activity_draft_facts_check check (
    kind <> 'draft_prepared' or (jsonb_typeof(bio_facts) = 'array' and jsonb_array_length(bio_facts) > 0)
  )
);

create unique index if not exists outreacher_activity_dedup
  on public.outreacher_activity (business_id, dedup_key)
  where dedup_key is not null and dedup_key <> '' and kind <> 'duplicate_skipped';

create index if not exists outreacher_activity_business_idx
  on public.outreacher_activity (business_id, created_at desc);

alter table public.outreacher_workers enable row level security;
alter table public.outreacher_profiles enable row level security;
alter table public.outreacher_worker_routes enable row level security;
alter table public.outreacher_controller_state enable row level security;
alter table public.outreacher_workflow_versions enable row level security;
alter table public.outreacher_commands enable row level security;
alter table public.outreacher_results enable row level security;
alter table public.outreacher_activity enable row level security;

revoke all on public.outreacher_workers from public, anon, authenticated;
revoke all on public.outreacher_profiles from public, anon, authenticated;
revoke all on public.outreacher_worker_routes from public, anon, authenticated;
revoke all on public.outreacher_controller_state from public, anon, authenticated;
revoke all on public.outreacher_workflow_versions from public, anon, authenticated;
revoke all on public.outreacher_commands from public, anon, authenticated;
revoke all on public.outreacher_results from public, anon, authenticated;
revoke all on public.outreacher_activity from public, anon, authenticated;
revoke all on private.outreacher_controller_secrets from public, anon, authenticated;

grant select, insert, update, delete on public.outreacher_workers to service_role;
grant select, insert, update, delete on public.outreacher_profiles to service_role;
grant select, insert, update, delete on public.outreacher_worker_routes to service_role;
grant select, insert, update, delete on public.outreacher_controller_state to service_role;
grant select, insert, update, delete on public.outreacher_workflow_versions to service_role;
grant select, insert, update, delete on public.outreacher_commands to service_role;
grant select, insert, update, delete on public.outreacher_results to service_role;
grant select, insert, update, delete on public.outreacher_activity to service_role;
grant select, insert, update, delete on private.outreacher_controller_secrets to service_role;

grant select (
  id, business_id, profile_key, process_slot, ig_username, session_state, status, controller_seen_at, updated_at
) on public.outreacher_profiles to authenticated;
grant select (
  business_id, paused, killed, desired_version, observed_version, controller_status, profile_id, last_error, updated_at
) on public.outreacher_controller_state to authenticated;
grant select (business_id, version, document, document_sha256, created_at)
  on public.outreacher_workflow_versions to authenticated;
grant select (
  id, business_id, profile_id, worker_id, operation, workflow_version, status,
  expires_at, accepted_at, acknowledged_at, observed_at, last_error, created_at
) on public.outreacher_commands to authenticated;
grant select (id, business_id, kind, handle, source, bio_facts, draft_text, created_at)
  on public.outreacher_activity to authenticated;

drop policy if exists outreacher_profiles_read on public.outreacher_profiles;
create policy outreacher_profiles_read on public.outreacher_profiles
  for select to authenticated using (public.acq_can_read(business_id) and test_only = false);
drop policy if exists outreacher_state_read on public.outreacher_controller_state;
create policy outreacher_state_read on public.outreacher_controller_state
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists outreacher_versions_read on public.outreacher_workflow_versions;
create policy outreacher_versions_read on public.outreacher_workflow_versions
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists outreacher_commands_read on public.outreacher_commands;
create policy outreacher_commands_read on public.outreacher_commands
  for select to authenticated using (public.acq_can_read(business_id) and test_only = false);
drop policy if exists outreacher_activity_read on public.outreacher_activity;
create policy outreacher_activity_read on public.outreacher_activity
  for select to authenticated using (public.acq_can_read(business_id) and test_only = false);

create or replace function public.outreacher_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
end;
$$;

create or replace function public.outreacher_workflow_reason(p_doc jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_count integer;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then return 'invalid'; end if;
  for v_key in select jsonb_object_keys(p_doc) loop
    if v_key not in (
      'timezone', 'active_start', 'active_hours', 'poll_interval_min', 'sources',
      'daily_prospect_min', 'daily_prospect_max', 'draft_only', 'personalize', 'templates'
    ) then
      return 'invalid';
    end if;
  end loop;
  if coalesce(p_doc ->> 'draft_only', '') <> 'true' then return 'draft_only'; end if;
  if p_doc ->> 'personalize' is distinct from 'bio_facts_only' then return 'personalize'; end if;
  if p_doc ->> 'active_hours' is distinct from '16' then return 'active_hours'; end if;
  if p_doc ->> 'poll_interval_min' is distinct from '30' then return 'poll'; end if;
  if coalesce(p_doc ->> 'active_start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return 'active_start'; end if;
  if coalesce(p_doc ->> 'timezone', '') !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2}$' then return 'timezone'; end if;
  if jsonb_typeof(p_doc -> 'sources') <> 'array' then return 'sources'; end if;
  v_count := jsonb_array_length(p_doc -> 'sources');
  if v_count < 1 or v_count > 2 then return 'sources'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_doc -> 'sources') as item(value)
    where item.value not in ('new_follower', 'post_liker')
  ) then return 'sources'; end if;
  if (select count(*) from (select distinct item.value from jsonb_array_elements_text(p_doc -> 'sources') as item(value)) distinct_sources) <> v_count then
    return 'sources';
  end if;
  if coalesce(p_doc ->> 'daily_prospect_min', '') !~ '^[0-9]+$' or coalesce(p_doc ->> 'daily_prospect_max', '') !~ '^[0-9]+$' then
    return 'daily';
  end if;
  if (p_doc ->> 'daily_prospect_min')::integer < 20
    or (p_doc ->> 'daily_prospect_max')::integer > 100
    or (p_doc ->> 'daily_prospect_min')::integer > (p_doc ->> 'daily_prospect_max')::integer then
    return 'daily';
  end if;
  if jsonb_typeof(p_doc -> 'templates') <> 'array' then return 'templates'; end if;
  v_count := jsonb_array_length(p_doc -> 'templates');
  if v_count < 1 or v_count > 8 then return 'templates'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_doc -> 'templates') as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or exists (select 1 from jsonb_object_keys(item.value) as object_key(value) where object_key.value not in ('id', 'text'))
      or coalesce(item.value ->> 'id', '') !~ '^[a-z0-9-]{1,40}$'
      or char_length(btrim(coalesce(item.value ->> 'text', ''))) < 1
      or char_length(btrim(coalesce(item.value ->> 'text', ''))) > 280
  ) then return 'templates'; end if;
  if (select count(*) from (select distinct item.value ->> 'id' from jsonb_array_elements(p_doc -> 'templates') as item(value)) distinct_ids) <> v_count then
    return 'templates';
  end if;
  return '';
end;
$$;

create or replace function public.outreacher_workflow_canonical(p_doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'roleflow-workflow.v1' || E'\n'
    || coalesce(p_doc ->> 'timezone', '') || E'\n'
    || coalesce(p_doc ->> 'active_start', '') || E'\n'
    || coalesce(p_doc ->> 'active_hours', '') || E'\n'
    || coalesce(p_doc ->> 'poll_interval_min', '') || E'\n'
    || coalesce((select string_agg(item.value, ',' order by item.value) from jsonb_array_elements_text(p_doc -> 'sources') as item(value)), '') || E'\n'
    || coalesce(p_doc ->> 'daily_prospect_min', '') || E'\n'
    || coalesce(p_doc ->> 'daily_prospect_max', '') || E'\n'
    || 'true' || E'\n'
    || coalesce(p_doc ->> 'personalize', '') || E'\n'
    || coalesce((
      select string_agg((item.value ->> 'id') || '=' || btrim(item.value ->> 'text'), E'\n' order by item.value ->> 'id')
      from jsonb_array_elements(p_doc -> 'templates') as item(value)
    ), '');
$$;

revoke all on function public.outreacher_uuid(text) from public, anon, authenticated;
revoke all on function public.outreacher_workflow_reason(jsonb) from public, anon, authenticated;
revoke all on function public.outreacher_workflow_canonical(jsonb) from public, anon, authenticated;
grant execute on function public.outreacher_uuid(text) to service_role;
grant execute on function public.outreacher_workflow_reason(jsonb) to service_role;
grant execute on function public.outreacher_workflow_canonical(jsonb) to service_role;

create or replace function public.outreacher_save_workflow(p_business uuid, p_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_canonical text;
  v_hash text;
  v_key text;
  v_version integer;
  v_existing public.outreacher_commands%rowtype;
  v_profile public.outreacher_profiles%rowtype;
  v_worker public.outreacher_workers%rowtype;
  v_route public.outreacher_worker_routes%rowtype;
  v_secret text;
  v_status text;
  v_error text;
  v_command uuid;
  v_expires timestamptz;
  v_signature text;
  v_command_canonical text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and public.acq_can_edit(p_business) is not true then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_business is null or not exists (select 1 from public.acq_workspaces where id = p_business) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  v_reason := public.outreacher_workflow_reason(p_document);
  if v_reason <> '' then return jsonb_build_object('ok', false, 'reason', v_reason); end if;
  v_canonical := public.outreacher_workflow_canonical(p_document);
  v_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_key := 'set_workflow:' || p_business::text || ':' || v_hash;
  select * into v_existing from public.outreacher_commands
    where business_id = p_business and idempotency_key = v_key;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'reason', 'duplicate', 'command_id', v_existing.id, 'status', v_existing.status, 'version', v_existing.workflow_version);
  end if;
  insert into public.outreacher_controller_state (business_id)
  values (p_business)
  on conflict (business_id) do nothing;
  select coalesce(max(version), 0) + 1 into v_version
    from public.outreacher_workflow_versions where business_id = p_business;
  insert into public.outreacher_workflow_versions (business_id, version, document, document_sha256)
  values (p_business, v_version, p_document, v_hash);
  select * into v_profile from public.outreacher_profiles
    where business_id = p_business and status <> 'revoked' limit 1;
  if v_profile.worker_id is not null then
    select * into v_worker from public.outreacher_workers where id = v_profile.worker_id;
    select * into v_route from public.outreacher_worker_routes where worker_id = v_profile.worker_id;
    select signing_key into v_secret from private.outreacher_controller_secrets where worker_id = v_profile.worker_id;
  end if;
  if exists (select 1 from public.outreacher_controller_state where business_id = p_business and killed) then
    v_status := 'failed'; v_error := 'killed';
  elsif v_profile.id is null or v_profile.worker_id is null or v_profile.profile_key is null then
    v_status := 'needs_setup'; v_error := 'needs_setup';
  elsif v_profile.proxy_id is null then
    v_status := 'needs_setup'; v_error := 'needs_proxy';
  elsif v_worker.desktop_capability is distinct from 'reported' or v_worker.proxy_mode is distinct from 'process_binding'
    or v_worker.shell_control or v_worker.interaction is distinct from 'computer_use' or v_worker.status = 'unsupported' then
    v_status := 'unsupported'; v_error := 'unsupported';
  elsif v_worker.status in ('offline', 'unconfigured') then
    v_status := 'offline'; v_error := 'offline';
  elsif v_route.enabled is not true or v_secret is null or v_route.channel_url is null then
    v_status := 'needs_setup'; v_error := 'needs_setup';
  else
    v_status := 'queued'; v_error := '';
  end if;
  v_expires := now() + interval '30 minutes';
  v_command := extensions.gen_random_uuid();
  if v_status = 'queued' then
    v_command_canonical := 'roleflow-controller.v1' || E'\n'
      || p_business::text || E'\n'
      || coalesce(v_profile.id::text, '-') || E'\n'
      || coalesce(v_profile.worker_id::text, '-') || E'\n'
      || coalesce(v_profile.proxy_id::text, '-') || E'\n'
      || 'set_workflow' || E'\n'
      || v_version::text || E'\n'
      || v_key || E'\n'
      || to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || E'\n'
      || v_hash;
    begin
      v_signature := encode(extensions.hmac(v_command_canonical, v_secret, 'sha256'), 'hex');
    exception when others then
      v_signature := null;
    end;
    if v_signature is null then
      v_status := 'needs_setup';
      v_error := 'unsigned';
    end if;
  end if;
  update public.outreacher_commands
    set status = 'superseded', updated_at = now()
    where business_id = p_business and status in ('queued', 'needs_setup', 'unsupported', 'offline');
  insert into public.outreacher_commands (
    id, business_id, profile_id, worker_id, proxy_id, operation, workflow_version, payload,
    payload_sha256, idempotency_key, status, signature, expires_at, last_error, test_only
  ) values (
    v_command, p_business, v_profile.id, v_profile.worker_id, v_profile.proxy_id, 'set_workflow', v_version, p_document,
    v_hash, v_key, v_status, v_signature, v_expires, coalesce(v_error, ''), false
  );
  update public.outreacher_controller_state
    set desired_version = v_version,
        controller_status = v_status,
        profile_id = v_profile.id,
        last_error = coalesce(v_error, ''),
        updated_at = now()
    where business_id = p_business;
  insert into public.outreacher_activity (business_id, profile_id, command_id, kind, test_only)
  values (p_business, v_profile.id, v_command, 'command_queued', false);
  return jsonb_build_object('ok', true, 'reason', coalesce(v_error, ''), 'command_id', v_command, 'status', v_status, 'version', v_version, 'observed', false);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_set_controller(p_business uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.outreacher_controller_state%rowtype;
begin
  if p_action not in ('pause', 'resume', 'kill') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and public.acq_can_edit(p_business) is not true then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  insert into public.outreacher_controller_state (business_id)
  values (p_business)
  on conflict (business_id) do nothing;
  select * into v_state from public.outreacher_controller_state where business_id = p_business for update;
  if p_action = 'resume' and v_state.killed then
    return jsonb_build_object('ok', false, 'reason', 'killed');
  end if;
  if p_action = 'pause' and v_state.paused and v_state.killed = false then
    return jsonb_build_object('ok', true, 'reason', 'duplicate', 'observed', false, 'paused', true, 'killed', false);
  end if;
  if p_action = 'kill' and v_state.killed then
    return jsonb_build_object('ok', true, 'reason', 'duplicate', 'observed', false, 'paused', true, 'killed', true);
  end if;
  if p_action = 'pause' then
    update public.outreacher_controller_state set paused = true, updated_at = now() where business_id = p_business;
  elsif p_action = 'resume' then
    update public.outreacher_controller_state set paused = false, updated_at = now() where business_id = p_business;
  else
    update public.outreacher_controller_state set paused = true, killed = true, updated_at = now() where business_id = p_business;
  end if;
  update public.outreacher_controller_state
    set control_generation = control_generation + 1, updated_at = now()
    where business_id = p_business;
  select * into v_state from public.outreacher_controller_state where business_id = p_business;
  insert into public.outreacher_commands (
    business_id, operation, workflow_version, payload, payload_sha256, idempotency_key, status, expires_at, last_error, test_only
  ) values (
    p_business, p_action, coalesce(v_state.desired_version, 0), jsonb_build_object('action', p_action),
    encode(extensions.digest(p_action, 'sha256'), 'hex'),
    p_action || ':' || p_business::text || ':' || v_state.control_generation::text,
    case when v_state.killed and p_action <> 'kill' then 'failed' else 'needs_setup' end,
    now() + interval '30 minutes',
    case when v_state.killed and p_action <> 'kill' then 'killed' else 'needs_setup' end,
    false
  );
  return jsonb_build_object('ok', true, 'reason', 'needs_setup', 'observed', false, 'paused', v_state.paused, 'killed', v_state.killed);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

revoke all on function public.outreacher_save_workflow(uuid, jsonb) from public, anon;
revoke all on function public.outreacher_set_controller(uuid, text) from public, anon;
grant execute on function public.outreacher_save_workflow(uuid, jsonb) to authenticated, service_role;
grant execute on function public.outreacher_set_controller(uuid, text) to authenticated, service_role;

create or replace function public.outreacher_clear_kill(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  update public.outreacher_controller_state
    set killed = false, paused = true, updated_at = now()
    where business_id = p_business;
  return jsonb_build_object('ok', true, 'reason', '', 'paused', true, 'killed', false);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_bind_profile(
  p_business uuid,
  p_worker uuid,
  p_profile_key text,
  p_process_slot integer,
  p_proxy uuid,
  p_ig_username text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker public.outreacher_workers%rowtype;
  v_count integer;
  v_handle text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_worker from public.outreacher_workers where id = p_worker for update;
  if v_worker.id is null then return jsonb_build_object('ok', false, 'reason', 'needs_setup'); end if;
  if v_worker.capacity not in (2, 3) then return jsonb_build_object('ok', false, 'reason', 'capacity'); end if;
  if v_worker.shell_control or v_worker.interaction is distinct from 'computer_use' then
    return jsonb_build_object('ok', false, 'reason', 'shell_forbidden');
  end if;
  if v_worker.desktop_capability is distinct from 'reported' or v_worker.proxy_mode is distinct from 'process_binding' then
    return jsonb_build_object('ok', false, 'reason', 'unsupported');
  end if;
  if p_profile_key is null or p_profile_key !~ '^[a-z0-9][a-z0-9-]{0,40}$' then
    return jsonb_build_object('ok', false, 'reason', 'profile_required');
  end if;
  if p_proxy is null then return jsonb_build_object('ok', false, 'reason', 'needs_proxy'); end if;
  if not exists (select 1 from public.outreach_proxies where id = p_proxy) then
    return jsonb_build_object('ok', false, 'reason', 'needs_proxy');
  end if;
  if p_process_slot is null or p_process_slot < 1 or p_process_slot > v_worker.capacity then
    return jsonb_build_object('ok', false, 'reason', 'slot');
  end if;
  if exists (select 1 from public.client_machines where business_id = p_business and status <> 'deleted') then
    return jsonb_build_object('ok', false, 'reason', 'machine_exists');
  end if;
  if exists (select 1 from public.client_machines where proxy_id = p_proxy and status <> 'deleted') then
    return jsonb_build_object('ok', false, 'reason', 'proxy_in_use');
  end if;
  select count(*) into v_count from public.outreacher_profiles
    where worker_id = p_worker and status <> 'revoked';
  if v_count >= v_worker.capacity then return jsonb_build_object('ok', false, 'reason', 'capacity'); end if;
  if exists (select 1 from public.outreacher_profiles where business_id = p_business and status <> 'revoked') then
    return jsonb_build_object('ok', false, 'reason', 'profile_exists');
  end if;
  if exists (select 1 from public.outreacher_profiles where proxy_id = p_proxy and status <> 'revoked') then
    return jsonb_build_object('ok', false, 'reason', 'proxy_in_use');
  end if;
  if exists (
    select 1 from public.outreacher_profiles
    where worker_id = p_worker and status <> 'revoked'
      and (process_slot = p_process_slot or profile_key = p_profile_key)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slot');
  end if;
  v_handle := nullif(lower(regexp_replace(coalesce(p_ig_username, ''), '^@+', '')), '');
  if v_handle is not null and v_handle !~ '^[a-z0-9._]{1,30}$' then v_handle := null; end if;
  insert into public.outreacher_profiles (
    business_id, worker_id, profile_key, process_slot, proxy_id, ig_username, session_state, status
  ) values (
    p_business, p_worker, p_profile_key, p_process_slot, p_proxy, v_handle, 'unknown', 'needs_login'
  );
  return jsonb_build_object('ok', true, 'reason', '', 'status', 'needs_login');
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function private.outreacher_route_command(p_worker uuid, p_profile uuid, p_command uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.outreacher_profiles%rowtype;
  v_command public.outreacher_commands%rowtype;
  v_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_command from public.outreacher_commands where id = p_command;
  if v_command.id is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into v_profile from public.outreacher_profiles where id = p_profile;
  if v_profile.id is null or v_profile.worker_id is distinct from p_worker then
    v_reason := 'misrouted';
  elsif v_profile.business_id is distinct from v_command.business_id then
    v_reason := 'wrong_account';
  elsif v_command.profile_id is distinct from v_profile.id
    or v_command.worker_id is distinct from v_profile.worker_id
    or v_command.proxy_id is null
    or v_command.proxy_id is distinct from v_profile.proxy_id then
    v_reason := 'misrouted';
  else
    return jsonb_build_object('ok', true, 'business_id', v_command.business_id);
  end if;
  insert into public.outreacher_activity (business_id, profile_id, command_id, kind, detail, test_only)
  values (v_command.business_id, p_profile, v_command.id, 'misrouted', jsonb_build_object('reason', v_reason), v_command.test_only);
  return jsonb_build_object('ok', false, 'reason', v_reason);
end;
$$;

create or replace function public.outreacher_pickup(p_worker text, p_profile text, p_command text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker uuid;
  v_profile uuid;
  v_command uuid;
  v_row public.outreacher_commands%rowtype;
  v_state public.outreacher_controller_state%rowtype;
  v_route jsonb;
  v_secret text;
  v_canonical text;
  v_expected text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  v_worker := public.outreacher_uuid(p_worker);
  v_profile := public.outreacher_uuid(p_profile);
  v_command := public.outreacher_uuid(p_command);
  if v_command is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_route := private.outreacher_route_command(v_worker, v_profile, v_command);
  if coalesce(v_route ->> 'ok', 'false') <> 'true' then return v_route; end if;
  select * into v_row from public.outreacher_commands where id = v_command for update;
  if v_row.expires_at <= now() and v_row.status <> 'observed' then
    update public.outreacher_commands set status = 'expired', updated_at = now() where id = v_command;
    update public.outreacher_controller_state set controller_status = 'expired', updated_at = now()
      where business_id = v_row.business_id and v_row.test_only = false;
    insert into public.outreacher_activity (business_id, command_id, kind, test_only)
    values (v_row.business_id, v_command, 'command_expired', v_row.test_only);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select * into v_state from public.outreacher_controller_state where business_id = v_row.business_id;
  if v_state.killed and v_row.operation <> 'kill' then
    return jsonb_build_object('ok', false, 'reason', 'killed');
  end if;
  if v_state.paused and v_row.operation = 'set_workflow' then
    return jsonb_build_object('ok', false, 'reason', 'paused');
  end if;
  if v_row.status in ('needs_setup', 'unsupported', 'offline', 'failed', 'superseded', 'expired') then
    return jsonb_build_object('ok', false, 'reason', case when v_row.last_error <> '' then v_row.last_error else v_row.status end);
  end if;
  if v_row.status = 'observed' then
    return jsonb_build_object('ok', true, 'reason', 'duplicate', 'status', v_row.status, 'observed', v_row.test_only = false);
  end if;
  select signing_key into v_secret from private.outreacher_controller_secrets where worker_id = v_worker;
  v_canonical := 'roleflow-controller.v1' || E'\n'
    || v_row.business_id::text || E'\n'
    || coalesce(v_row.profile_id::text, '-') || E'\n'
    || coalesce(v_row.worker_id::text, '-') || E'\n'
    || coalesce(v_row.proxy_id::text, '-') || E'\n'
    || v_row.operation || E'\n'
    || v_row.workflow_version::text || E'\n'
    || v_row.idempotency_key || E'\n'
    || to_char(v_row.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || E'\n'
    || v_row.payload_sha256;
  begin
    v_expected := encode(extensions.hmac(v_canonical, coalesce(v_secret, ''), 'sha256'), 'hex');
  exception when others then
    v_expected := '';
  end;
  if v_row.signature is null or v_secret is null or v_expected is distinct from v_row.signature then
    return jsonb_build_object('ok', false, 'reason', case when v_row.signature is null then 'unsigned' else 'unauthorized' end);
  end if;
  update public.outreacher_commands
    set lease_worker_id = v_worker, lease_profile_id = v_profile, updated_at = now()
    where id = v_command;
  update public.outreacher_profiles set controller_seen_at = now(), updated_at = now() where id = v_profile;
  return jsonb_build_object('ok', true, 'reason', '', 'status', v_row.status, 'observed', false, 'operation', v_row.operation, 'version', v_row.workflow_version);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_ack(p_worker text, p_profile text, p_command text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker uuid;
  v_profile uuid;
  v_command uuid;
  v_row public.outreacher_commands%rowtype;
  v_route jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  v_worker := public.outreacher_uuid(p_worker);
  v_profile := public.outreacher_uuid(p_profile);
  v_command := public.outreacher_uuid(p_command);
  if v_command is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_route := private.outreacher_route_command(v_worker, v_profile, v_command);
  if coalesce(v_route ->> 'ok', 'false') <> 'true' then return v_route; end if;
  select * into v_row from public.outreacher_commands where id = v_command for update;
  if v_row.expires_at <= now() and v_row.status <> 'observed' then
    update public.outreacher_commands set status = 'expired', updated_at = now() where id = v_command;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_row.lease_profile_id is not null and v_row.lease_profile_id is distinct from v_profile then
    return jsonb_build_object('ok', false, 'reason', 'misrouted');
  end if;
  if v_row.status in ('acknowledged', 'observed') then
    return jsonb_build_object('ok', true, 'reason', 'duplicate', 'status', v_row.status, 'observed', false);
  end if;
  if v_row.status not in ('queued', 'accepted') then
    return jsonb_build_object('ok', false, 'reason', 'not_acknowledged');
  end if;
  update public.outreacher_commands
    set status = 'acknowledged', acknowledged_at = now(), updated_at = now()
    where id = v_command;
  if v_row.test_only = false then
    update public.outreacher_controller_state set controller_status = 'acknowledged', updated_at = now()
      where business_id = v_row.business_id;
  end if;
  insert into public.outreacher_activity (business_id, command_id, kind, test_only)
  values (v_row.business_id, v_command, 'command_acknowledged', v_row.test_only);
  return jsonb_build_object('ok', true, 'reason', '', 'status', 'acknowledged', 'observed', false);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_record_result(
  p_worker text,
  p_profile text,
  p_command text,
  p_outcome text,
  p_result_key text,
  p_activity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker uuid;
  v_profile uuid;
  v_command uuid;
  v_row public.outreacher_commands%rowtype;
  v_route jsonb;
  v_prior text;
  v_item jsonb;
  v_kind text;
  v_handle text;
  v_source text;
  v_facts jsonb;
  v_dedup text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_outcome in ('sent', 'live') then
    return jsonb_build_object('ok', false, 'reason', 'send_forbidden');
  end if;
  if p_outcome not in ('observed', 'failed') or coalesce(p_result_key, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if jsonb_typeof(coalesce(p_activity, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_activity, '[]'::jsonb)) > 20 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_activity, '[]'::jsonb)) loop
    v_kind := coalesce(v_item ->> 'kind', '');
    if v_kind in ('sent', 'message_sent') then
      return jsonb_build_object('ok', false, 'reason', 'send_forbidden');
    end if;
    v_facts := coalesce(v_item -> 'bio_facts', '[]'::jsonb);
    if v_kind in ('draft_prepared', 'qualification') and (jsonb_typeof(v_facts) <> 'array' or jsonb_array_length(v_facts) < 1) then
      return jsonb_build_object('ok', false, 'reason', 'bio_facts_required');
    end if;
    if coalesce(v_item ->> 'draft_text', '') <> '' and (jsonb_typeof(v_facts) <> 'array' or jsonb_array_length(v_facts) < 1) then
      return jsonb_build_object('ok', false, 'reason', 'bio_facts_required');
    end if;
  end loop;
  v_worker := public.outreacher_uuid(p_worker);
  v_profile := public.outreacher_uuid(p_profile);
  v_command := public.outreacher_uuid(p_command);
  if v_command is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_route := private.outreacher_route_command(v_worker, v_profile, v_command);
  if coalesce(v_route ->> 'ok', 'false') <> 'true' then return v_route; end if;
  select * into v_row from public.outreacher_commands where id = v_command for update;
  select outcome into v_prior from public.outreacher_results
    where business_id = v_row.business_id and result_key = p_result_key;
  if v_prior is not null then
    return jsonb_build_object('ok', true, 'reason', 'duplicate', 'outcome', v_prior, 'observed', false);
  end if;
  if v_row.expires_at <= now() and v_row.status <> 'observed' then
    update public.outreacher_commands set status = 'expired', updated_at = now() where id = v_command;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_row.status not in ('acknowledged', 'observed') then
    return jsonb_build_object('ok', false, 'reason', 'not_acknowledged');
  end if;
  insert into public.outreacher_results (business_id, result_key, command_id, outcome)
  values (v_row.business_id, p_result_key, v_command, p_outcome);
  if p_outcome = 'observed' then
    update public.outreacher_commands
      set status = 'observed', observed_at = now(), updated_at = now()
      where id = v_command;
    if v_row.test_only = false then
      update public.outreacher_controller_state
        set observed_version = v_row.workflow_version, controller_status = 'observed', last_error = '', updated_at = now()
        where business_id = v_row.business_id;
    end if;
    insert into public.outreacher_activity (business_id, command_id, kind, test_only)
    values (v_row.business_id, v_command, 'command_observed', v_row.test_only);
  else
    update public.outreacher_commands
      set status = 'failed', last_error = 'failed', updated_at = now()
      where id = v_command;
    if v_row.test_only = false then
      update public.outreacher_controller_state
        set controller_status = 'failed', last_error = 'failed', updated_at = now()
        where business_id = v_row.business_id;
    end if;
    insert into public.outreacher_activity (business_id, command_id, kind, test_only)
    values (v_row.business_id, v_command, 'command_failed', v_row.test_only);
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_activity, '[]'::jsonb)) loop
    v_kind := coalesce(v_item ->> 'kind', '');
    if v_kind not in ('prospect_seen', 'draft_prepared', 'duplicate_skipped', 'qualification') then continue; end if;
    v_handle := nullif(lower(regexp_replace(coalesce(v_item ->> 'handle', ''), '^@+', '')), '');
    if v_handle is null or v_handle !~ '^[a-z0-9._]{1,30}$' then continue; end if;
    v_source := case when v_item ->> 'source' in ('new_follower', 'post_liker') then v_item ->> 'source' else '' end;
    if v_source = '' then continue; end if;
    v_facts := coalesce(v_item -> 'bio_facts', '[]'::jsonb);
    v_dedup := coalesce(nullif(v_item ->> 'dedup_key', ''), v_source || ':' || v_handle);
    if exists (
      select 1 from public.outreacher_activity
      where business_id = v_row.business_id and dedup_key = v_dedup and kind <> 'duplicate_skipped'
    ) or coalesce(v_item ->> 'prior_contact', '') = 'true' then
      insert into public.outreacher_activity (business_id, command_id, kind, handle, source, test_only)
      values (v_row.business_id, v_command, 'duplicate_skipped', v_handle, v_source, v_row.test_only);
    else
      insert into public.outreacher_activity (
        business_id, command_id, kind, handle, source, bio_facts, draft_text, dedup_key, test_only
      ) values (
        v_row.business_id, v_command, v_kind, v_handle, v_source, v_facts,
        case when jsonb_array_length(v_facts) > 0 then left(coalesce(v_item ->> 'draft_text', ''), 500) else '' end,
        v_dedup, v_row.test_only or coalesce(v_item ->> 'test_only', '') = 'true'
      );
    end if;
  end loop;
  return jsonb_build_object(
    'ok', true,
    'reason', '',
    'status', case when p_outcome = 'observed' then 'observed' else 'failed' end,
    'observed', p_outcome = 'observed' and v_row.test_only = false
  );
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

revoke all on function public.outreacher_clear_kill(uuid) from public, anon, authenticated;
revoke all on function public.outreacher_bind_profile(uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;
revoke all on function private.outreacher_route_command(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.outreacher_pickup(text, text, text) from public, anon, authenticated;
revoke all on function public.outreacher_ack(text, text, text) from public, anon, authenticated;
revoke all on function public.outreacher_record_result(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.outreacher_clear_kill(uuid) to service_role;
grant execute on function public.outreacher_bind_profile(uuid, uuid, text, integer, uuid, text) to service_role;
grant execute on function private.outreacher_route_command(uuid, uuid, uuid) to service_role;
grant execute on function public.outreacher_pickup(text, text, text) to service_role;
grant execute on function public.outreacher_ack(text, text, text) to service_role;
grant execute on function public.outreacher_record_result(text, text, text, text, text, jsonb) to service_role;
