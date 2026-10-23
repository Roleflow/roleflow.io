-- Phase 5: per-agent prompts, routines, runs, and actions.
-- No sample rows. Auto-approve stays off until a person turns it on.
-- The runner secret stays in private.acquisition_settings.

create table if not exists public.agent_prompts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  agent_role text not null,
  body text not null default '',
  note text not null default '',
  char_count integer not null default 0,
  score integer,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  constraint agent_prompts_role_check check (agent_role in (
    'icp_acquisition', 'engagement_warmup', 'personalised_outreach', 'outbound_manager',
    'comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking', 'inbound_manager'
  )),
  constraint agent_prompts_length_check check (char_length(body) <= 40000)
);

create index if not exists agent_prompts_role_idx
  on public.agent_prompts (business_id, agent_role, created_at desc);

create table if not exists public.agent_routines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  agent_role text not null,
  name text not null,
  cron text not null,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  instructions text not null default '',
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_routines_role_check check (agent_role in (
    'icp_acquisition', 'engagement_warmup', 'personalised_outreach', 'outbound_manager',
    'comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking', 'inbound_manager'
  )),
  constraint agent_routines_name_check check (char_length(name) between 1 and 120),
  constraint agent_routines_cron_check check (char_length(cron) between 5 and 80),
  constraint agent_routines_zone_check check (char_length(timezone) between 1 and 80),
  constraint agent_routines_instructions_check check (char_length(instructions) <= 4000)
);

create index if not exists agent_routines_due_idx
  on public.agent_routines (business_id, agent_role, enabled);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  agent_role text not null,
  routine_id uuid references public.agent_routines (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running',
  summary text not null default '',
  error text not null default '',
  constraint agent_runs_role_check check (agent_role in (
    'icp_acquisition', 'engagement_warmup', 'personalised_outreach', 'outbound_manager',
    'comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking', 'inbound_manager'
  )),
  constraint agent_runs_status_check check (status in ('running', 'ok', 'error', 'waiting'))
);

create index if not exists agent_runs_role_idx
  on public.agent_runs (business_id, agent_role, started_at desc);

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  agent_role text not null,
  run_id uuid references public.agent_runs (id) on delete set null,
  type text not null,
  target text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'proposed',
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  claimed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_actions_role_check check (agent_role in (
    'icp_acquisition', 'engagement_warmup', 'personalised_outreach', 'outbound_manager',
    'comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking', 'inbound_manager'
  )),
  constraint agent_actions_type_check check (type in ('research', 'draft', 'crm_update', 'score', 'instagram_dm', 'follow', 'comment')),
  constraint agent_actions_status_check check (status in ('proposed', 'approved', 'done', 'failed', 'rejected'))
);

create index if not exists agent_actions_status_idx
  on public.agent_actions (business_id, status, created_at desc);

create table if not exists public.agent_settings (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  agent_role text not null,
  auto_approve boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (business_id, agent_role),
  constraint agent_settings_role_check check (agent_role in (
    'icp_acquisition', 'engagement_warmup', 'personalised_outreach', 'outbound_manager',
    'comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking', 'inbound_manager'
  ))
);

alter table public.agent_prompts enable row level security;
alter table public.agent_routines enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
alter table public.agent_settings enable row level security;

do $grants$
declare
  rel text;
begin
  foreach rel in array array['agent_prompts', 'agent_routines', 'agent_runs', 'agent_actions', 'agent_settings']
  loop
    execute format('revoke all on table public.%I from public, anon', rel);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', rel);
    execute format('grant select, insert, update, delete on table public.%I to service_role', rel);
  end loop;
end
$grants$;

do $policies$
declare
  rel text;
begin
  foreach rel in array array['agent_prompts', 'agent_routines', 'agent_runs', 'agent_actions', 'agent_settings']
  loop
    execute format('drop policy if exists %I on public.%I', rel || '_read', rel);
    execute format('create policy %I on public.%I for select to authenticated using (public.acq_can_read(business_id))', rel || '_read', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_insert', rel);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.acq_can_edit(business_id))', rel || '_insert', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_update', rel);
    execute format('create policy %I on public.%I for update to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id))', rel || '_update', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_delete', rel);
    execute format('create policy %I on public.%I for delete to authenticated using (public.acq_can_edit(business_id))', rel || '_delete', rel);
  end loop;
end
$policies$;

create or replace function public.agent_actions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.approved_by := null;
    new.approved_at := null;
    new.claimed_at := null;
    new.result := '{}'::jsonb;
    new.error := '';
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if old.status = 'proposed' and new.status = 'approved' then
        new.approved_by := auth.uid();
        new.approved_at := now();
      elsif old.status = 'proposed' and new.status = 'rejected' then
        new.approved_by := null;
        new.approved_at := null;
      else
        raise exception 'That status change is not available here';
      end if;
    else
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
    end if;
    new.result := old.result;
    new.error := old.error;
    new.claimed_at := old.claimed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists agent_actions_guard on public.agent_actions;
create trigger agent_actions_guard
  before insert or update on public.agent_actions
  for each row execute function public.agent_actions_guard();

revoke all on function public.agent_actions_guard() from public, anon, authenticated;

insert into private.acquisition_settings (key, value)
values ('workforce_runner_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public.acq_read_workforce_secret()
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
  where key = 'workforce_runner_secret';
  return v_secret;
end;
$$;

revoke all on function public.acq_read_workforce_secret() from public, anon, authenticated;
grant execute on function public.acq_read_workforce_secret() to service_role;
