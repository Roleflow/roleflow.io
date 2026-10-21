-- Client acquisition pipeline for an acquisition workspace.
-- Additive. Does not rewrite or delete existing CRM, HQ, workforce, or
-- tailortalk_* rows. TailorTalk stays a legacy client cache. This pipeline
-- does not require a tailortalk_agents row.
--
-- agent_id on acq_* tables is public.acq_workspaces.id.
-- business_workforce.agent_id may be either a legacy setter id or a workspace
-- id, so its foreign key to tailortalk_agents is dropped. Existing setter rows
-- stay. Personal voice notes live in the private acq-voice bucket.
--
-- Bot writes go through acq_bot_* (service_role only). The browser uses RLS.

alter table public.business_workforce drop constraint if exists business_workforce_role_check;
alter table public.business_workforce
  add constraint business_workforce_role_check check (
    role in (
      'outreach', 'follow_up', 'setting', 'target_comments',
      'chief_of_staff', 'icp_acquisition', 'engagement_warmup', 'personalised_outreach',
      'comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking'
    )
  );

alter table public.business_workforce
  add column if not exists parameters jsonb not null default '{}'::jsonb,
  add column if not exists daily_count integer not null default 0,
  add column if not exists daily_count_on date,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_error text;

alter table public.business_workforce drop constraint if exists business_workforce_daily_count_check;
alter table public.business_workforce
  add constraint business_workforce_daily_count_check check (daily_count >= 0);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'business_workforce'
      and column_name = 'enabled'
  ) then
    alter table public.business_workforce
      add column enabled boolean generated always as (status = 'active') stored;
  end if;
end $$;


-- Workspaces are the tenant for acquisition. A TailorTalk agent link is optional
-- and is only used by the legacy importer. The conversation engine never reads it.

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'business_workforce'
      and c.contype = 'f'
  loop
    execute format('alter table public.business_workforce drop constraint %I', r.conname);
  end loop;
end $$;

create table if not exists public.acq_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Acquisition',
  tailortalk_agent_id uuid references public.tailortalk_agents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_workspaces_name_check check (char_length(btrim(name)) between 1 and 80)
);

create index if not exists acq_workspaces_owner_idx on public.acq_workspaces (owner_id);

alter table public.acq_workspaces enable row level security;
revoke all on table public.acq_workspaces from public, anon;
grant select, update on table public.acq_workspaces to authenticated;

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
  );
$$;

revoke all on function public.acq_can_read(uuid) from public, anon;
revoke all on function public.acq_can_edit(uuid) from public, anon;
grant execute on function public.acq_can_read(uuid) to authenticated, service_role;
grant execute on function public.acq_can_edit(uuid) to authenticated, service_role;

drop policy if exists business_workforce_select on public.business_workforce;
create policy business_workforce_select on public.business_workforce
  for select to authenticated
  using (public.can_read_business(agent_id) or public.acq_can_read(agent_id));

drop policy if exists business_workforce_insert on public.business_workforce;
create policy business_workforce_insert on public.business_workforce
  for insert to authenticated
  with check (public.can_edit_business(agent_id) or public.acq_can_edit(agent_id));

drop policy if exists business_workforce_update on public.business_workforce;
create policy business_workforce_update on public.business_workforce
  for update to authenticated
  using (public.can_edit_business(agent_id) or public.acq_can_edit(agent_id))
  with check (public.can_edit_business(agent_id) or public.acq_can_edit(agent_id));

create table if not exists public.acq_settings (
  agent_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  system_enabled boolean not null default false,
  daily_cap integer not null default 30,
  timezone text not null default 'Europe/Madrid',
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  warmup_like_count integer not null default 2,
  warmup_spacing_days integer not null default 1,
  ig_paused boolean not null default false,
  ig_pause_reason text,
  ig_pause_notes text,
  ig_paused_at timestamptz,
  share_bps integer not null default 1000,
  ai_voice_future boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_settings_cap_check check (daily_cap between 20 and 30),
  constraint acq_settings_like_check check (warmup_like_count between 1 and 2),
  constraint acq_settings_spacing_check check (warmup_spacing_days between 1 and 3),
  constraint acq_settings_tz_check check (timezone ~ '^[A-Za-z0-9/_+-]{1,80}$'),
  constraint acq_settings_share_check check (share_bps = 1000),
  constraint acq_settings_ai_voice_check check (ai_voice_future = false),
  constraint acq_settings_pause_reason_check check (
    ig_pause_reason is null or ig_pause_reason in ('warning', 'challenge', 'action_block')
  )
);

create table if not exists public.acq_targets (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  handle text not null,
  followers integer,
  bio text not null default '',
  cta_detected boolean not null default false,
  cta_text text,
  source text not null default 'manual',
  source_detail text,
  niche text,
  icp_score integer,
  icp_reasons jsonb not null default '{}'::jsonb,
  stage text not null default 'target',
  peak_stage text not null default 'target',
  stage_changed_at timestamptz not null default now(),
  lead_status text not null default 'cold',
  budget text,
  timeline text,
  decision_maker boolean,
  fit text,
  qual_score integer,
  recovery_due boolean not null default false,
  tailortalk_external_id text,
  tt_category text,
  last_message_at timestamptz,
  followups integer,
  added_on date not null default (now() at time zone 'Europe/Madrid')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_targets_handle_agent unique (agent_id, handle),
  constraint acq_targets_handle_check check (handle ~ '^[a-z0-9._]{1,30}$'),
  constraint acq_targets_followers_check check (followers is null or followers >= 0),
  constraint acq_targets_score_check check (icp_score is null or icp_score between 0 and 100),
  constraint acq_targets_qual_check check (qual_score is null or qual_score between 0 and 100),
  constraint acq_targets_source_check check (
    source in ('competitor_followers', 'keyword', 'hashtag', 'manual', 'tailortalk', 'instagram', 'comment')
  ),
  constraint acq_targets_stage_check check (
    stage in ('target', 'warmup', 'outreach', 'reply', 'qualified', 'booked', 'showed', 'closed', 'skipped', 'dead')
  ),
  constraint acq_targets_peak_check check (
    peak_stage in ('target', 'warmup', 'outreach', 'reply', 'qualified', 'booked', 'showed', 'closed', 'skipped', 'dead')
  ),
  constraint acq_targets_lead_status_check check (
    lead_status in ('cold', 'warm', 'hot', 'converted', 'dead')
  )
);

create index if not exists acq_targets_agent_stage_idx
  on public.acq_targets (agent_id, stage, updated_at desc);

create table if not exists public.acq_warmup_steps (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  target_id uuid not null references public.acq_targets (id) on delete cascade,
  day_number integer not null,
  action text not null,
  action_count integer not null default 1,
  detail text not null default '',
  scheduled_for date not null,
  status text not null default 'pending',
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_warmup_step_unique unique (target_id, day_number, action),
  constraint acq_warmup_day_check check (day_number between 1 and 4),
  constraint acq_warmup_action_check check (
    action in ('follow', 'like_post', 'comment_reel', 'like_story', 'unfollow')
  ),
  constraint acq_warmup_status_check check (status in ('pending', 'done', 'failed', 'skipped')),
  constraint acq_warmup_count_check check (action_count between 1 and 2)
);

create index if not exists acq_warmup_queue_idx
  on public.acq_warmup_steps (agent_id, status, scheduled_for);

create table if not exists public.acq_outreach (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  target_id uuid not null unique references public.acq_targets (id) on delete cascade,
  decision text not null default 'pending',
  opener text not null default '',
  sent_result text,
  sent_at timestamptz,
  sent_notes text not null default '',
  reply_positive boolean,
  replied_at timestamptz,
  handed_off_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_outreach_decision_check check (decision in ('pending', 'send', 'skip')),
  constraint acq_outreach_result_check check (
    sent_result is null or sent_result in ('sent', 'failed', 'skipped')
  )
);

create table if not exists public.acq_bookings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  target_id uuid not null unique references public.acq_targets (id) on delete cascade,
  scheduled_at timestamptz,
  show_status text not null default 'scheduled',
  calendar_ref text,
  source text not null default 'instagram',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_bookings_show_check check (
    show_status in ('scheduled', 'showed', 'no_show', 'cancelled')
  )
);

create table if not exists public.acq_deals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete set null,
  amount_cents bigint not null,
  currency text not null default 'USD',
  closed_on date not null default (now() at time zone 'Europe/Madrid')::date,
  notes text not null default '',
  attributed boolean not null default true,
  entered_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint acq_deals_amount_check check (amount_cents >= 0),
  constraint acq_deals_currency_check check (currency ~ '^[A-Z]{3}$')
);

create index if not exists acq_deals_agent_idx on public.acq_deals (agent_id, closed_on desc);

create table if not exists public.acq_reports (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  kind text not null,
  period_start date not null,
  period_end date not null,
  summary text not null default '',
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_reports_kind_check check (kind in ('daily', 'weekly')),
  constraint acq_reports_period_unique unique (agent_id, kind, period_start)
);

create table if not exists public.acq_exceptions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  kind text not null,
  stage text,
  message text not null,
  target_id uuid references public.acq_targets (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists acq_exceptions_open_idx
  on public.acq_exceptions (agent_id, created_at desc)
  where resolved_at is null;

create table if not exists public.acq_activity (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete set null,
  voice_note_id uuid,
  role text not null default '',
  action text not null,
  result text,
  notes text not null default '',
  actor text not null default 'system',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists acq_activity_agent_idx
  on public.acq_activity (agent_id, created_at desc);
create index if not exists acq_activity_target_idx
  on public.acq_activity (target_id, created_at desc);

create table if not exists public.acq_voice_library (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  slot text not null,
  niche text,
  variant text,
  title text not null,
  script_hint text not null default '',
  storage_path text not null,
  mime_type text not null,
  byte_size integer,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_voice_slot_check check (
    slot in (
      'outreach_opener', 'gap_building', 'recovery_followup_1', 'recovery_followup_2',
      'recovery_value', 'booking_confirmation', 'pre_call_value', 'pre_call', 'reminder'
    )
  ),
  constraint acq_voice_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint acq_voice_niche_check check (niche is null or char_length(niche) between 1 and 80),
  constraint acq_voice_variant_check check (variant is null or char_length(variant) between 1 and 80),
  constraint acq_voice_path_check check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]+$'
  ),
  constraint acq_voice_mime_check check (
    mime_type in (
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
      'audio/wav', 'audio/wave', 'audio/webm', 'audio/ogg', 'audio/aac'
    )
  )
);

alter table public.acq_activity drop constraint if exists acq_activity_voice_fkey;
alter table public.acq_activity
  add constraint acq_activity_voice_fkey
  foreign key (voice_note_id) references public.acq_voice_library (id) on delete set null;

create index if not exists acq_voice_pick_idx
  on public.acq_voice_library (agent_id, slot, active, updated_at desc);

create table if not exists public.acq_voice_sends (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.acq_workspaces (id) on delete cascade,
  voice_note_id uuid not null references public.acq_voice_library (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete set null,
  slot text not null,
  result text not null,
  notes text not null default '',
  replied boolean not null default false,
  replied_at timestamptz,
  booked boolean not null default false,
  booked_at timestamptz,
  sent_at timestamptz not null default now(),
  constraint acq_voice_send_result_check check (result in ('sent', 'failed', 'skipped'))
);

create index if not exists acq_voice_sends_note_idx
  on public.acq_voice_sends (voice_note_id, sent_at desc);

create or replace function public.acq_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.acq_touch_updated_at() from public, anon, authenticated;

create or replace function public.acq_stage_rank(p_stage text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_stage
    when 'target' then 1
    when 'warmup' then 2
    when 'outreach' then 3
    when 'reply' then 4
    when 'qualified' then 5
    when 'booked' then 6
    when 'showed' then 7
    when 'closed' then 8
    else 0
  end;
$$;

revoke all on function public.acq_stage_rank(text) from public, anon, authenticated;

create or replace function public.acq_guard_target()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.id = old.id;
    new.agent_id = old.agent_id;
    new.created_at = old.created_at;
    new.handle = old.handle;
    if new.stage is distinct from old.stage then
      new.stage_changed_at = now();
    end if;
  end if;
  if public.acq_stage_rank(new.stage) > public.acq_stage_rank(new.peak_stage) then
    new.peak_stage = new.stage;
  end if;
  return new;
end;
$$;

revoke all on function public.acq_guard_target() from public, anon, authenticated;

drop trigger if exists acq_targets_touch on public.acq_targets;
create trigger acq_targets_touch
  before update on public.acq_targets
  for each row execute function public.acq_touch_updated_at();

drop trigger if exists acq_targets_guard on public.acq_targets;
create trigger acq_targets_guard
  before insert or update on public.acq_targets
  for each row execute function public.acq_guard_target();

drop trigger if exists acq_settings_touch on public.acq_settings;
create trigger acq_settings_touch
  before update on public.acq_settings
  for each row execute function public.acq_touch_updated_at();

drop trigger if exists acq_warmup_touch on public.acq_warmup_steps;
create trigger acq_warmup_touch
  before update on public.acq_warmup_steps
  for each row execute function public.acq_touch_updated_at();

drop trigger if exists acq_outreach_touch on public.acq_outreach;
create trigger acq_outreach_touch
  before update on public.acq_outreach
  for each row execute function public.acq_touch_updated_at();

drop trigger if exists acq_bookings_touch on public.acq_bookings;
create trigger acq_bookings_touch
  before update on public.acq_bookings
  for each row execute function public.acq_touch_updated_at();

drop trigger if exists acq_reports_touch on public.acq_reports;
create trigger acq_reports_touch
  before update on public.acq_reports
  for each row execute function public.acq_touch_updated_at();

drop trigger if exists acq_voice_touch on public.acq_voice_library;
create trigger acq_voice_touch
  before update on public.acq_voice_library
  for each row execute function public.acq_touch_updated_at();

create or replace function public.acq_local_today(p_tz text)
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone coalesce(nullif(btrim(p_tz), ''), 'Europe/Madrid'))::date;
$$;

create or replace function public.acq_in_quiet_hours(p_tz text, p_start time, p_end time)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  local_time time;
begin
  if p_start is null or p_end is null or p_start = p_end then
    return false;
  end if;
  local_time := (now() at time zone coalesce(nullif(btrim(p_tz), ''), 'Europe/Madrid'))::time;
  if p_start < p_end then
    return local_time >= p_start and local_time < p_end;
  end if;
  return local_time >= p_start or local_time < p_end;
end;
$$;

create or replace function public.acq_normalize_handle(raw text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  h text := lower(btrim(coalesce(raw, '')));
begin
  h := regexp_replace(h, '^https?://(www\.)?instagram\.com/', '');
  h := regexp_replace(h, '[?#].*$', '');
  h := regexp_replace(h, '/+$', '');
  h := regexp_replace(h, '^.*/', '');
  h := regexp_replace(h, '^@+', '');
  h := regexp_replace(h, '[^a-z0-9._]', '', 'g');
  if h is null or h = '' or char_length(h) > 30 then
    return null;
  end if;
  return h;
end;
$$;

create or replace function public.acq_cta_detected(p_bio text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_bio, '') ~* '(coach|coaching|agency|\msystem\M|dm me|book( a| your)? call|\mapply\M|link in bio|work with me|calendar|consult)';
$$;

create or replace function public.acq_icp_score(p_followers integer, p_cta boolean, p_source text)
returns integer
language sql
immutable
set search_path = public
as $$
  select least(100, greatest(0,
    case when p_followers between 5000 and 200000 then 45 else 0 end
    + case when coalesce(p_cta, false) then 40 else 0 end
    + case p_source
        when 'competitor_followers' then 15
        when 'keyword' then 10
        when 'hashtag' then 10
        else 5
      end
  ));
$$;

revoke all on function public.acq_local_today(text) from public, anon;
revoke all on function public.acq_in_quiet_hours(text, time, time) from public, anon;
revoke all on function public.acq_normalize_handle(text) from public, anon;
revoke all on function public.acq_cta_detected(text) from public, anon;
revoke all on function public.acq_icp_score(integer, boolean, text) from public, anon;
grant execute on function public.acq_normalize_handle(text) to authenticated, service_role;
grant execute on function public.acq_cta_detected(text) to authenticated, service_role;
grant execute on function public.acq_icp_score(integer, boolean, text) to authenticated, service_role;

create or replace function public.acq_role_on(p_agent uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_workforce
    where agent_id = p_agent and role = p_role and status = 'active'
  );
$$;

revoke all on function public.acq_role_on(uuid, text) from public, anon, authenticated;
grant execute on function public.acq_role_on(uuid, text) to service_role;

create or replace function public.acq_log(
  p_agent uuid,
  p_target uuid,
  p_role text,
  p_action text,
  p_result text,
  p_notes text,
  p_actor text,
  p_payload jsonb,
  p_voice uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.acq_activity (agent_id, target_id, voice_note_id, role, action, result, notes, actor, payload)
  values (
    p_agent,
    p_target,
    p_voice,
    coalesce(p_role, ''),
    p_action,
    p_result,
    left(coalesce(p_notes, ''), 2000),
    coalesce(nullif(p_actor, ''), 'system'),
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.acq_log(uuid, uuid, text, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.acq_log(uuid, uuid, text, text, text, text, text, jsonb, uuid) to service_role;

create or replace function public.acq_bump_role(p_agent uuid, p_role text, p_tz text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.acq_local_today(p_tz);
begin
  update public.business_workforce
    set daily_count = case when daily_count_on is distinct from v_today then 1 else daily_count + 1 end,
        daily_count_on = v_today,
        last_run_at = now(),
        last_error = p_error
    where agent_id = p_agent and role = p_role;
end;
$$;

revoke all on function public.acq_bump_role(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.acq_bump_role(uuid, text, text, text) to service_role;

create or replace function public.acq_ensure(p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles text[] := array[
    'chief_of_staff', 'icp_acquisition', 'engagement_warmup', 'personalised_outreach',
    'comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking'
  ];
  v_params jsonb[] := array[
    '{"stuck_days":3}'::jsonb,
    '{"follower_min":5000,"follower_max":200000}'::jsonb,
    '{"like_posts":2,"days":4,"comment_hint":""}'::jsonb,
    '{"min_score":70}'::jsonb,
    '{"engine":"roleflow"}'::jsonb,
    '{"engine":"roleflow"}'::jsonb,
    '{"engine":"roleflow","followup_hours":6,"followup_count":3}'::jsonb,
    '{"engine":"roleflow"}'::jsonb
  ];
  i integer;
begin
  if p_agent is null or not exists (select 1 from public.acq_workspaces where id = p_agent) then
    raise exception 'Unknown workspace';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not public.acq_can_edit(p_agent) then
    raise exception 'not allowed';
  end if;

  insert into public.acq_settings (agent_id)
  values (p_agent)
  on conflict (agent_id) do nothing;

  for i in 1..array_length(v_roles, 1) loop
    insert into public.business_workforce (agent_id, role, status, parameters)
    values (p_agent, v_roles[i], 'paused', v_params[i])
    on conflict (agent_id, role) do nothing;
  end loop;

  return jsonb_build_object('ok', true, 'agent_id', p_agent);
end;
$$;

revoke all on function public.acq_ensure(uuid) from public, anon;
grant execute on function public.acq_ensure(uuid) to authenticated, service_role;

create or replace function public.acq_open_workspace(p_name text default 'Acquisition')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := left(btrim(coalesce(nullif(p_name, ''), 'Acquisition')), 80);
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
    insert into public.acq_workspaces (owner_id, name)
    values (auth.uid(), v_name)
    returning id into v_id;
  end if;
  perform public.acq_ensure(v_id);
  return jsonb_build_object('ok', true, 'agent_id', v_id);
end;
$$;

revoke all on function public.acq_open_workspace(text) from public, anon;
grant execute on function public.acq_open_workspace(text) to authenticated;



create or replace function public.acq_schedule_warmup(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.acq_targets%rowtype;
  v_settings public.acq_settings%rowtype;
  v_start date;
  v_hint text;
begin
  select * into v_target from public.acq_targets where id = p_target;
  if v_target.id is null then
    return;
  end if;
  select * into v_settings from public.acq_settings where agent_id = v_target.agent_id;
  v_start := public.acq_local_today(v_settings.timezone);
  select nullif(btrim(coalesce(parameters->>'comment_hint', '')), '')
    into v_hint
  from public.business_workforce
  where agent_id = v_target.agent_id and role = 'engagement_warmup';

  insert into public.acq_warmup_steps (agent_id, target_id, day_number, action, action_count, detail, scheduled_for)
  values
    (v_target.agent_id, v_target.id, 1, 'follow', 1, 'Follow the account', v_start),
    (v_target.agent_id, v_target.id, 1, 'like_post', v_settings.warmup_like_count, 'Like 1-2 recent posts', v_start),
    (v_target.agent_id, v_target.id, 1, 'comment_reel', 1, coalesce(v_hint, 'Comment on one Reel'), v_start),
    (v_target.agent_id, v_target.id, 2, 'like_story', 1, 'Like their stories', v_start + v_settings.warmup_spacing_days),
    (v_target.agent_id, v_target.id, 3, 'like_story', 1, 'Like their stories', v_start + (v_settings.warmup_spacing_days * 2)),
    (v_target.agent_id, v_target.id, 4, 'unfollow', 1, 'Unfollow', v_start + (v_settings.warmup_spacing_days * 3))
  on conflict (target_id, day_number, action) do nothing;

  update public.acq_targets
    set stage = 'warmup'
    where id = v_target.id
      and public.acq_stage_rank(stage) < public.acq_stage_rank('warmup');
end;
$$;

revoke all on function public.acq_schedule_warmup(uuid) from public, anon, authenticated;
grant execute on function public.acq_schedule_warmup(uuid) to service_role;

create or replace function public.acq_open_outreach(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.acq_targets%rowtype;
  v_min integer := 70;
  v_raw text;
  v_decision text;
  v_opener text;
  v_new uuid;
begin
  select * into v_target from public.acq_targets where id = p_target;
  if v_target.id is null then
    return;
  end if;
  if exists (select 1 from public.acq_warmup_steps where target_id = p_target and status = 'pending') then
    return;
  end if;
  if exists (select 1 from public.acq_outreach where target_id = p_target) then
    return;
  end if;
  select parameters->>'min_score' into v_raw
  from public.business_workforce
  where agent_id = v_target.agent_id and role = 'personalised_outreach';
  if v_raw ~ '^[0-9]+$' then
    v_min := v_raw::integer;
  end if;
  if v_min < 0 or v_min > 100 then
    v_min := 70;
  end if;

  if v_target.cta_detected
     and v_target.followers between 5000 and 200000
     and coalesce(v_target.icp_score, 0) >= v_min then
    v_decision := 'send';
  else
    v_decision := 'skip';
  end if;
  v_opener := 'Hey ' || v_target.handle || ' — your bio is clear about the offer. I had a thought on the gap between the content and the DMs. Open to a short look?';

  insert into public.acq_outreach (agent_id, target_id, decision, opener)
  values (v_target.agent_id, v_target.id, v_decision, v_opener)
  on conflict (target_id) do nothing
  returning id into v_new;
  if v_new is null then
    return;
  end if;

  update public.acq_targets
    set stage = 'outreach'
    where id = v_target.id
      and public.acq_stage_rank(stage) < public.acq_stage_rank('outreach');

  perform public.acq_log(
    v_target.agent_id, v_target.id, 'personalised_outreach', 'outreach.decided', v_decision,
    '', 'system', jsonb_build_object('min_score', v_min, 'icp_score', v_target.icp_score)
  );
end;
$$;

revoke all on function public.acq_open_outreach(uuid) from public, anon, authenticated;
grant execute on function public.acq_open_outreach(uuid) to service_role;

create or replace function public.acq_pick_voice_note(
  p_agent uuid,
  p_slot text,
  p_niche text default null,
  p_variant text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(picked) from (
    select id, agent_id, slot, niche, variant, title, mime_type, storage_path
    from public.acq_voice_library
    where agent_id = p_agent
      and slot = p_slot
      and active
      and (niche is null or niche = nullif(btrim(coalesce(p_niche, '')), ''))
      and (
        nullif(btrim(coalesce(p_variant, '')), '') is null
        or variant is null
        or variant = nullif(btrim(p_variant), '')
      )
    order by
      case
        when nullif(btrim(coalesce(p_niche, '')), '') is not null and niche = nullif(btrim(p_niche), '') then 0
        when niche is null then 1
        else 2
      end,
      case
        when nullif(btrim(coalesce(p_variant, '')), '') is not null and variant = nullif(btrim(p_variant), '') then 0
        when variant is null then 1
        else 2
      end,
      updated_at desc
    limit 1
  ) as picked;
$$;

revoke all on function public.acq_pick_voice_note(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.acq_pick_voice_note(uuid, text, text, text) to service_role;

create or replace function public.acq_bot_ingest(p_agent uuid, p_targets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.acq_settings%rowtype;
  v_item jsonb;
  v_handle text;
  v_followers integer;
  v_bio text;
  v_cta boolean;
  v_source text;
  v_detail text;
  v_niche text;
  v_score integer;
  v_pass boolean;
  v_today date;
  v_new integer;
  v_id uuid;
  v_existing public.acq_targets%rowtype;
  v_accepted jsonb := '[]'::jsonb;
  v_held jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  if not exists (select 1 from public.acq_workspaces where id = p_agent) then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Unknown workspace.');
  end if;
  perform public.acq_ensure(p_agent);
  select * into v_settings from public.acq_settings where agent_id = p_agent;
  if jsonb_typeof(p_targets) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'targets must be an array.');
  end if;
  if jsonb_array_length(p_targets) > 50 then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Send at most 50 targets per call.');
  end if;

  v_today := public.acq_local_today(v_settings.timezone);
  select count(*) into v_new
  from public.acq_targets
  where agent_id = p_agent and added_on = v_today and stage <> 'skipped';

  for v_item in select value from jsonb_array_elements(p_targets) loop
    v_handle := public.acq_normalize_handle(v_item->>'handle');
    if v_handle is null then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('handle', left(coalesce(v_item->>'handle', ''), 80), 'reason', 'invalid_handle'));
      continue;
    end if;
    if coalesce(v_item->>'followers', '') !~ '^[0-9]+$' then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('handle', v_handle, 'reason', 'invalid_followers'));
      continue;
    end if;
    v_followers := (v_item->>'followers')::integer;
    if v_followers > 1000000000 then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('handle', v_handle, 'reason', 'invalid_followers'));
      continue;
    end if;
    v_bio := left(coalesce(v_item->>'bio', ''), 2000);
    v_source := lower(btrim(coalesce(v_item->>'source', 'manual')));
    if v_source not in ('competitor_followers', 'keyword', 'hashtag', 'manual') then
      v_source := 'manual';
    end if;
    v_detail := left(nullif(btrim(coalesce(v_item->>'source_detail', '')), ''), 200);
    v_niche := left(nullif(btrim(coalesce(v_item->>'niche', '')), ''), 80);
    v_cta := public.acq_cta_detected(v_bio)
      or lower(coalesce(v_item->>'cta_detected', '')) in ('true', 't', '1', 'yes');
    v_score := public.acq_icp_score(v_followers, v_cta, v_source);
    v_pass := v_cta and v_followers between 5000 and 200000;

    select * into v_existing from public.acq_targets where agent_id = p_agent and handle = v_handle;
    if v_existing.id is not null then
      update public.acq_targets
        set followers = v_followers,
            bio = v_bio,
            cta_detected = v_cta,
            cta_text = left(nullif(btrim(coalesce(v_item->>'cta_text', '')), ''), 200),
            source = v_source,
            source_detail = coalesce(v_detail, source_detail),
            niche = coalesce(v_niche, niche),
            icp_score = v_score,
            icp_reasons = jsonb_build_object('followers', v_followers between 5000 and 200000, 'cta', v_cta, 'source', v_source)
        where id = v_existing.id;
      if v_existing.stage = 'skipped' and v_pass and v_new < v_settings.daily_cap
         and not exists (select 1 from public.acq_warmup_steps where target_id = v_existing.id) then
        perform public.acq_schedule_warmup(v_existing.id);
        update public.acq_targets set added_on = v_today where id = v_existing.id;
        v_new := v_new + 1;
      end if;
      perform public.acq_log(p_agent, v_existing.id, 'icp_acquisition', 'target.refreshed', 'done', '', 'bot',
        jsonb_build_object('icp_score', v_score, 'pass', v_pass));
      v_accepted := v_accepted || jsonb_build_array(jsonb_build_object(
        'id', v_existing.id, 'handle', v_handle, 'icp_score', v_score, 'updated', true
      ));
      continue;
    end if;

    if v_pass and v_new >= v_settings.daily_cap then
      v_held := v_held || jsonb_build_array(jsonb_build_object('handle', v_handle, 'reason', 'daily_cap'));
      continue;
    end if;

    insert into public.acq_targets (
      agent_id, handle, followers, bio, cta_detected, cta_text, source, source_detail, niche,
      icp_score, icp_reasons, stage, peak_stage, lead_status, added_on
    ) values (
      p_agent, v_handle, v_followers, v_bio, v_cta,
      left(nullif(btrim(coalesce(v_item->>'cta_text', '')), ''), 200),
      v_source, v_detail, v_niche, v_score,
      jsonb_build_object('followers', v_followers between 5000 and 200000, 'cta', v_cta, 'source', v_source),
      case when v_pass then 'target' else 'skipped' end,
      case when v_pass then 'target' else 'skipped' end,
      'cold', v_today
    ) returning id into v_id;

    if v_pass then
      perform public.acq_schedule_warmup(v_id);
      v_new := v_new + 1;
    end if;
    perform public.acq_log(p_agent, v_id, 'icp_acquisition', 'target.ingested', case when v_pass then 'done' else 'skipped' end,
      '', 'bot', jsonb_build_object('icp_score', v_score, 'source', v_source));
    v_accepted := v_accepted || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'handle', v_handle, 'icp_score', v_score, 'stage', case when v_pass then 'warmup' else 'skipped' end
    ));
  end loop;

  update public.business_workforce
    set daily_count = v_new,
        daily_count_on = v_today,
        last_run_at = now(),
        last_error = null
    where agent_id = p_agent and role = 'icp_acquisition';

  return jsonb_build_object(
    'ok', true,
    'accepted', v_accepted,
    'held', v_held,
    'rejected', v_rejected,
    'daily_cap', v_settings.daily_cap,
    'accepted_today', v_new
  );
end;
$$;

revoke all on function public.acq_bot_ingest(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acq_bot_ingest(uuid, jsonb) to service_role;

create or replace function public.acq_bot_queue(p_agent uuid, p_limit integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.acq_settings%rowtype;
  v_today date;
  v_worked integer;
  v_remaining integer;
  v_limit integer;
  v_included uuid[] := '{}';
  v_new integer := 0;
  v_queue jsonb := '[]'::jsonb;
  v_step record;
  v_row record;
  v_already boolean;
  v_voice jsonb;
  v_reason text := null;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  if not exists (select 1 from public.acq_settings where agent_id = p_agent) then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Acquisition is not set up for this business.');
  end if;
  select * into v_settings from public.acq_settings where agent_id = p_agent;
  v_today := public.acq_local_today(v_settings.timezone);
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 50);

  if not v_settings.system_enabled then
    v_reason := 'system_off';
  elsif v_settings.ig_paused then
    v_reason := 'instagram_' || coalesce(v_settings.ig_pause_reason, 'warning');
  elsif public.acq_in_quiet_hours(v_settings.timezone, v_settings.quiet_start, v_settings.quiet_end) then
    v_reason := 'quiet_hours';
  end if;

  select count(distinct target_id) into v_worked
  from public.acq_activity
  where agent_id = p_agent
    and target_id is not null
    and action in ('warmup.reported', 'outreach.reported')
    and (created_at at time zone v_settings.timezone)::date = v_today;
  v_remaining := greatest(v_settings.daily_cap - coalesce(v_worked, 0), 0);

  if v_reason is null and public.acq_role_on(p_agent, 'engagement_warmup') then
    for v_step in
      select s.id, s.target_id, s.day_number, s.action, s.action_count, s.detail, t.handle, t.niche
      from public.acq_warmup_steps as s
      join public.acq_targets as t on t.id = s.target_id
      where s.agent_id = p_agent
        and s.status = 'pending'
        and s.scheduled_for <= v_today
        and t.stage in ('target', 'warmup')
      order by s.scheduled_for, s.day_number, s.action
      limit 200
    loop
      exit when jsonb_array_length(v_queue) >= v_limit;
      v_already := v_step.target_id = any(v_included)
        or exists (
          select 1 from public.acq_activity as a
          where a.target_id = v_step.target_id
            and a.action in ('warmup.reported', 'outreach.reported')
            and (a.created_at at time zone v_settings.timezone)::date = v_today
        );
      if not v_already then
        if v_new >= v_remaining then
          continue;
        end if;
        v_new := v_new + 1;
      end if;
      v_included := v_included || v_step.target_id;
      v_queue := v_queue || jsonb_build_array(jsonb_build_object(
        'kind', 'warmup',
        'step_id', v_step.id,
        'target_id', v_step.target_id,
        'handle', v_step.handle,
        'niche', v_step.niche,
        'profile_url', 'https://www.instagram.com/' || v_step.handle || '/',
        'day', v_step.day_number,
        'action', v_step.action,
        'count', v_step.action_count,
        'detail', v_step.detail
      ));
    end loop;
    if jsonb_array_length(v_queue) > 0 then
      update public.business_workforce set last_run_at = now()
        where agent_id = p_agent and role = 'engagement_warmup';
    end if;
  end if;

  if v_reason is null and public.acq_role_on(p_agent, 'personalised_outreach') then
    for v_row in
      select o.id, o.target_id, o.opener, t.handle, t.niche
      from public.acq_outreach as o
      join public.acq_targets as t on t.id = o.target_id
      where o.agent_id = p_agent
        and o.decision = 'send'
        and o.sent_result is null
        and t.stage = 'outreach'
        and not exists (
          select 1 from public.acq_warmup_steps as s
          where s.target_id = t.id and s.status = 'pending'
        )
      order by o.created_at
      limit 50
    loop
      exit when jsonb_array_length(v_queue) >= v_limit;
      v_already := v_row.target_id = any(v_included)
        or exists (
          select 1 from public.acq_activity as a
          where a.target_id = v_row.target_id
            and a.action in ('warmup.reported', 'outreach.reported')
            and (a.created_at at time zone v_settings.timezone)::date = v_today
        );
      if not v_already then
        if v_new >= v_remaining then
          continue;
        end if;
        v_new := v_new + 1;
      end if;
      v_included := v_included || v_row.target_id;
      v_voice := public.acq_pick_voice_note(p_agent, 'outreach_opener', v_row.niche, null);
      v_queue := v_queue || jsonb_build_array(jsonb_build_object(
        'kind', 'outreach',
        'outreach_id', v_row.id,
        'target_id', v_row.target_id,
        'handle', v_row.handle,
        'niche', v_row.niche,
        'profile_url', 'https://www.instagram.com/' || v_row.handle || '/',
        'action', 'send_dm',
        'opener', v_row.opener,
        'voice_note', v_voice
      ));
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'agent_id', p_agent,
    'date', v_today,
    'timezone', v_settings.timezone,
    'system_enabled', v_settings.system_enabled,
    'instagram_paused', v_settings.ig_paused,
    'pause_reason', v_settings.ig_pause_reason,
    'blocked_reason', v_reason,
    'quiet_hours', jsonb_build_object('start', v_settings.quiet_start, 'end', v_settings.quiet_end),
    'daily_cap', v_settings.daily_cap,
    'targets_worked_today', coalesce(v_worked, 0),
    'cap_remaining', v_remaining,
    'queue', case when v_reason is null then v_queue else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.acq_bot_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.acq_bot_queue(uuid, integer) to service_role;

create or replace function public.acq_bot_pause(p_agent uuid, p_reason text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := lower(btrim(coalesce(p_reason, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  if v_reason not in ('warning', 'challenge', 'action_block') then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'reason must be warning, challenge, or action_block.');
  end if;
  if not exists (select 1 from public.acq_settings where agent_id = p_agent) then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Acquisition is not set up for this business.');
  end if;
  update public.acq_settings
    set ig_paused = true,
        ig_pause_reason = v_reason,
        ig_pause_notes = left(coalesce(p_notes, ''), 500),
        ig_paused_at = now()
    where agent_id = p_agent;
  if not exists (
    select 1 from public.acq_exceptions
    where agent_id = p_agent and kind = 'instagram_pause' and resolved_at is null
  ) then
    insert into public.acq_exceptions (agent_id, kind, message)
    values (p_agent, 'instagram_pause', 'Instagram ' || v_reason || '. The work queue is paused until you resume it.');
  end if;
  perform public.acq_log(p_agent, null, 'chief_of_staff', 'instagram.paused', v_reason, left(coalesce(p_notes, ''), 500), 'bot', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'instagram_paused', true, 'reason', v_reason);
end;
$$;

revoke all on function public.acq_bot_pause(uuid, text, text) from public, anon, authenticated;
grant execute on function public.acq_bot_pause(uuid, text, text) to service_role;

create or replace function public.acq_bot_report(p_agent uuid, p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.acq_settings%rowtype;
  v_item jsonb;
  v_step public.acq_warmup_steps%rowtype;
  v_out public.acq_outreach%rowtype;
  v_target uuid;
  v_note uuid;
  v_send uuid;
  v_result text;
  v_event text;
  v_applied integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  select * into v_settings from public.acq_settings where agent_id = p_agent;
  if v_settings.agent_id is null then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Acquisition is not set up for this business.');
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'results must be an array.');
  end if;
  if jsonb_array_length(p_results) > 100 then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Send at most 100 results per call.');
  end if;

  for v_item in select value from jsonb_array_elements(p_results) loop
    v_event := lower(btrim(coalesce(v_item->>'event', '')));
    if v_event in ('instagram_block', 'pause') or v_item ? 'warning' then
      perform public.acq_bot_pause(
        p_agent,
        coalesce(nullif(v_item->>'reason', ''), nullif(v_item->>'warning', ''), 'warning'),
        v_item->>'notes'
      );
      v_applied := v_applied + 1;
      continue;
    end if;

    if nullif(v_item->>'step_id', '') is not null then
      v_result := lower(btrim(coalesce(v_item->>'result', '')));
      if v_result not in ('done', 'failed', 'skipped') then
        continue;
      end if;
      select * into v_step from public.acq_warmup_steps
        where id = (v_item->>'step_id')::uuid and agent_id = p_agent;
      if v_step.id is null then
        continue;
      end if;
      update public.acq_warmup_steps
        set status = v_result,
            notes = left(coalesce(v_item->>'notes', ''), 500),
            completed_at = now()
        where id = v_step.id;
      perform public.acq_log(p_agent, v_step.target_id, 'engagement_warmup', 'warmup.reported', v_result,
        v_item->>'notes', 'bot', jsonb_build_object('step_id', v_step.id, 'action', v_step.action, 'day', v_step.day_number));
      perform public.acq_bump_role(p_agent, 'engagement_warmup', v_settings.timezone, null);
      perform public.acq_open_outreach(v_step.target_id);
      v_applied := v_applied + 1;
      continue;
    end if;

    if nullif(v_item->>'outreach_id', '') is not null and v_event = '' then
      v_result := lower(btrim(coalesce(v_item->>'result', '')));
      if v_result not in ('sent', 'failed', 'skipped') then
        continue;
      end if;
      select * into v_out from public.acq_outreach
        where id = (v_item->>'outreach_id')::uuid and agent_id = p_agent;
      if v_out.id is null then
        continue;
      end if;
      update public.acq_outreach
        set sent_result = v_result,
            sent_at = now(),
            sent_notes = left(coalesce(v_item->>'notes', ''), 500)
        where id = v_out.id;
      perform public.acq_log(p_agent, v_out.target_id, 'personalised_outreach', 'outreach.reported', v_result,
        v_item->>'notes', 'bot', jsonb_build_object('outreach_id', v_out.id));
      perform public.acq_bump_role(p_agent, 'personalised_outreach', v_settings.timezone, null);
      v_applied := v_applied + 1;
      continue;
    end if;

    if v_event = 'reply' and nullif(v_item->>'target_id', '') is not null then
      v_target := (v_item->>'target_id')::uuid;
      if not exists (select 1 from public.acq_targets where id = v_target and agent_id = p_agent) then
        continue;
      end if;
      update public.acq_outreach
        set reply_positive = lower(coalesce(v_item->>'positive', '')) in ('true', 't', '1', 'yes'),
            replied_at = now(),
            handed_off_at = case
              when lower(coalesce(v_item->>'positive', '')) in ('true', 't', '1', 'yes') then now()
              else handed_off_at
            end
        where target_id = v_target;
      if lower(coalesce(v_item->>'positive', '')) in ('true', 't', '1', 'yes') then
        update public.acq_targets
          set stage = 'reply', lead_status = 'warm'
          where id = v_target and public.acq_stage_rank(stage) < public.acq_stage_rank('reply');
        perform public.acq_log(p_agent, v_target, 'qualification', 'handoff.qualification', 'done',
          v_item->>'notes', 'bot', jsonb_build_object('from', 'personalised_outreach'));
        update public.acq_voice_sends
          set replied = true, replied_at = coalesce(replied_at, now())
          where id = (
            select id from public.acq_voice_sends
            where target_id = v_target and result = 'sent'
            order by sent_at desc limit 1
          );
      else
        update public.acq_targets set lead_status = 'cold' where id = v_target and lead_status = 'cold';
      end if;
      perform public.acq_log(p_agent, v_target, 'personalised_outreach', 'outreach.reply',
        case when lower(coalesce(v_item->>'positive', '')) in ('true', 't', '1', 'yes') then 'done' else 'skipped' end,
        v_item->>'notes', 'bot', jsonb_build_object('positive', v_item->'positive'));
      v_applied := v_applied + 1;
      continue;
    end if;

    if v_event = 'voice_send' and nullif(v_item->>'voice_note_id', '') is not null then
      v_note := (v_item->>'voice_note_id')::uuid;
      v_target := nullif(v_item->>'target_id', '')::uuid;
      v_result := lower(btrim(coalesce(v_item->>'result', 'sent')));
      if v_result not in ('sent', 'failed', 'skipped') then
        continue;
      end if;
      if not exists (select 1 from public.acq_voice_library where id = v_note and agent_id = p_agent) then
        continue;
      end if;
      if v_target is not null and not exists (select 1 from public.acq_targets where id = v_target and agent_id = p_agent) then
        continue;
      end if;
      insert into public.acq_voice_sends (agent_id, voice_note_id, target_id, slot, result, notes)
      select p_agent, v_note, v_target, slot, v_result, left(coalesce(v_item->>'notes', ''), 500)
      from public.acq_voice_library where id = v_note
      returning id into v_send;
      perform public.acq_log(p_agent, v_target, 'personalised_outreach', 'voice.sent', v_result,
        v_item->>'notes', 'bot', jsonb_build_object('voice_note_id', v_note, 'send_id', v_send), v_note);
      v_applied := v_applied + 1;
      continue;
    end if;

    if v_event = 'voice_outcome' then
      if nullif(v_item->>'send_id', '') is not null then
        update public.acq_voice_sends
          set replied = replied or lower(coalesce(v_item->>'replied', '')) in ('true', 't', '1', 'yes'),
              replied_at = case
                when lower(coalesce(v_item->>'replied', '')) in ('true', 't', '1', 'yes') then coalesce(replied_at, now())
                else replied_at
              end,
              booked = booked or lower(coalesce(v_item->>'booked', '')) in ('true', 't', '1', 'yes'),
              booked_at = case
                when lower(coalesce(v_item->>'booked', '')) in ('true', 't', '1', 'yes') then coalesce(booked_at, now())
                else booked_at
              end
          where id = (v_item->>'send_id')::uuid and agent_id = p_agent;
      elsif nullif(v_item->>'voice_note_id', '') is not null then
        update public.acq_voice_sends
          set replied = replied or lower(coalesce(v_item->>'replied', '')) in ('true', 't', '1', 'yes'),
              replied_at = case
                when lower(coalesce(v_item->>'replied', '')) in ('true', 't', '1', 'yes') then coalesce(replied_at, now())
                else replied_at
              end,
              booked = booked or lower(coalesce(v_item->>'booked', '')) in ('true', 't', '1', 'yes'),
              booked_at = case
                when lower(coalesce(v_item->>'booked', '')) in ('true', 't', '1', 'yes') then coalesce(booked_at, now())
                else booked_at
              end
          where id = (
            select id from public.acq_voice_sends
            where agent_id = p_agent
              and voice_note_id = (v_item->>'voice_note_id')::uuid
              and (nullif(v_item->>'target_id', '') is null or target_id = (v_item->>'target_id')::uuid)
              and result = 'sent'
            order by sent_at desc
            limit 1
          );
      else
        continue;
      end if;
      perform public.acq_log(
        p_agent,
        nullif(v_item->>'target_id', '')::uuid,
        'qualification',
        'voice.outcome',
        'done',
        v_item->>'notes',
        'bot',
        jsonb_build_object('replied', v_item->'replied', 'booked', v_item->'booked', 'voice_note_id', v_item->'voice_note_id'),
        nullif(v_item->>'voice_note_id', '')::uuid
      );
      v_applied := v_applied + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'applied', v_applied);
exception
  when invalid_text_representation then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'A result included an invalid id.');
end;
$$;

revoke all on function public.acq_bot_report(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acq_bot_report(uuid, jsonb) to service_role;

create or replace function public.acq_bot_voice(p_agent uuid, p_slot text, p_niche text default null, p_variant text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  if p_slot not in (
    'outreach_opener', 'gap_building', 'recovery_followup_1', 'recovery_followup_2',
    'recovery_value', 'booking_confirmation', 'pre_call_value', 'pre_call', 'reminder'
  ) then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Unknown voice slot.');
  end if;
  if not exists (select 1 from public.acq_settings where agent_id = p_agent) then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Acquisition is not set up for this business.');
  end if;
  v_note := public.acq_pick_voice_note(p_agent, p_slot, p_niche, p_variant);
  return jsonb_build_object('ok', true, 'slot', p_slot, 'voice_note', v_note);
end;
$$;

revoke all on function public.acq_bot_voice(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.acq_bot_voice(uuid, text, text, text) to service_role;

create or replace function public.acq_run_chief(p_agent uuid, p_force_weekly boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.acq_settings%rowtype;
  v_today date;
  v_stuck integer := 3;
  v_raw text;
  v_stage text;
  v_count integer;
  v_bottlenecks jsonb := '[]'::jsonb;
  v_by_stage jsonb;
  v_revenue bigint;
  v_share bigint;
  v_booked integer;
  v_showed integer;
  v_show_denom integer;
  v_added integer;
  v_actions integer;
  v_summary text;
  v_body jsonb;
  v_week_start date;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.acq_can_edit(p_agent) then
    raise exception 'not allowed';
  end if;
  select * into v_settings from public.acq_settings where agent_id = p_agent;
  if v_settings.agent_id is null then
    raise exception 'Acquisition is not set up for this business';
  end if;
  select parameters->>'stuck_days' into v_raw
  from public.business_workforce
  where agent_id = p_agent and role = 'chief_of_staff';
  if v_raw ~ '^[0-9]+$' then
    v_stuck := v_raw::integer;
  end if;
  if v_stuck < 1 or v_stuck > 30 then
    v_stuck := 3;
  end if;
  v_today := public.acq_local_today(v_settings.timezone);

  for v_stage, v_count in
    select stage, count(*)::integer
    from public.acq_targets
    where agent_id = p_agent
      and stage not in ('closed', 'dead', 'skipped')
      and stage_changed_at < now() - make_interval(days => v_stuck)
    group by stage
  loop
    v_bottlenecks := v_bottlenecks || jsonb_build_array(jsonb_build_object('stage', v_stage, 'stuck', v_count));
    if not exists (
      select 1 from public.acq_exceptions
      where agent_id = p_agent and kind = 'bottleneck:' || v_stage and resolved_at is null
    ) then
      insert into public.acq_exceptions (agent_id, kind, stage, message)
      values (
        p_agent,
        'bottleneck:' || v_stage,
        v_stage,
        v_count || ' lead' || case when v_count = 1 then '' else 's' end || ' stuck in ' || v_stage || ' for more than ' || v_stuck || ' days.'
      );
    end if;
  end loop;

  select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) into v_by_stage
  from (
    select stage, count(*) as n from public.acq_targets where agent_id = p_agent group by stage
  ) as counts;

  select coalesce(sum(amount_cents), 0) into v_revenue
  from public.acq_deals where agent_id = p_agent and attributed;
  v_share := round(v_revenue * v_settings.share_bps / 10000.0);
  select count(*) into v_booked from public.acq_bookings where agent_id = p_agent;
  select count(*) into v_showed from public.acq_bookings where agent_id = p_agent and show_status = 'showed';
  select count(*) into v_show_denom from public.acq_bookings where agent_id = p_agent and show_status in ('showed', 'no_show');
  select count(*) into v_added from public.acq_targets
    where agent_id = p_agent and added_on = v_today and stage <> 'skipped';
  select count(*) into v_actions from public.acq_activity
    where agent_id = p_agent and (created_at at time zone v_settings.timezone)::date = v_today;

  v_summary := 'Cap ' || v_settings.daily_cap || '. New targets today: ' || v_added || '. Actions today: ' || v_actions || '.';
  if v_settings.ig_paused then
    v_summary := v_summary || ' Instagram is paused (' || coalesce(v_settings.ig_pause_reason, 'warning') || ').';
  end if;
  if jsonb_array_length(v_bottlenecks) > 0 then
    v_summary := v_summary || ' Bottlenecks need a look.';
  end if;

  v_body := jsonb_build_object(
    'date', v_today,
    'cap', v_settings.daily_cap,
    'targets_added', v_added,
    'actions', v_actions,
    'by_stage', v_by_stage,
    'bottlenecks', v_bottlenecks,
    'booked', v_booked,
    'showed', v_showed,
    'show_up_denominator', v_show_denom,
    'revenue_cents', v_revenue,
    'share_cents', v_share,
    'share_bps', v_settings.share_bps,
    'instagram_paused', v_settings.ig_paused,
    'system_enabled', v_settings.system_enabled
  );

  insert into public.acq_reports (agent_id, kind, period_start, period_end, summary, body)
  values (p_agent, 'daily', v_today, v_today, v_summary, v_body)
  on conflict (agent_id, kind, period_start) do update
    set summary = excluded.summary, body = excluded.body, period_end = excluded.period_end;

  if p_force_weekly or extract(isodow from v_today) = 1 then
    v_week_start := v_today - 6;
    insert into public.acq_reports (agent_id, kind, period_start, period_end, summary, body)
    values (
      p_agent,
      'weekly',
      v_week_start,
      v_today,
      'Week ending ' || v_today || '. Attributed revenue ' || (v_revenue / 100.0) || ' ' || 'USD. Share ' || (v_share / 100.0) || '.',
      v_body || jsonb_build_object('period_start', v_week_start, 'period_end', v_today)
    )
    on conflict (agent_id, kind, period_start) do update
      set summary = excluded.summary, body = excluded.body, period_end = excluded.period_end;
  end if;

  update public.business_workforce
    set last_run_at = now(), last_error = null, daily_count_on = v_today,
        daily_count = v_actions
    where agent_id = p_agent and role = 'chief_of_staff';

  perform public.acq_log(p_agent, null, 'chief_of_staff', 'report.daily', 'done', v_summary, 'system', v_body);
  return jsonb_build_object('ok', true, 'summary', v_summary, 'body', v_body);
end;
$$;

revoke all on function public.acq_run_chief(uuid, boolean) from public, anon;
grant execute on function public.acq_run_chief(uuid, boolean) to authenticated, service_role;

create or replace function public.acq_lead_status(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(raw, '')))
    when 'hot' then 'hot'
    when 'warm' then 'warm'
    when 'cold' then 'cold'
    when 'converted' then 'converted'
    when 'dead' then 'dead'
    else 'cold'
  end;
$$;

create or replace function public.acq_advance_stage(p_current text, p_incoming text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_current = 'closed' then 'closed'
    when p_incoming = 'dead' then 'dead'
    when p_incoming = 'skipped' then p_current
    when public.acq_stage_rank(p_incoming) > public.acq_stage_rank(p_current) then p_incoming
    else p_current
  end;
$$;

revoke all on function public.acq_lead_status(text) from public, anon, authenticated;
revoke all on function public.acq_advance_stage(text, text) from public, anon, authenticated;

create or replace function public.acq_ingest_tailortalk(p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.acq_settings%rowtype;
  v_tt uuid;
  v_today date;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_lead record;
  v_handle text;
  v_status text;
  v_incoming text;
  v_id uuid;
  v_current text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  end if;
  select * into v_settings from public.acq_settings where agent_id = p_agent;
  if v_settings.agent_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_workspace');
  end if;
  select tailortalk_agent_id into v_tt from public.acq_workspaces where id = p_agent;
  if v_tt is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_tailortalk_link');
  end if;
  v_today := public.acq_local_today(v_settings.timezone);

  for v_lead in
    select external_id, username, lead_name, lead_status, category, is_converted, last_message_time,
           total_followups, source, integration
    from public.tailortalk_leads
    where agent_id = v_tt
  loop
    v_handle := public.acq_normalize_handle(coalesce(v_lead.username, ''));
    if v_handle is null then
      continue;
    end if;
    v_status := public.acq_lead_status(case when v_lead.is_converted then 'converted' else v_lead.lead_status end);
    v_incoming := case
      when v_lead.is_converted or v_status = 'converted' then 'booked'
      when v_status = 'dead' then 'dead'
      when v_status in ('hot', 'warm') then 'qualified'
      else 'reply'
    end;
    select id, stage into v_id, v_current from public.acq_targets
      where agent_id = p_agent and handle = v_handle;
    if v_id is null then
      insert into public.acq_targets (
        agent_id, handle, source, source_detail, stage, peak_stage, lead_status,
        tailortalk_external_id, tt_category, last_message_at, followups, recovery_due, added_on, bio
      ) values (
        p_agent, v_handle, 'tailortalk', left(coalesce(v_lead.source, v_lead.integration, ''), 200),
        v_incoming, case when v_incoming = 'dead' then 'reply' else v_incoming end,
        v_status, v_lead.external_id, v_lead.category, v_lead.last_message_time, v_lead.total_followups,
        coalesce(v_lead.total_followups, 0) > 0
          and v_status in ('cold', 'warm')
          and v_lead.is_converted is not true
          and v_lead.last_message_time is not null
          and v_lead.last_message_time < now() - interval '3 days',
        v_today,
        ''
      ) returning id into v_id;
      perform public.acq_log(p_agent, v_id, 'comment_to_dm', 'tailortalk.inbound', 'done', '', 'tailortalk',
        jsonb_build_object('external_id', v_lead.external_id, 'stage', v_incoming, 'lead_status', v_status));
      v_inserted := v_inserted + 1;
    else
      update public.acq_targets
        set lead_status = v_status,
            stage = public.acq_advance_stage(stage, v_incoming),
            tailortalk_external_id = v_lead.external_id,
            tt_category = v_lead.category,
            last_message_at = v_lead.last_message_time,
            followups = v_lead.total_followups,
            recovery_due = coalesce(v_lead.total_followups, 0) > 0
              and v_status in ('cold', 'warm')
              and v_lead.is_converted is not true
              and v_lead.last_message_time is not null
              and v_lead.last_message_time < now() - interval '3 days'
        where id = v_id
          and (
            lead_status is distinct from v_status
            or stage is distinct from public.acq_advance_stage(stage, v_incoming)
            or tailortalk_external_id is distinct from v_lead.external_id
            or last_message_at is distinct from v_lead.last_message_time
            or recovery_due is distinct from (
              coalesce(v_lead.total_followups, 0) > 0
              and v_status in ('cold', 'warm')
              and v_lead.is_converted is not true
              and v_lead.last_message_time is not null
              and v_lead.last_message_time < now() - interval '3 days'
            )
          );
      if found then
        perform public.acq_log(p_agent, v_id, 'qualification', 'tailortalk.synced', 'done', '', 'tailortalk',
          jsonb_build_object('external_id', v_lead.external_id, 'lead_status', v_status, 'stage', v_incoming));
        v_updated := v_updated + 1;
      end if;
    end if;

    if v_lead.is_converted or v_status = 'converted' then
      insert into public.acq_bookings (agent_id, target_id, show_status, source, scheduled_at)
      values (p_agent, v_id, 'scheduled', 'tailortalk', null)
      on conflict (target_id) do nothing;
    end if;
  end loop;

  update public.business_workforce as w
    set last_run_at = now(),
        daily_count_on = v_today,
        daily_count = (
          select count(*) from public.acq_activity as a
          where a.agent_id = p_agent and a.role = w.role
            and (a.created_at at time zone v_settings.timezone)::date = v_today
        ),
        last_error = null
    where w.agent_id = p_agent
      and w.role in ('comment_to_dm', 'qualification', 'conversation_recovery', 'appointment_booking');

  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'updated', v_updated);
end;
$$;

revoke all on function public.acq_ingest_tailortalk(uuid) from public, anon, authenticated;
grant execute on function public.acq_ingest_tailortalk(uuid) to service_role;

create or replace function public.acq_after_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.attributed and new.target_id is not null then
    update public.acq_targets
      set stage = 'closed', lead_status = 'converted'
      where id = new.target_id and agent_id = new.agent_id and stage is distinct from 'closed';
  end if;
  perform public.acq_log(
    new.agent_id, new.target_id, 'appointment_booking', 'deal.recorded', 'done', new.notes, 'owner',
    jsonb_build_object('amount_cents', new.amount_cents, 'currency', new.currency, 'attributed', new.attributed, 'deal_id', new.id)
  );
  return new;
end;
$$;

revoke all on function public.acq_after_deal() from public, anon, authenticated;

drop trigger if exists acq_deals_log on public.acq_deals;
create trigger acq_deals_log
  after insert on public.acq_deals
  for each row execute function public.acq_after_deal();

create or replace function public.acq_after_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := case when coalesce(auth.role(), '') = 'service_role' then 'system' else 'owner' end;
begin
  if tg_op = 'UPDATE' and new.show_status is not distinct from old.show_status then
    return new;
  end if;
  if new.show_status = 'showed' then
    update public.acq_targets
      set stage = 'showed'
      where id = new.target_id
        and agent_id = new.agent_id
        and stage not in ('closed')
        and public.acq_stage_rank(stage) < public.acq_stage_rank('showed');
  end if;
  perform public.acq_log(
    new.agent_id, new.target_id, 'appointment_booking', 'booking.' || new.show_status, 'done', '', v_actor,
    jsonb_build_object('booking_id', new.id, 'show_status', new.show_status)
  );
  return new;
end;
$$;

revoke all on function public.acq_after_booking() from public, anon, authenticated;

drop trigger if exists acq_bookings_log on public.acq_bookings;
create trigger acq_bookings_log
  after insert or update on public.acq_bookings
  for each row execute function public.acq_after_booking();

create or replace view public.acq_voice_performance
with (security_invoker = true) as
select
  notes.id,
  notes.agent_id,
  notes.slot,
  notes.niche,
  notes.variant,
  notes.title,
  notes.active,
  notes.storage_path,
  notes.mime_type,
  count(sends.id) filter (where sends.result = 'sent') as sends,
  count(sends.id) filter (where sends.replied) as replies,
  count(sends.id) filter (where sends.booked) as bookings
from public.acq_voice_library as notes
left join public.acq_voice_sends as sends on sends.voice_note_id = notes.id
group by notes.id;

revoke all on table public.acq_voice_performance from public, anon;
grant select on table public.acq_voice_performance to authenticated, service_role;

alter table public.acq_settings enable row level security;
alter table public.acq_targets enable row level security;
alter table public.acq_warmup_steps enable row level security;
alter table public.acq_outreach enable row level security;
alter table public.acq_bookings enable row level security;
alter table public.acq_deals enable row level security;
alter table public.acq_reports enable row level security;
alter table public.acq_exceptions enable row level security;
alter table public.acq_activity enable row level security;
alter table public.acq_voice_library enable row level security;
alter table public.acq_voice_sends enable row level security;

revoke all on table public.acq_settings from public, anon;
revoke all on table public.acq_targets from public, anon;
revoke all on table public.acq_warmup_steps from public, anon;
revoke all on table public.acq_outreach from public, anon;
revoke all on table public.acq_bookings from public, anon;
revoke all on table public.acq_deals from public, anon;
revoke all on table public.acq_reports from public, anon;
revoke all on table public.acq_exceptions from public, anon;
revoke all on table public.acq_activity from public, anon;
revoke all on table public.acq_voice_library from public, anon;
revoke all on table public.acq_voice_sends from public, anon;

grant select, insert, update on table public.acq_settings to authenticated;
grant select, insert, update on table public.acq_targets to authenticated;
grant select on table public.acq_warmup_steps to authenticated;
grant select, update on table public.acq_outreach to authenticated;
grant select, insert, update on table public.acq_bookings to authenticated;
grant select, insert, update on table public.acq_deals to authenticated;
grant select on table public.acq_reports to authenticated;
grant select, update on table public.acq_exceptions to authenticated;
grant select on table public.acq_activity to authenticated;
grant select, insert, update, delete on table public.acq_voice_library to authenticated;
grant select on table public.acq_voice_sends to authenticated;

grant select, insert, update, delete on table public.acq_settings to service_role;
grant select, insert, update, delete on table public.acq_targets to service_role;
grant select, insert, update, delete on table public.acq_warmup_steps to service_role;
grant select, insert, update, delete on table public.acq_outreach to service_role;
grant select, insert, update, delete on table public.acq_bookings to service_role;
grant select, insert, update, delete on table public.acq_deals to service_role;
grant select, insert, update, delete on table public.acq_reports to service_role;
grant select, insert, update, delete on table public.acq_exceptions to service_role;
grant select, insert, update, delete on table public.acq_activity to service_role;
grant select, insert, update, delete on table public.acq_voice_library to service_role;
grant select, insert, update, delete on table public.acq_voice_sends to service_role;

drop policy if exists acq_settings_select on public.acq_settings;
create policy acq_settings_select on public.acq_settings
  for select to authenticated using (public.acq_can_read(agent_id));
drop policy if exists acq_settings_insert on public.acq_settings;
create policy acq_settings_insert on public.acq_settings
  for insert to authenticated with check (public.acq_can_edit(agent_id));
drop policy if exists acq_settings_update on public.acq_settings;
create policy acq_settings_update on public.acq_settings
  for update to authenticated
  using (public.acq_can_edit(agent_id))
  with check (public.acq_can_edit(agent_id));

drop policy if exists acq_targets_select on public.acq_targets;
create policy acq_targets_select on public.acq_targets
  for select to authenticated using (public.acq_can_read(agent_id));
drop policy if exists acq_targets_insert on public.acq_targets;
create policy acq_targets_insert on public.acq_targets
  for insert to authenticated with check (public.acq_can_edit(agent_id));
drop policy if exists acq_targets_update on public.acq_targets;
create policy acq_targets_update on public.acq_targets
  for update to authenticated
  using (public.acq_can_edit(agent_id))
  with check (public.acq_can_edit(agent_id));

drop policy if exists acq_warmup_select on public.acq_warmup_steps;
create policy acq_warmup_select on public.acq_warmup_steps
  for select to authenticated using (public.acq_can_read(agent_id));

drop policy if exists acq_outreach_select on public.acq_outreach;
create policy acq_outreach_select on public.acq_outreach
  for select to authenticated using (public.acq_can_read(agent_id));
drop policy if exists acq_outreach_update on public.acq_outreach;
create policy acq_outreach_update on public.acq_outreach
  for update to authenticated
  using (public.acq_can_edit(agent_id))
  with check (public.acq_can_edit(agent_id));

drop policy if exists acq_bookings_select on public.acq_bookings;
create policy acq_bookings_select on public.acq_bookings
  for select to authenticated using (public.acq_can_read(agent_id));
drop policy if exists acq_bookings_insert on public.acq_bookings;
create policy acq_bookings_insert on public.acq_bookings
  for insert to authenticated with check (public.acq_can_edit(agent_id));
drop policy if exists acq_bookings_update on public.acq_bookings;
create policy acq_bookings_update on public.acq_bookings
  for update to authenticated
  using (public.acq_can_edit(agent_id))
  with check (public.acq_can_edit(agent_id));

drop policy if exists acq_deals_select on public.acq_deals;
create policy acq_deals_select on public.acq_deals
  for select to authenticated using (public.acq_can_read(agent_id));
drop policy if exists acq_deals_insert on public.acq_deals;
create policy acq_deals_insert on public.acq_deals
  for insert to authenticated
  with check (public.acq_can_edit(agent_id) and (entered_by is null or entered_by = auth.uid()));
drop policy if exists acq_deals_update on public.acq_deals;
create policy acq_deals_update on public.acq_deals
  for update to authenticated
  using (public.acq_can_edit(agent_id))
  with check (public.acq_can_edit(agent_id));

drop policy if exists acq_reports_select on public.acq_reports;
create policy acq_reports_select on public.acq_reports
  for select to authenticated using (public.acq_can_read(agent_id));

drop policy if exists acq_exceptions_select on public.acq_exceptions;
create policy acq_exceptions_select on public.acq_exceptions
  for select to authenticated using (public.acq_can_read(agent_id));
drop policy if exists acq_exceptions_update on public.acq_exceptions;
create policy acq_exceptions_update on public.acq_exceptions
  for update to authenticated
  using (public.acq_can_edit(agent_id))
  with check (public.acq_can_edit(agent_id));

drop policy if exists acq_activity_select on public.acq_activity;
create policy acq_activity_select on public.acq_activity
  for select to authenticated using (public.acq_can_read(agent_id));

drop policy if exists acq_voice_select on public.acq_voice_library;
create policy acq_voice_select on public.acq_voice_library
  for select to authenticated using (public.acq_can_read(agent_id));
drop policy if exists acq_voice_insert on public.acq_voice_library;
create policy acq_voice_insert on public.acq_voice_library
  for insert to authenticated
  with check (
    public.acq_can_edit(agent_id)
    and created_by = auth.uid()
    and storage_path like agent_id::text || '/%'
  );
drop policy if exists acq_voice_update on public.acq_voice_library;
create policy acq_voice_update on public.acq_voice_library
  for update to authenticated
  using (public.acq_can_edit(agent_id))
  with check (
    public.acq_can_edit(agent_id)
    and storage_path like agent_id::text || '/%'
  );
drop policy if exists acq_voice_delete on public.acq_voice_library;
create policy acq_voice_delete on public.acq_voice_library
  for delete to authenticated using (public.acq_can_edit(agent_id));

drop policy if exists acq_voice_sends_select on public.acq_voice_sends;
create policy acq_voice_sends_select on public.acq_voice_sends
  for select to authenticated using (public.acq_can_read(agent_id));


drop policy if exists acq_workspaces_select on public.acq_workspaces;
create policy acq_workspaces_select on public.acq_workspaces
  for select to authenticated using (public.acq_can_read(id));

drop policy if exists acq_workspaces_update on public.acq_workspaces;
create policy acq_workspaces_update on public.acq_workspaces
  for update to authenticated
  using (public.acq_can_edit(id))
  with check (
    public.acq_can_edit(id)
    and owner_id = (select w.owner_id from public.acq_workspaces w where w.id = acq_workspaces.id)
  );

do $bucket$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage.buckets is missing. Create a private acq-voice bucket before uploading notes.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'acq-voice',
    'acq-voice',
    false,
    20971520,
    array[
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
      'audio/wav', 'audio/wave', 'audio/webm', 'audio/ogg', 'audio/aac'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists acq_voice_storage_read on storage.objects;
  create policy acq_voice_storage_read on storage.objects
    for select to authenticated
    using (
      bucket_id = 'acq-voice'
      and public.acq_can_read(public.storage_agent_id(name))
    );
  drop policy if exists acq_voice_storage_insert on storage.objects;
  create policy acq_voice_storage_insert on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'acq-voice'
      and public.acq_can_edit(public.storage_agent_id(name))
    );
  drop policy if exists acq_voice_storage_update on storage.objects;
  create policy acq_voice_storage_update on storage.objects
    for update to authenticated
    using (
      bucket_id = 'acq-voice'
      and public.acq_can_edit(public.storage_agent_id(name))
    )
    with check (
      bucket_id = 'acq-voice'
      and public.acq_can_edit(public.storage_agent_id(name))
    );
  drop policy if exists acq_voice_storage_delete on storage.objects;
  create policy acq_voice_storage_delete on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'acq-voice'
      and public.acq_can_edit(public.storage_agent_id(name))
    );
exception
  when others then
    raise notice 'acq-voice bucket was not created (%).', sqlerrm;
end
$bucket$;

revoke truncate, references, trigger on table
  public.acq_settings,
  public.acq_targets,
  public.acq_warmup_steps,
  public.acq_outreach,
  public.acq_bookings,
  public.acq_deals,
  public.acq_reports,
  public.acq_exceptions,
  public.acq_activity,
  public.acq_voice_library,
  public.acq_voice_sends,
  public.acq_workspaces
from anon, authenticated;
