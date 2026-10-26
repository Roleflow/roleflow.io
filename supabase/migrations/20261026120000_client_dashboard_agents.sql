-- NOT APPLIED.
-- The owner applies this file. This change does not run against production
-- from the pull request. It does not drop TailorTalk tables and it does not
-- delete rows. Unscheduling the two TailorTalk jobs only stops those crons
-- after this file is applied. Existing TailorTalk rows stay where they are.
--
-- After apply, deploy the functions named at the bottom and set the secrets
-- listed in docs/client-dashboard.md. Agents stay off until a switch row is
-- saved with enabled = true. A missing row is off.

create table if not exists public.acq_agent_switches (
  business_id uuid not null,
  agent_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (business_id, agent_key),
  constraint acq_agent_switches_key check (agent_key in ('warmer', 'outreacher', 'setter', 'followup'))
);

create table if not exists public.acq_agent_prompts (
  business_id uuid primary key,
  agent_key text not null default 'setter',
  body text not null default '',
  tested_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint acq_agent_prompts_key check (agent_key = 'setter')
);

create table if not exists public.acq_followup_policy (
  business_id uuid primary key,
  hours_since_last_message integer not null default 4,
  lead_stage text not null default 'any',
  no_reply_after integer not null default 1,
  max_followups integer not null default 3,
  booked text not null default 'any',
  quiet_start text not null default '22:00',
  quiet_end text not null default '08:00',
  updated_at timestamptz not null default now(),
  constraint acq_followup_policy_hours check (hours_since_last_message between 1 and 23),
  constraint acq_followup_policy_quiet_count check (no_reply_after between 1 and 20),
  constraint acq_followup_policy_max check (max_followups between 1 and 10),
  constraint acq_followup_policy_booked check (booked in ('any', 'booked', 'not_booked')),
  constraint acq_followup_policy_stage check (lead_stage in ('any', 'open', 'discovering', 'qualifying', 'proposal', 'booked', 'paid', 'lost', 'unqualified', 'postponed'))
);

create table if not exists public.acq_user_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  language text not null default 'en',
  updated_at timestamptz not null default now(),
  constraint acq_user_prefs_language check (language in ('en', 'es'))
);

alter table public.acq_agent_switches enable row level security;
alter table public.acq_agent_prompts enable row level security;
alter table public.acq_followup_policy enable row level security;
alter table public.acq_user_prefs enable row level security;

drop policy if exists acq_agent_switches_read on public.acq_agent_switches;
create policy acq_agent_switches_read on public.acq_agent_switches
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_agent_switches_write on public.acq_agent_switches;
create policy acq_agent_switches_write on public.acq_agent_switches
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_agent_prompts_read on public.acq_agent_prompts;
create policy acq_agent_prompts_read on public.acq_agent_prompts
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_agent_prompts_write on public.acq_agent_prompts;
create policy acq_agent_prompts_write on public.acq_agent_prompts
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_followup_policy_read on public.acq_followup_policy;
create policy acq_followup_policy_read on public.acq_followup_policy
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_followup_policy_write on public.acq_followup_policy;
create policy acq_followup_policy_write on public.acq_followup_policy
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_user_prefs_self on public.acq_user_prefs;
create policy acq_user_prefs_self on public.acq_user_prefs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.acq_agent_switches to authenticated;
grant select, insert, update, delete on public.acq_agent_prompts to authenticated;
grant select, insert, update, delete on public.acq_followup_policy to authenticated;
grant select, insert, update, delete on public.acq_user_prefs to authenticated;
grant all on public.acq_agent_switches to service_role;
grant all on public.acq_agent_prompts to service_role;
grant all on public.acq_followup_policy to service_role;
grant all on public.acq_user_prefs to service_role;

revoke all on public.acq_agent_switches from anon;
revoke all on public.acq_agent_prompts from anon;
revoke all on public.acq_followup_policy from anon;
revoke all on public.acq_user_prefs from anon;

-- Stop the retired hourly sync jobs. This does not delete their tables.
do $cron$
begin
  begin
    perform cron.unschedule('tailortalk-sync-hourly');
  exception when others then
    null;
  end;
  begin
    perform cron.unschedule('acq-tailortalk-sync');
  exception when others then
    null;
  end;
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, deploy followup-boss, then re-run the schedule block.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('followup-boss');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'followup-boss',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/followup-boss',
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
