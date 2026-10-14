-- TailorTalk CRM cache for the admin page.
-- Idempotent. Apply in the Supabase SQL editor. Do not run the edge function
-- from this file.
--
-- Agent access tokens live in private.tailortalk_agent_secrets. That schema is
-- not in the API allow-list. anon and authenticated have no grant. The browser
-- never selects the token. The tailortalk-sync function writes it, encrypted
-- with TAILORTALK_TOKEN_KEY.
--
-- Hourly sync: set the cron secret to the same value as the function secret
-- TAILORTALK_CRON_SECRET, then the pg_cron job can call the function.
--   insert into private.tailortalk_settings (key, value)
--   values ('cron_secret', 'paste-the-same-value-as-TAILORTALK_CRON_SECRET')
--   on conflict (key) do update set value = excluded.value;
-- pg_cron and pg_net must be enabled. If they are not, the tables still apply
-- and the notice tells you to enable them and re-run this file.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.tailortalk_agents (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  last_synced_at timestamptz,
  last_sync_error text,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tailortalk_agents_label_not_blank check (length(btrim(label)) > 0)
);

create table if not exists private.tailortalk_agent_secrets (
  agent_id uuid primary key references public.tailortalk_agents (id) on delete cascade,
  token_encrypted text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.tailortalk_settings (
  key text primary key,
  value text not null
);

insert into private.tailortalk_settings (key, value)
values ('sync_url', 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/tailortalk-sync')
on conflict (key) do nothing;

create table if not exists public.tailortalk_leads (
  agent_id uuid not null references public.tailortalk_agents (id) on delete cascade,
  external_id text not null,
  lead_name text,
  lead_contact text,
  lead_status text,
  category text,
  is_converted boolean not null default false,
  converted_at timestamptz,
  last_message_time timestamptz,
  joined_at timestamptz,
  total_followups integer,
  integration text,
  source text,
  synced_at timestamptz not null default now(),
  primary key (agent_id, external_id)
);

create index if not exists tailortalk_leads_activity
  on public.tailortalk_leads (agent_id, last_message_time desc);

create table if not exists public.tailortalk_contacts (
  agent_id uuid not null references public.tailortalk_agents (id) on delete cascade,
  phone_number text not null,
  created_at_remote timestamptz not null,
  name text,
  updated_at_remote timestamptz,
  synced_at timestamptz not null default now(),
  primary key (agent_id, phone_number, created_at_remote)
);

create table if not exists public.tailortalk_agent_stats (
  agent_id uuid primary key references public.tailortalk_agents (id) on delete cascade,
  total_leads integer not null default 0,
  by_status jsonb not null default '{}'::jsonb,
  by_source jsonb not null default '{}'::jsonb,
  converted_count integer not null default 0,
  conversion_rate numeric,
  last_activity_at timestamptz,
  leads_per_day jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

alter table public.tailortalk_agents enable row level security;
alter table public.tailortalk_leads enable row level security;
alter table public.tailortalk_contacts enable row level security;
alter table public.tailortalk_agent_stats enable row level security;

drop policy if exists tailortalk_agents_select on public.tailortalk_agents;
create policy tailortalk_agents_select on public.tailortalk_agents
  for select to authenticated
  using (public.is_admin());

drop policy if exists tailortalk_leads_select on public.tailortalk_leads;
create policy tailortalk_leads_select on public.tailortalk_leads
  for select to authenticated
  using (public.is_admin());

drop policy if exists tailortalk_contacts_select on public.tailortalk_contacts;
create policy tailortalk_contacts_select on public.tailortalk_contacts
  for select to authenticated
  using (public.is_admin());

drop policy if exists tailortalk_stats_select on public.tailortalk_agent_stats;
create policy tailortalk_stats_select on public.tailortalk_agent_stats
  for select to authenticated
  using (public.is_admin());

revoke all on table public.tailortalk_agents from public, anon, authenticated;
revoke all on table public.tailortalk_leads from public, anon, authenticated;
revoke all on table public.tailortalk_contacts from public, anon, authenticated;
revoke all on table public.tailortalk_agent_stats from public, anon, authenticated;
grant select on table public.tailortalk_agents to authenticated;
grant select on table public.tailortalk_leads to authenticated;
grant select on table public.tailortalk_contacts to authenticated;
grant select on table public.tailortalk_agent_stats to authenticated;

revoke all on table private.tailortalk_agent_secrets from public, anon, authenticated;
revoke all on table private.tailortalk_settings from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on table private.tailortalk_agent_secrets to service_role;
grant select, insert, update, delete on table public.tailortalk_agents to service_role;
grant select, insert, update, delete on table public.tailortalk_leads to service_role;
grant select, insert, update, delete on table public.tailortalk_contacts to service_role;
grant select, insert, update, delete on table public.tailortalk_agent_stats to service_role;

-- private is not an API schema, so the edge function cannot select it through
-- PostgREST. These two functions are the only read and write path. Execute is
-- revoked from the browser roles and granted to service_role. auth.role()
-- still has to be service_role inside the function.

create or replace function public.tailortalk_put_secret(p_agent_id uuid, p_token_encrypted text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_agent_id is null or p_token_encrypted is null or length(btrim(p_token_encrypted)) = 0 then
    raise exception 'missing secret';
  end if;
  insert into private.tailortalk_agent_secrets (agent_id, token_encrypted)
  values (p_agent_id, p_token_encrypted)
  on conflict (agent_id) do update
    set token_encrypted = excluded.token_encrypted,
        updated_at = now();
end;
$$;

create or replace function public.tailortalk_read_secret(p_agent_id uuid)
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
  select token_encrypted into stored
  from private.tailortalk_agent_secrets
  where agent_id = p_agent_id;
  return stored;
end;
$$;

revoke all on function public.tailortalk_put_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.tailortalk_read_secret(uuid) from public, anon, authenticated;
grant execute on function public.tailortalk_put_secret(uuid, text) to service_role;
grant execute on function public.tailortalk_read_secret(uuid) to service_role;

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, then re-run this migration to schedule the hourly sync.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('tailortalk-sync-hourly');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'tailortalk-sync-hourly',
    '0 * * * *',
    $job$
    select net.http_post(
      url := coalesce((select value from private.tailortalk_settings where key = 'sync_url'), ''),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select value from private.tailortalk_settings where key = 'cron_secret'), '')
      ),
      body := '{"trigger":"cron"}'::jsonb,
      timeout_milliseconds := 150000
    );
    $job$
  );
end
$cron$;
