-- Outreacher machines. NOT APPLIED to production by this change.
-- Apply only after review. This file is ordered after 20261030090000_followups_ladder.sql.
-- On 3 Nov 2026 the hosted project already had client_dashboard_agents,
-- business_model_keys and prompt_versions_and_comment_voice. Do not re-apply those.
--
-- One live machine per business. Clients can read their own row. Writes are service role.
-- No outreacher Postgres role and no imported JWT signing key: machines call edge functions,
-- and those functions check claims against this table.

create table if not exists private.stripe_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

revoke all on private.stripe_events from public, anon, authenticated;

create table if not exists public.outreacher_global (
  id integer primary key default 1,
  killed boolean not null default false,
  reason text not null default '',
  updated_at timestamptz not null default now(),
  constraint outreacher_global_one check (id = 1)
);

insert into public.outreacher_global (id, killed) values (1, false)
on conflict (id) do nothing;

alter table public.outreacher_global enable row level security;
revoke all on public.outreacher_global from public, anon, authenticated;

create table if not exists public.acq_outreacher_config (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  paused boolean not null default true,
  hourly_cap integer,
  ig_username text,
  exclude_keywords text not null default '',
  countries text[] not null default '{}',
  languages text[] not null default '{}',
  delay_min_s integer not null default 300,
  delay_max_s integer not null default 1800,
  dry_run boolean not null default true,
  triggers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint acq_outreacher_hourly_check check (hourly_cap is null or hourly_cap between 1 and 30),
  constraint acq_outreacher_delay_check check (delay_min_s >= 0 and delay_max_s >= delay_min_s),
  constraint acq_outreacher_username_check check (ig_username is null or ig_username ~ '^[a-z0-9._]{1,30}$')
);

alter table public.acq_outreacher_config enable row level security;
revoke all on public.acq_outreacher_config from public, anon;
grant select, insert, update on public.acq_outreacher_config to authenticated;
grant select, insert, update, delete on public.acq_outreacher_config to service_role;

drop policy if exists acq_outreacher_config_read on public.acq_outreacher_config;
create policy acq_outreacher_config_read on public.acq_outreacher_config
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_outreacher_config_write on public.acq_outreacher_config;
create policy acq_outreacher_config_write on public.acq_outreacher_config
  for insert to authenticated with check (public.acq_can_edit(business_id));
drop policy if exists acq_outreacher_config_update on public.acq_outreacher_config;
create policy acq_outreacher_config_update on public.acq_outreacher_config
  for update to authenticated using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

create table if not exists public.client_machines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_event_id text unique,
  provider text not null default 'hetzner',
  provider_server_id text,
  server_type text,
  arch text,
  ipv4 text,
  volume_id text,
  volume_location text,
  volume_keep boolean not null default false,
  region text,
  firewall_id text,
  image_version text,
  agent_version text,
  health text,
  status text not null default 'pending',
  attempts integer not null default 0,
  offer_index integer not null default 0,
  boot_generation integer not null default 0,
  last_error text,
  last_heartbeat_at timestamptz,
  server_running_at timestamptz,
  health_alerted boolean not null default false,
  session_state text not null default 'unknown',
  grace_delete_at timestamptz,
  volume_retain_until timestamptz,
  backup_retain_until timestamptz,
  sending_mode text not null default 'off',
  sends_today integer not null default 0,
  sends_per_hour integer not null default 0,
  error_rate numeric not null default 0,
  last_send_at timestamptz,
  uptime_s integer not null default 0,
  last_egress_ip text,
  bootstrap_token_hash text,
  bootstrap_expires_at timestamptz,
  bootstrap_used_at timestamptz,
  refresh_token_hash text,
  refresh_prev_hash text,
  refresh_family_id uuid,
  worker_id uuid references public.acq_workers (id) on delete set null,
  ig_username text,
  revoked_at timestamptz,
  subscription_status text not null default 'inactive',
  proxy_id uuid,
  proxy_label text,
  proxy_country text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_machines_status_check check (status in (
    'pending', 'provisioning', 'awaiting_login', 'running', 'paused',
    'stopping', 'suspended', 'deleting', 'deleted', 'error', 'revoked'
  )),
  constraint client_machines_session_check check (session_state in (
    'ok', 'expired', 'checkpoint', 'action_block', 'unknown'
  )),
  constraint client_machines_health_check check (health is null or health in ('ok', 'error')),
  constraint client_machines_sending_check check (sending_mode in ('off', 'dry_run', 'live')),
  constraint client_machines_provider_check check (provider in ('hetzner', 'digitalocean')),
  constraint client_machines_arch_check check (arch is null or arch in ('amd64', 'arm64')),
  constraint client_machines_subscription_check check (subscription_status in (
    'inactive', 'active', 'trialing', 'past_due', 'canceled'
  ))
);

create unique index if not exists client_machines_one_live
  on public.client_machines (business_id)
  where status <> 'deleted';

create unique index if not exists client_machines_provider_server
  on public.client_machines (provider, provider_server_id)
  where provider_server_id is not null and status <> 'deleted';

create unique index if not exists client_machines_refresh_hash
  on public.client_machines (refresh_token_hash)
  where refresh_token_hash is not null;

create unique index if not exists client_machines_proxy_live
  on public.client_machines (proxy_id)
  where proxy_id is not null and status <> 'deleted';

create table if not exists public.outreach_proxies (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  country text not null,
  host text not null,
  port integer not null,
  assigned_machine_id uuid,
  reserved_business_id uuid,
  released_at timestamptz,
  quarantine_until timestamptz,
  created_at timestamptz not null default now(),
  constraint outreach_proxies_port_check check (port between 1 and 65535),
  constraint outreach_proxies_country_check check (country ~ '^[a-z]{2}$')
);

create unique index if not exists outreach_proxies_assigned
  on public.outreach_proxies (assigned_machine_id)
  where assigned_machine_id is not null;

alter table public.client_machines
  drop constraint if exists client_machines_proxy_fkey;
alter table public.client_machines
  add constraint client_machines_proxy_fkey
  foreign key (proxy_id) references public.outreach_proxies (id) on delete set null;

create table if not exists public.client_machine_events (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid references public.client_machines (id) on delete cascade,
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  kind text not null,
  severity text not null default 'info',
  from_state text,
  to_state text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_machine_events_business_idx
  on public.client_machine_events (business_id, created_at desc);

create table if not exists public.outreach_send_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  machine_id uuid references public.client_machines (id) on delete set null,
  handle text not null,
  action_kind text not null,
  status text not null default 'claimed',
  claim_expires_at timestamptz not null,
  result text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint outreach_send_kind_check check (action_kind in ('dm', 'like', 'follow', 'view')),
  constraint outreach_send_status_check check (status in ('claimed', 'reported', 'expired', 'refused'))
);

create index if not exists outreach_send_ledger_business_idx
  on public.outreach_send_ledger (business_id, created_at desc);

create table if not exists public.outreacher_backups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  machine_id uuid references public.client_machines (id) on delete set null,
  path text not null,
  created_at timestamptz not null default now()
);

create table if not exists private.outreach_bootstrap (
  machine_id uuid primary key references public.client_machines (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  server_id text,
  ipv4 text
);

create table if not exists private.outreach_refresh (
  machine_id uuid primary key references public.client_machines (id) on delete cascade,
  token_hash text,
  previous_hash text,
  family_id uuid not null default gen_random_uuid(),
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz
);

create table if not exists private.outreach_proxy_secrets (
  proxy_id uuid primary key references public.outreach_proxies (id) on delete cascade,
  username_enc bytea,
  password_enc bytea
);

create table if not exists private.outreach_machine_secrets (
  machine_id uuid primary key references public.client_machines (id) on delete cascade,
  proxy_url text,
  backup_key text,
  volume_key text,
  updated_at timestamptz not null default now()
);

create table if not exists private.outreach_live_tickets (
  jti text primary key,
  machine_id uuid not null references public.client_machines (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

revoke all on private.outreach_bootstrap from public, anon, authenticated;
revoke all on private.outreach_refresh from public, anon, authenticated;
revoke all on private.outreach_proxy_secrets from public, anon, authenticated;
revoke all on private.outreach_machine_secrets from public, anon, authenticated;
grant select, insert, update, delete on private.outreach_machine_secrets to service_role;

-- The private schema stays off the Data API. The image reads these three
-- values with rpc('outreacher_machine_secrets'). Columns stay plaintext for
-- the pilot. Encrypting them at rest is a follow-up before anyone sells this.
create or replace function public.outreacher_machine_secrets(p_machine_id uuid)
returns table (proxy_url text, backup_key text, volume_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.proxy_url, s.backup_key, s.volume_key
    from private.outreach_machine_secrets as s
    where s.machine_id = p_machine_id;
end;
$$;
revoke all on private.outreach_live_tickets from public, anon, authenticated;

alter table public.client_machines enable row level security;
alter table public.client_machine_events enable row level security;
alter table public.outreach_send_ledger enable row level security;
alter table public.outreach_proxies enable row level security;
alter table public.outreacher_backups enable row level security;

revoke all on public.client_machines from public, anon, authenticated;
revoke all on public.client_machine_events from public, anon, authenticated;
revoke all on public.outreach_send_ledger from public, anon, authenticated;
revoke all on public.outreach_proxies from public, anon, authenticated;
revoke all on public.outreacher_backups from public, anon, authenticated;

grant select (
  id, business_id, status, session_state, sending_mode, sends_today, last_send_at,
  last_heartbeat_at, ig_username, subscription_status, grace_delete_at,
  volume_retain_until, created_at, updated_at
) on public.client_machines to authenticated;

grant select, insert, update, delete on public.client_machines to service_role;
grant select, insert, update, delete on public.client_machine_events to service_role;
grant select, insert, update, delete on public.outreach_send_ledger to service_role;
grant select, insert, update, delete on public.outreach_proxies to service_role;
grant select, insert, update, delete on public.outreacher_backups to service_role;
grant select on public.client_machine_events to authenticated;
grant select on public.outreach_send_ledger to authenticated;

drop policy if exists client_machines_read on public.client_machines;
create policy client_machines_read on public.client_machines
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists client_machine_events_read on public.client_machine_events;
create policy client_machine_events_read on public.client_machine_events
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists outreach_send_ledger_read on public.outreach_send_ledger;
create policy outreach_send_ledger_read on public.outreach_send_ledger
  for select to authenticated using (public.acq_can_read(business_id));

insert into storage.buckets (id, name, public)
values ('outreacher-profiles', 'outreacher-profiles', false)
on conflict (id) do update set public = false;

-- Restrictive so the browser roles cannot read this bucket, and other buckets stay unchanged.
drop policy if exists outreacher_profiles_no_browser on storage.objects;
create policy outreacher_profiles_no_browser on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id is distinct from 'outreacher-profiles')
  with check (bucket_id is distinct from 'outreacher-profiles');

create or replace function public.outreacher_touch_machine()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists client_machines_touch on public.client_machines;
create trigger client_machines_touch before update on public.client_machines
  for each row execute function public.outreacher_touch_machine();

create or replace function private.outreacher_raise_attention(p_machine uuid, p_business uuid, p_code text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
  v_title text := left('Outreacher ' || coalesce(p_code, 'attention') || ' ' || left(coalesce(p_machine::text, ''), 8), 240);
begin
  select id into v_agent from public.hq_agents
  where name = 'Roleflow Agent' and status <> 'retired'
  limit 1;
  if v_agent is null then
    return;
  end if;
  if exists (
    select 1 from public.hq_tasks
    where agent_id = v_agent and title = v_title and status = 'needs_diego' and decision = 'pending'
  ) then
    return;
  end if;
  insert into public.hq_tasks (agent_id, title, description, status, decision, priority)
  values (
    v_agent,
    v_title,
    left('Machine ' || coalesce(p_machine::text, '') || ' for business ' || coalesce(p_business::text, '') || '. ' || coalesce(p_detail, ''), 8000),
    'needs_diego',
    'pending',
    'high'
  );
end;
$$;

create or replace function public.outreacher_raise_attention(p_machine uuid, p_business uuid, p_code text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  perform private.outreacher_raise_attention(p_machine, p_business, p_code, p_detail);
end;
$$;

create or replace function public.outreacher_note_stripe_event(p_event_id text, p_type text)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;
  insert into private.stripe_events (event_id, type) values (p_event_id, p_type)
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create or replace function public.outreacher_save_bootstrap(
  p_machine uuid,
  p_hash text,
  p_expires timestamptz,
  p_server_id text,
  p_ip text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into private.outreach_bootstrap (machine_id, token_hash, expires_at, server_id, ipv4)
  values (p_machine, p_hash, p_expires, nullif(p_server_id, ''), nullif(p_ip, ''))
  on conflict (machine_id) do update set
    token_hash = excluded.token_hash,
    expires_at = excluded.expires_at,
    used_at = null,
    server_id = coalesce(excluded.server_id, private.outreach_bootstrap.server_id),
    ipv4 = coalesce(excluded.ipv4, private.outreach_bootstrap.ipv4);
end;
$$;

create or replace function public.outreacher_claim_bootstrap(
  p_machine uuid,
  p_token text,
  p_server_id text,
  p_source_ip text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_row private.outreach_bootstrap%rowtype;
  v_machine public.client_machines%rowtype;
  v_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_machine from public.client_machines where id = p_machine for update;
  if v_machine.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  select * into v_row from private.outreach_bootstrap where machine_id = p_machine for update;
  if v_row.machine_id is null or v_row.server_id is null or v_row.ipv4 is null then
    return jsonb_build_object('ok', false, 'reason', 'identity_pending', 'status', 425);
  end if;
  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_hash is distinct from v_row.token_hash
     or coalesce(p_server_id, '') is distinct from v_row.server_id
     or coalesce(p_source_ip, '') is distinct from v_row.ipv4 then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized', 'status', 401);
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired', 'status', 401);
  end if;
  if v_row.used_at is not null or v_machine.revoked_at is not null then
    update public.client_machines set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where id = p_machine;
    update private.outreach_refresh set revoked_at = now() where machine_id = p_machine;
    insert into public.client_machine_events (machine_id, business_id, kind, severity, detail)
    values (p_machine, v_machine.business_id, 'bootstrap_replay', 'critical', '{}'::jsonb);
    perform private.outreacher_raise_attention(p_machine, v_machine.business_id, 'bootstrap_replay', 'A bootstrap token was presented again.');
    return jsonb_build_object('ok', false, 'reason', 'replay', 'status', 403);
  end if;
  if v_machine.status <> 'provisioning' then
    return jsonb_build_object('ok', false, 'reason', 'status', 'status_code', 409);
  end if;
  update private.outreach_bootstrap set used_at = now() where machine_id = p_machine;
  return jsonb_build_object('ok', true, 'business_id', v_machine.business_id, 'machine_id', p_machine);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_rotate_refresh(
  p_machine uuid,
  p_presented text,
  p_next text,
  p_expires timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_row private.outreach_refresh%rowtype;
  v_machine public.client_machines%rowtype;
  v_presented text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_machine from public.client_machines where id = p_machine for update;
  select * into v_row from private.outreach_refresh where machine_id = p_machine for update;
  if v_machine.id is null or v_machine.revoked_at is not null or v_row.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  v_presented := encode(extensions.digest(coalesce(p_presented, ''), 'sha256'), 'hex');
  if v_row.previous_hash is not null and v_presented = v_row.previous_hash and v_presented is distinct from v_row.token_hash then
    update public.client_machines set status = 'revoked', revoked_at = now() where id = p_machine;
    update private.outreach_refresh set revoked_at = now() where machine_id = p_machine;
    insert into public.client_machine_events (machine_id, business_id, kind, severity)
    values (p_machine, v_machine.business_id, 'refresh_reuse', 'critical');
    perform private.outreacher_raise_attention(p_machine, v_machine.business_id, 'refresh_reuse', 'A rotated refresh token was presented again.');
    return jsonb_build_object('ok', false, 'reason', 'refresh_reuse');
  end if;
  if v_row.token_hash is null or v_presented is distinct from v_row.token_hash then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if v_row.expires_at is null or v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  update private.outreach_refresh set
    previous_hash = token_hash,
    token_hash = encode(extensions.digest(p_next, 'sha256'), 'hex'),
    expires_at = p_expires,
    rotated_at = now()
  where machine_id = p_machine;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_store_refresh(p_machine uuid, p_token text, p_expires timestamptz)
returns void
language plpgsql
security definer
set search_path = public, private, extensions
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into private.outreach_refresh (machine_id, token_hash, expires_at, rotated_at)
  values (p_machine, encode(extensions.digest(p_token, 'sha256'), 'hex'), p_expires, now())
  on conflict (machine_id) do update set
    previous_hash = private.outreach_refresh.token_hash,
    token_hash = excluded.token_hash,
    expires_at = excluded.expires_at,
    rotated_at = now(),
    revoked_at = null;
end;
$$;

create or replace function public.outreacher_machine_gate(p_business uuid, p_machine uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_machines%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_row from public.client_machines where id = p_machine and business_id = p_business;
  if v_row.id is null or v_row.revoked_at is not null or v_row.status in ('revoked', 'deleted', 'deleting', 'failed', 'suspended', 'stopped') then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_row.status not in ('provisioning', 'awaiting_login', 'running', 'paused', 'error', 'suspended') then
    return jsonb_build_object('ok', false, 'reason', 'status');
  end if;
  return jsonb_build_object('ok', true, 'business_id', v_row.business_id, 'machine_id', v_row.id, 'status', v_row.status);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function private.outreacher_can_send(p_business uuid, p_action_kind text, p_target text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_global public.outreacher_global%rowtype;
  v_controls public.acq_dm_controls%rowtype;
  v_config public.acq_outreacher_config%rowtype;
  v_settings public.acq_settings%rowtype;
  v_workforce public.business_workforce%rowtype;
  v_machine public.client_machines%rowtype;
  v_handle text;
  v_day timestamptz;
  v_daily integer;
  v_hourly integer;
  v_claim uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_business is null or not exists (select 1 from public.acq_workspaces where id = p_business) then
    return jsonb_build_object('ok', false, 'reason', 'error');
  end if;
  perform 1 from public.acq_workspaces where id = p_business for update;
  select * into v_global from public.outreacher_global where id = 1 for update;
  if v_global.id is null then
    return jsonb_build_object('ok', false, 'reason', 'error');
  end if;
  if v_global.killed then
    return jsonb_build_object('ok', false, 'reason', 'global_kill');
  end if;
  select * into v_controls from public.acq_dm_controls where business_id = p_business for update;
  if v_controls.killed then
    return jsonb_build_object('ok', false, 'reason', 'killed');
  end if;
  if v_controls.business_id is null or v_controls.enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  select * into v_config from public.acq_outreacher_config where business_id = p_business for update;
  if v_config.business_id is not null and v_config.paused then
    return jsonb_build_object('ok', false, 'reason', 'paused');
  end if;
  select * into v_workforce from public.business_workforce
    where agent_id = p_business and role = 'personalised_outreach';
  if v_workforce.agent_id is null or v_workforce.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'reason', 'workforce');
  end if;
  select * into v_settings from public.acq_settings where agent_id = p_business;
  if v_settings.agent_id is null then
    return jsonb_build_object('ok', false, 'reason', 'error');
  end if;
  if v_settings.ig_paused then
    return jsonb_build_object('ok', false, 'reason', 'ig_paused');
  end if;
  if v_settings.system_enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'system_off');
  end if;
  select * into v_machine from public.client_machines
    where business_id = p_business and status <> 'deleted'
    order by created_at desc
    limit 1
    for update;
  if v_machine.id is null or v_machine.subscription_status not in ('active', 'trialing') then
    return jsonb_build_object('ok', false, 'reason', 'subscription');
  end if;
  if v_machine.revoked_at is not null or v_machine.status is distinct from 'running' then
    return jsonb_build_object('ok', false, 'reason', 'machine');
  end if;
  if v_machine.session_state is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;
  if public.acq_in_quiet_hours(v_settings.timezone, v_settings.quiet_start, v_settings.quiet_end) then
    return jsonb_build_object('ok', false, 'reason', 'quiet_hours');
  end if;
  if p_action_kind not in ('dm', 'like', 'follow', 'view') then
    return jsonb_build_object('ok', false, 'reason', 'error');
  end if;
  v_day := (date_trunc('day', now() at time zone coalesce(nullif(btrim(v_settings.timezone), ''), 'Europe/Madrid'))) at time zone coalesce(nullif(btrim(v_settings.timezone), ''), 'Europe/Madrid');
  select count(*) into v_daily from public.outreach_send_ledger
    where business_id = p_business
      and (
        (status = 'claimed' and claim_expires_at > now())
        or (status = 'reported' and coalesce(result, '') is distinct from 'dry_run' and created_at >= v_day)
      );
  select count(*) into v_hourly from public.outreach_send_ledger
    where business_id = p_business
      and (
        (status = 'claimed' and claim_expires_at > now() and created_at >= now() - interval '1 hour')
        or (status = 'reported' and coalesce(result, '') is distinct from 'dry_run' and created_at >= now() - interval '1 hour')
      );
  if v_daily >= v_controls.daily_cap then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap');
  end if;
  if v_hourly >= v_config.hourly_cap then
    return jsonb_build_object('ok', false, 'reason', 'hourly_cap');
  end if;
  v_handle := public.acq_normalize_handle(p_target);
  if v_handle is null then
    return jsonb_build_object('ok', false, 'reason', 'target');
  end if;
  if exists (select 1 from public.acq_dnc where business_id = p_business and handle = v_handle) then
    return jsonb_build_object('ok', false, 'reason', 'dnc');
  end if;
  if exists (
    select 1 from public.acq_targets
    where agent_id = p_business and handle = v_handle and dm_sent_at is not null
  ) or exists (
    select 1 from public.acq_dm_sends where business_id = p_business and lower(handle) = v_handle
  ) or exists (
    select 1 from public.ig_threads where business_id = p_business and lower(username) = v_handle
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_contacted');
  end if;
  insert into public.outreach_send_ledger (business_id, machine_id, handle, action_kind, status, claim_expires_at)
  values (p_business, v_machine.id, v_handle, p_action_kind, 'claimed', now() + interval '2 minutes')
  returning id into v_claim;
  return jsonb_build_object(
    'ok', true,
    'reason', 'claimed',
    'claim_id', v_claim,
    'mode', v_machine.sending_mode,
    'expires_at', now() + interval '2 minutes'
  );
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_can_send(business_id uuid, action_kind text, target text)
returns jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return private.outreacher_can_send(business_id, action_kind, target);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_claim_check(claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.outreach_send_ledger%rowtype;
  v_machine public.client_machines%rowtype;
  v_controls public.acq_dm_controls%rowtype;
  v_global public.outreacher_global%rowtype;
  v_settings public.acq_settings%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_row from public.outreach_send_ledger where id = claim_id;
  if v_row.id is null or v_row.status is distinct from 'claimed' or v_row.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select * into v_machine from public.client_machines where id = v_row.machine_id;
  if v_machine.id is null or v_machine.revoked_at is not null or v_machine.status is distinct from 'running' or v_machine.session_state is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'reason', 'machine');
  end if;
  select * into v_global from public.outreacher_global where id = 1;
  if v_global.killed then
    return jsonb_build_object('ok', false, 'reason', 'global_kill');
  end if;
  select * into v_controls from public.acq_dm_controls where business_id = v_row.business_id;
  if v_controls.killed then
    return jsonb_build_object('ok', false, 'reason', 'killed');
  end if;
  if v_controls.business_id is null or v_controls.enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  select * into v_settings from public.acq_settings where agent_id = v_row.business_id;
  if v_settings.ig_paused then
    return jsonb_build_object('ok', false, 'reason', 'ig_paused');
  end if;
  if v_settings.system_enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'system_off');
  end if;
  return jsonb_build_object('ok', true, 'claim_id', v_row.id, 'expires_at', v_row.claim_expires_at);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_report_send(claim_id uuid, result text, detail jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.outreach_send_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if result is null or result not in ('sent', 'dry_run', 'failed', 'skipped') then
    return jsonb_build_object('ok', false, 'reason', 'result_invalid');
  end if;
  select * into v_row from public.outreach_send_ledger where id = claim_id for update;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if v_row.status is distinct from 'claimed' or v_row.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  update public.outreach_send_ledger
    set status = 'reported', result = result, detail = coalesce(detail, '{}'::jsonb)
    where id = claim_id;
  return jsonb_build_object('ok', true, 'claim_id', claim_id, 'result', result);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function public.outreacher_save_ticket(p_jti text, p_machine uuid, p_expires timestamptz)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into private.outreach_live_tickets (jti, machine_id, expires_at)
  values (p_jti, p_machine, p_expires);
end;
$$;

create or replace function public.outreacher_consume_ticket(p_jti text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row private.outreach_live_tickets%rowtype;
  v_machine public.client_machines%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_row from private.outreach_live_tickets where jti = p_jti for update;
  if v_row.jti is null or v_row.used_at is not null or v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select * into v_machine from public.client_machines where id = v_row.machine_id;
  if v_machine.id is null or v_machine.revoked_at is not null or v_machine.status not in ('awaiting_login', 'running', 'paused') then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  update private.outreach_live_tickets set used_at = now() where jti = p_jti;
  return jsonb_build_object('ok', true, 'machine_id', v_machine.id, 'business_id', v_machine.business_id);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

create or replace function private.outreacher_pipeline_gate(p_business uuid, p_op text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_send boolean;
  v_claim uuid;
begin
  v_action := lower(coalesce(p_args->>'action', ''));
  v_send := (p_op = 'set_stage' and lower(coalesce(p_args->>'stage', '')) = 'dm_sent')
    or (p_op = 'log' and v_action in (
      'follow', 'like_post', 'like_story', 'comment', 'comment_reel', 'comment_post',
      'story_reply', 'view_story', 'save_post', 'dm', 'send', 'message'
    ));
  if not v_send then
    return jsonb_build_object('ok', true);
  end if;
  begin
    v_claim := nullif(p_args->>'claim_id', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'claim_required', 'error', 'A send claim is required.');
  end;
  if v_claim is null or not exists (
    select 1 from public.outreach_send_ledger
    where id = v_claim and business_id = p_business and status = 'claimed' and claim_expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'claim_required', 'error', 'A send claim is required.');
  end if;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'reason', 'error');
end;
$$;

-- Legacy logging RPC. Send-like ops now require a live claim. The function stays
-- so existing service-role callers are not dropped in this change. Retire it
-- before the outreacher is sold: it is not the send path.
create or replace function public.acq_worker_pipeline(p_key text, p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to public, private, extensions
as $function$
declare
  v_worker public.acq_workers%rowtype;
  v_biz uuid;
  v_tz text;
  v_item jsonb;
  v_handle text;
  v_stage text;
  v_raw_stage text;
  v_target public.acq_targets%rowtype;
  v_added int := 0; v_updated int := 0; v_skipped jsonb := '[]'::jsonb;
  v_source text;
  v_role text;
  v_action text;
  v_today_start timestamptz;
  v_out jsonb;
  v_gate jsonb;
begin
  if p_key is null or length(p_key) < 20 then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  end if;
  select * into v_worker from public.acq_workers
    where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if v_worker.id is null or not v_worker.enabled then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  end if;
  v_biz := v_worker.business_id;
  update public.acq_workers set last_heartbeat_at = now(),
    status = case when status = 'paused' then 'paused' else 'online' end
    where id = v_worker.id;
  select coalesce(timezone, 'Europe/Madrid') into v_tz from public.acq_settings where agent_id = v_biz;
  v_tz := coalesce(v_tz, 'Europe/Madrid');
  p_args := coalesce(p_args, '{}'::jsonb);
  v_gate := private.outreacher_pipeline_gate(v_biz, p_op, p_args);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;

  if p_op = 'add_prospects' then
    for v_item in select * from jsonb_array_elements(coalesce(p_args->'prospects', '[]'::jsonb)) loop
      v_handle := public.acq_normalize_handle(v_item->>'ig_handle');
      if v_handle is null or v_handle !~ '^[a-z0-9._]{1,30}$' then
        v_skipped := v_skipped || jsonb_build_object('handle', v_item->>'ig_handle', 'reason', 'bad_handle'); continue;
      end if;
      if exists (select 1 from public.acq_dnc d where d.business_id = v_biz and d.handle = v_handle) then
        v_skipped := v_skipped || jsonb_build_object('handle', v_handle, 'reason', 'dnc'); continue;
      end if;
      v_source := lower(coalesce(v_item->>'source', 'manual'));
      if v_source not in ('competitor_followers','keyword','hashtag','manual','tailortalk','instagram','comment') then
        v_source := 'manual';
      end if;
      insert into public.acq_targets (agent_id, handle, full_name, followers, follower_count, niche, icp_score,
          score_summary, score_model, source, source_detail, bio, cta_detected, owner_notes, stage, assigned_agent)
        values (v_biz, v_handle, coalesce(v_item->>'full_name', ''),
          nullif(v_item->>'followers', '')::int, nullif(v_item->>'followers', '')::int,
          nullif(v_item->>'niche', ''),
          least(100, greatest(0, nullif(v_item->>'icp_score', '')::int)),
          coalesce(v_item->>'why_fit', ''), 'worker-routine',
          v_source, coalesce(v_item->>'source', 'manual'),
          coalesce(v_item->>'bio', ''), coalesce((v_item->>'cta_detected')::boolean, false),
          coalesce(v_item->>'notes', ''),
          coalesce(public.acq_pipeline_stage(v_item->>'stage'), 'target'), 'icp_acquisition')
        on conflict (agent_id, handle) do nothing;
      if found then
        v_added := v_added + 1;
        perform public.acq_bump_role(v_biz, 'icp_acquisition', v_tz, null);
        insert into public.acq_activity (agent_id, target_id, role, action, result, notes, actor, payload)
          select v_biz, t.id, 'icp_acquisition', 'prospect_found', 'ok', left(coalesce(v_item->>'why_fit', ''), 2000), 'worker',
                 jsonb_build_object('icp_score', v_item->'icp_score', 'source', v_item->>'source')
          from public.acq_targets t where t.agent_id = v_biz and t.handle = v_handle;
      else
        update public.acq_targets set
            full_name = case when full_name = '' then coalesce(v_item->>'full_name', '') else full_name end,
            niche = coalesce(niche, nullif(v_item->>'niche', ''))
          where agent_id = v_biz and handle = v_handle;
        v_updated := v_updated + 1;
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'business_id', v_biz, 'added', v_added, 'existing', v_updated, 'skipped', v_skipped);

  elsif p_op = 'list' then
    v_raw_stage := nullif(lower(coalesce(p_args->>'stage', '')), '');
    v_stage := public.acq_pipeline_stage(v_raw_stage);
    if v_raw_stage is not null and v_stage is null then
      return jsonb_build_object('ok', false, 'error', 'Unknown stage.');
    end if;
    select coalesce(jsonb_agg(r), '[]'::jsonb) into v_out from (
      select t.handle as ig_handle, t.full_name, coalesce(t.followers, t.follower_count) as followers, t.niche, t.icp_score,
             t.score_summary as why_fit, t.source_detail as source, t.stage, t.peak_stage, t.lead_status,
             t.warm_actions, t.last_action_at, t.warmed_at, t.dm_sent_at, t.replied_at, t.owner_notes as notes,
             t.tags, t.id as target_id, t.updated_at
      from public.acq_targets t
      where t.agent_id = v_biz
        and (v_stage is null or t.stage = v_stage)
        and (v_raw_stage is distinct from 'warming' or t.warmed_at is null)
        and (v_raw_stage is distinct from 'warmed' or t.warmed_at is not null)
        and (v_raw_stage is distinct from 'dnc' or exists (select 1 from public.acq_dnc d where d.business_id = v_biz and d.handle = t.handle))
      order by t.icp_score desc nulls last, t.updated_at desc
      limit least(500, greatest(1, coalesce(nullif(p_args->>'limit', '')::int, 50)))
    ) r;
    return jsonb_build_object('ok', true, 'business_id', v_biz, 'prospects', v_out);

  elsif p_op = 'set_stage' then
    v_handle := public.acq_normalize_handle(p_args->>'handle');
    v_raw_stage := lower(coalesce(p_args->>'stage', ''));
    v_stage := public.acq_pipeline_stage(v_raw_stage);
    if v_stage is null then return jsonb_build_object('ok', false, 'error', 'Unknown stage.'); end if;
    select * into v_target from public.acq_targets where agent_id = v_biz and handle = v_handle;
    if v_target.id is null then return jsonb_build_object('ok', false, 'error', 'Unknown handle.'); end if;
    update public.acq_targets set
        stage = v_stage,
        warmed_at = case when v_raw_stage = 'warmed' then coalesce(warmed_at, now()) else warmed_at end,
        dm_sent_at = case when v_raw_stage = 'dm_sent' then coalesce(dm_sent_at, now()) else dm_sent_at end,
        replied_at = case when v_raw_stage = 'replied' then coalesce(replied_at, now()) else replied_at end,
        lead_status = case v_raw_stage when 'replied' then 'warm' when 'qualified' then 'hot' when 'booked' then 'hot'
                        when 'won' then 'converted' when 'lost' then 'dead' when 'dnc' then 'dead' else lead_status end,
        crm_state = case v_raw_stage when 'booked' then 'booked' when 'won' then 'paid' when 'lost' then 'lost'
                        when 'qualified' then 'qualifying' when 'replied' then coalesce(crm_state, 'discovering') else crm_state end,
        owner_notes = case when coalesce(p_args->>'note', '') <> ''
                        then trim(both E'\n' from owner_notes || E'\n' || to_char(now() at time zone v_tz, 'YYYY-MM-DD HH24:MI') || ' ' || (p_args->>'note'))
                        else owner_notes end,
        last_action_at = now()
      where id = v_target.id;
    if v_raw_stage = 'dnc' then
      insert into public.acq_dnc (business_id, handle, reason)
        values (v_biz, v_handle, left(coalesce(nullif(p_args->>'note', ''), 'dnc'), 500))
        on conflict (business_id, handle) do nothing;
    end if;
    insert into public.acq_activity (agent_id, target_id, role, action, result, notes, actor, payload)
      values (v_biz, v_target.id, coalesce(nullif(public.acq_pipeline_role(p_args->>'role'), ''), case v_raw_stage when 'found' then 'icp_acquisition' when 'warming' then 'engagement_warmup' when 'warmed' then 'engagement_warmup' when 'dm_sent' then 'personalised_outreach' when 'replied' then 'personalised_outreach' when 'qualified' then 'qualification' when 'booked' then 'appointment_booking' else 'chief_of_staff' end), 'stage_' || v_raw_stage, 'ok',
              left(coalesce(p_args->>'note', ''), 2000), 'worker',
              jsonb_build_object('from', v_target.stage, 'to', v_stage, 'pipeline_stage', v_raw_stage));
    return jsonb_build_object('ok', true, 'handle', v_handle, 'from', v_target.stage, 'to', v_stage);

  elsif p_op = 'log' then
    v_role := public.acq_pipeline_role(p_args->>'role');
    v_action := lower(coalesce(p_args->>'action', ''));
    if v_action = '' then return jsonb_build_object('ok', false, 'error', 'Missing action.'); end if;
    v_handle := public.acq_normalize_handle(p_args->>'handle');
    select * into v_target from public.acq_targets where agent_id = v_biz and handle = v_handle;
    insert into public.acq_activity (agent_id, target_id, role, action, result, notes, actor, payload)
      values (v_biz, v_target.id, v_role, v_action, coalesce(p_args->'detail'->>'result', 'done'),
              left(coalesce(p_args->'detail'->>'note', ''), 2000), 'worker',
              coalesce(p_args->'detail', '{}'::jsonb) || jsonb_build_object('target_handle', coalesce(v_handle, p_args->>'handle')));
    if v_target.id is not null then
      update public.acq_targets set
          last_action_at = now(),
          warm_actions = warm_actions + case when v_action in ('follow','like_post','like_story','comment','comment_reel','comment_post','story_reply','view_story','save_post') then 1 else 0 end,
          stage = case when v_action in ('follow','like_post','like_story','comment','comment_reel','comment_post','story_reply','view_story','save_post') and stage = 'target' then 'warmup' else stage end
        where id = v_target.id;
    end if;
    if v_target.id is not null and not exists (
        select 1 from public.acq_activity x
        where x.agent_id = v_biz and x.role = v_role and x.target_id = v_target.id
          and x.actor = 'worker' and x.action not like 'stage\_%'
          and x.created_at >= (date_trunc('day', now() at time zone v_tz)) at time zone v_tz
          and x.created_at < now() - interval '1 second') then
      perform public.acq_bump_role(v_biz, v_role, v_tz, null);
    else
      update public.business_workforce set last_run_at = now(), updated_at = now()
        where agent_id = v_biz and role = v_role;
    end if;
    return jsonb_build_object('ok', true, 'role', v_role, 'action', v_action, 'target_found', v_target.id is not null);

  elsif p_op = 'stats' then
    v_today_start := (date_trunc('day', now() at time zone v_tz)) at time zone v_tz;
    select jsonb_build_object(
      'ok', true, 'business_id', v_biz, 'timezone', v_tz, 'since', v_today_start,
      'today', jsonb_build_object(
        'prospects_added', (select count(*) from public.acq_targets where agent_id = v_biz and created_at >= v_today_start),
        'warm_actions', (select count(*) from public.acq_activity where agent_id = v_biz and created_at >= v_today_start and role = 'engagement_warmup' and action not like 'stage\_%'),
        'dms_sent', (select count(*) from public.acq_targets where agent_id = v_biz and dm_sent_at >= v_today_start),
        'replies', (select count(*) from public.acq_targets where agent_id = v_biz and replied_at >= v_today_start),
        'distinct_targets_touched', (select count(distinct target_id) from public.acq_activity where agent_id = v_biz and created_at >= v_today_start and target_id is not null),
        'by_role_action', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
            select role || ':' || action as k, count(*) as n from public.acq_activity
            where agent_id = v_biz and created_at >= v_today_start group by 1) s)),
      'pipeline', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
            select stage, count(*) n from public.acq_targets where agent_id = v_biz group by 1) s),
      'dnc', (select count(*) from public.acq_dnc where business_id = v_biz),
      'daily_cap', (select daily_cap from public.acq_settings where agent_id = v_biz)
    ) into v_out;
    return v_out;
  end if;
  return jsonb_build_object('ok', false, 'error', 'Unknown op.');
end;
$function$;

revoke all on function public.acq_worker_pipeline(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.acq_worker_pipeline(text, text, jsonb) to service_role;

revoke all on function public.outreacher_machine_secrets(uuid) from public, anon, authenticated;
revoke all on function public.outreacher_can_send(uuid, text, text) from public, anon, authenticated;
revoke all on function public.outreacher_claim_check(uuid) from public, anon, authenticated;
revoke all on function public.outreacher_claim_bootstrap(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.outreacher_rotate_refresh(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.outreacher_store_refresh(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.outreacher_save_bootstrap(uuid, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.outreacher_machine_gate(uuid, uuid) from public, anon, authenticated;
revoke all on function public.outreacher_note_stripe_event(text, text) from public, anon, authenticated;
revoke all on function public.outreacher_raise_attention(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.outreacher_report_send(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.outreacher_save_ticket(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.outreacher_consume_ticket(text) from public, anon, authenticated;
revoke all on function public.outreacher_touch_machine() from public, anon, authenticated;
revoke all on function private.outreacher_can_send(uuid, text, text) from public, anon, authenticated;
revoke all on function private.outreacher_pipeline_gate(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.outreacher_raise_attention(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.outreacher_machine_secrets(uuid) to service_role;
grant execute on function public.outreacher_can_send(uuid, text, text) to service_role;
grant execute on function public.outreacher_claim_check(uuid) to service_role;
grant execute on function public.outreacher_claim_bootstrap(uuid, text, text, text) to service_role;
grant execute on function public.outreacher_rotate_refresh(uuid, text, text, timestamptz) to service_role;
grant execute on function public.outreacher_store_refresh(uuid, text, timestamptz) to service_role;
grant execute on function public.outreacher_save_bootstrap(uuid, text, timestamptz, text, text) to service_role;
grant execute on function public.outreacher_machine_gate(uuid, uuid) to service_role;
grant execute on function public.outreacher_note_stripe_event(text, text) to service_role;
grant execute on function public.outreacher_raise_attention(uuid, uuid, text, text) to service_role;
grant execute on function public.outreacher_report_send(uuid, text, jsonb) to service_role;
grant execute on function public.outreacher_save_ticket(text, uuid, timestamptz) to service_role;
grant execute on function public.outreacher_consume_ticket(text) to service_role;
grant execute on function public.outreacher_touch_machine() to service_role;
grant execute on function private.outreacher_can_send(uuid, text, text) to service_role;

do $pub$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['client_machines', 'client_machine_events']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$pub$;

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, then re-run to schedule the outreacher provisioner.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('outreach-provisioner');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'outreach-provisioner',
    '* * * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/outreach-provisioner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select value from private.acquisition_settings where key = 'cron_secret'), '')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    $job$
  );
end
$cron$;
