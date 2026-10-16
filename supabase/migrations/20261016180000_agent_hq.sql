-- Agent HQ: Diego's admin workspace for the Roleflow agent team.
-- Apply after 20261015120000_businesses.sql. Requires public.is_admin().
-- Idempotent. Re-running does not duplicate the seeded roster, tasks, or schedules
-- and does not reset rows Diego has already edited.
--
-- Tables (hq_ prefix keeps them apart from tailortalk_agents / client setters):
--   hq_agents          roster
--   hq_tasks           work items. status: queued, in_progress, blocked, needs_diego, done
--   hq_task_comments   thread between Diego and the agent
--   hq_schedules       recurring task templates. timezone defaults to Europe/Madrid
--   hq_activity        activity log
--   hq_agent_keys      key prefix only, safe for the admin UI
-- The SHA-256 hash lives in private.hq_agent_key_secrets. The plaintext key is
-- returned once by hq_issue_agent_key and is never stored.
--
-- Nothing in this schema sends email, DMs, or posts. Task results are drafts.
--
-- Realtime: the tables are added to supabase_realtime when that publication exists.
-- API keys: Agents call the agent-hq edge function with X-Agent-Key. That function
-- hashes the key and calls hq_agent_dispatch, which is granted to service_role only.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.hq_agents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid,
  name text not null,
  title text not null,
  department text not null,
  reports_to uuid,
  reports_to_label text not null default '',
  status text not null default 'active',
  avatar jsonb not null default '{}'::jsonb,
  role text not null default '',
  notes text not null default '',
  standing_need text not null default '',
  outside_org boolean not null default false,
  is_lead boolean not null default false,
  sort_order integer not null default 0,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hq_tasks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null default 'queued',
  priority text not null default 'normal',
  due timestamptz,
  created_by uuid,
  result text not null default '',
  decision text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hq_task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  author_kind text not null,
  author_id uuid,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.hq_schedules (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  task_template text not null,
  cron text not null,
  timezone text not null default 'Europe/Madrid',
  enabled boolean not null default true,
  next_run timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hq_activity (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid,
  task_id uuid,
  actor text not null,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.hq_agent_keys (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists private.hq_agent_key_secrets (
  id uuid primary key,
  agent_id uuid not null,
  key_hash text not null,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.hq_agents drop constraint if exists hq_agents_status_check;
alter table public.hq_agents
  add constraint hq_agents_status_check check (status in ('active', 'paused', 'retired'));
alter table public.hq_agents drop constraint if exists hq_agents_name_check;
alter table public.hq_agents
  add constraint hq_agents_name_check check (char_length(btrim(name)) between 1 and 80);
alter table public.hq_agents drop constraint if exists hq_agents_title_check;
alter table public.hq_agents
  add constraint hq_agents_title_check check (char_length(btrim(title)) between 1 and 120);
alter table public.hq_agents drop constraint if exists hq_agents_reports_to_fkey;
alter table public.hq_agents
  add constraint hq_agents_reports_to_fkey foreign key (reports_to) references public.hq_agents (id) on delete set null;

alter table public.hq_tasks drop constraint if exists hq_tasks_agent_fkey;
alter table public.hq_tasks
  add constraint hq_tasks_agent_fkey foreign key (agent_id) references public.hq_agents (id) on delete cascade;
alter table public.hq_tasks drop constraint if exists hq_tasks_status_check;
alter table public.hq_tasks
  add constraint hq_tasks_status_check check (status in ('queued', 'in_progress', 'blocked', 'needs_diego', 'done'));
alter table public.hq_tasks drop constraint if exists hq_tasks_priority_check;
alter table public.hq_tasks
  add constraint hq_tasks_priority_check check (priority in ('low', 'normal', 'high'));
alter table public.hq_tasks drop constraint if exists hq_tasks_decision_check;
alter table public.hq_tasks
  add constraint hq_tasks_decision_check check (decision is null or decision in ('pending', 'approved', 'rejected'));
alter table public.hq_tasks drop constraint if exists hq_tasks_title_check;
alter table public.hq_tasks
  add constraint hq_tasks_title_check check (char_length(btrim(title)) between 1 and 240);
alter table public.hq_tasks drop constraint if exists hq_tasks_result_check;
alter table public.hq_tasks
  add constraint hq_tasks_result_check check (char_length(result) <= 20000);
alter table public.hq_tasks drop constraint if exists hq_tasks_created_by_fkey;
alter table public.hq_tasks
  add constraint hq_tasks_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.hq_task_comments drop constraint if exists hq_task_comments_task_fkey;
alter table public.hq_task_comments
  add constraint hq_task_comments_task_fkey foreign key (task_id) references public.hq_tasks (id) on delete cascade;
alter table public.hq_task_comments drop constraint if exists hq_task_comments_author_check;
alter table public.hq_task_comments
  add constraint hq_task_comments_author_check check (author_kind in ('diego', 'agent'));
alter table public.hq_task_comments drop constraint if exists hq_task_comments_body_check;
alter table public.hq_task_comments
  add constraint hq_task_comments_body_check check (char_length(btrim(body)) between 1 and 8000);
alter table public.hq_task_comments drop constraint if exists hq_task_comments_author_fkey;
alter table public.hq_task_comments
  add constraint hq_task_comments_author_fkey foreign key (author_id) references auth.users (id) on delete set null;

alter table public.hq_schedules drop constraint if exists hq_schedules_agent_fkey;
alter table public.hq_schedules
  add constraint hq_schedules_agent_fkey foreign key (agent_id) references public.hq_agents (id) on delete cascade;
alter table public.hq_schedules drop constraint if exists hq_schedules_cron_check;
alter table public.hq_schedules
  add constraint hq_schedules_cron_check check (btrim(cron) ~ '^[0-9*/,\-]+( [0-9*/,\-]+){4}$');
alter table public.hq_schedules drop constraint if exists hq_schedules_template_check;
alter table public.hq_schedules
  add constraint hq_schedules_template_check check (char_length(btrim(task_template)) between 1 and 500);
alter table public.hq_schedules drop constraint if exists hq_schedules_tz_check;
alter table public.hq_schedules
  add constraint hq_schedules_tz_check check (char_length(btrim(timezone)) between 1 and 80);

alter table public.hq_activity drop constraint if exists hq_activity_agent_fkey;
alter table public.hq_activity
  add constraint hq_activity_agent_fkey foreign key (agent_id) references public.hq_agents (id) on delete set null;
alter table public.hq_activity drop constraint if exists hq_activity_task_fkey;
alter table public.hq_activity
  add constraint hq_activity_task_fkey foreign key (task_id) references public.hq_tasks (id) on delete set null;

alter table public.hq_agent_keys drop constraint if exists hq_agent_keys_agent_fkey;
alter table public.hq_agent_keys
  add constraint hq_agent_keys_agent_fkey foreign key (agent_id) references public.hq_agents (id) on delete cascade;

alter table private.hq_agent_key_secrets drop constraint if exists hq_agent_key_secrets_agent_fkey;
alter table private.hq_agent_key_secrets
  add constraint hq_agent_key_secrets_agent_fkey foreign key (agent_id) references public.hq_agents (id) on delete cascade;

create unique index if not exists hq_agents_name_active_idx
  on public.hq_agents (lower(btrim(name)))
  where status <> 'retired';
create unique index if not exists hq_agents_source_id_idx
  on public.hq_agents (source_id)
  where source_id is not null;
create index if not exists hq_tasks_agent_idx on public.hq_tasks (agent_id, status);
create index if not exists hq_tasks_status_idx on public.hq_tasks (status, updated_at desc);
create index if not exists hq_task_comments_task_idx on public.hq_task_comments (task_id, created_at);
create unique index if not exists hq_schedules_template_idx on public.hq_schedules (agent_id, task_template);
create index if not exists hq_activity_created_idx on public.hq_activity (created_at desc);
create index if not exists hq_agent_keys_agent_idx on public.hq_agent_keys (agent_id, created_at desc);
create index if not exists hq_agent_key_secrets_hash_idx on private.hq_agent_key_secrets (key_hash) where revoked_at is null;

create or replace function public.hq_guard_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not allowed';
  end if;
  new.name := btrim(coalesce(new.name, ''));
  new.title := btrim(coalesce(new.title, ''));
  new.department := btrim(coalesce(new.department, ''));
  new.role := coalesce(new.role, '');
  new.notes := coalesce(new.notes, '');
  new.standing_need := coalesce(new.standing_need, '');
  new.reports_to_label := coalesce(new.reports_to_label, '');
  new.avatar := coalesce(new.avatar, '{}'::jsonb);
  new.outside_org := coalesce(new.outside_org, false);
  new.is_lead := coalesce(new.is_lead, false);
  if new.name = '' then
    raise exception 'name required';
  end if;
  if new.title = '' then
    raise exception 'title required';
  end if;
  if new.department = '' then
    raise exception 'department required';
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
    new.source_id := old.source_id;
  end if;
  new.updated_at := now();
  if new.reports_to is not null and new.reports_to = new.id then
    raise exception 'an agent cannot report to itself';
  end if;
  return new;
end;
$fn$;

create or replace function public.hq_guard_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not allowed';
  end if;
  new.title := btrim(coalesce(new.title, ''));
  new.description := coalesce(new.description, '');
  new.result := coalesce(new.result, '');
  new.priority := coalesce(nullif(new.priority, ''), 'normal');
  if new.title = '' then
    raise exception 'title required';
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'needs_diego' and new.decision is null then
      new.decision := 'pending';
    end if;
    if new.status = 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.updated_at := now();
    return new;
  end if;

  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  if auth.uid() is null and coalesce(current_setting('hq.actor', true), '') <> '' then
    new.agent_id := old.agent_id;
    new.created_by := old.created_by;
    new.title := old.title;
    new.description := old.description;
    new.priority := old.priority;
    new.due := old.due;
    if new.decision in ('approved', 'rejected') and new.decision is distinct from old.decision then
      new.decision := old.decision;
    end if;
  end if;
  if new.status = 'needs_diego' and old.status is distinct from 'needs_diego' and new.decision is null then
    new.decision := 'pending';
  end if;
  if new.status = 'done' and old.status is distinct from 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$fn$;

create or replace function public.hq_guard_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  new.body := btrim(coalesce(new.body, ''));
  if new.body = '' then
    raise exception 'comment required';
  end if;
  if auth.uid() is not null then
    if not public.is_admin() then
      raise exception 'not allowed';
    end if;
    new.author_kind := 'diego';
    new.author_id := auth.uid();
  elsif coalesce(current_setting('hq.actor', true), '') <> '' then
    new.author_kind := 'agent';
    new.author_id := null;
  end if;
  return new;
end;
$fn$;

create or replace function public.hq_guard_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not allowed';
  end if;
  new.task_template := btrim(coalesce(new.task_template, ''));
  new.cron := regexp_replace(btrim(coalesce(new.cron, '')), '\s+', ' ', 'g');
  new.timezone := coalesce(nullif(btrim(coalesce(new.timezone, '')), ''), 'Europe/Madrid');
  if new.task_template = '' then
    raise exception 'task template required';
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

create or replace function public.hq_actor()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    nullif(current_setting('hq.actor', true), ''),
    case when auth.uid() is not null then 'diego' else 'system' end
  );
$fn$;

create or replace function public.hq_log_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor text := public.hq_actor();
begin
  if current_setting('hq.skip_log', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.hq_activity (agent_id, actor, action, detail)
    values (new.id, actor, 'agent.created', actor || ' added ' || new.name || ' (' || new.title || ').');
    return new;
  end if;
  if new.status = 'retired' and old.status is distinct from 'retired' then
    insert into public.hq_activity (agent_id, actor, action, detail)
    values (new.id, actor, 'agent.retired', actor || ' retired ' || new.name || '.');
  elsif new.name is distinct from old.name
     or new.title is distinct from old.title
     or new.department is distinct from old.department
     or new.status is distinct from old.status
     or new.reports_to is distinct from old.reports_to
     or new.outside_org is distinct from old.outside_org then
    insert into public.hq_activity (agent_id, actor, action, detail)
    values (new.id, actor, 'agent.updated', actor || ' updated ' || new.name || '.');
  end if;
  return new;
end;
$fn$;

create or replace function public.hq_log_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor text := public.hq_actor();
  agent_name text;
begin
  if current_setting('hq.skip_log', true) = 'on' then
    return new;
  end if;
  select name into agent_name from public.hq_agents where id = new.agent_id;
  if tg_op = 'INSERT' then
    insert into public.hq_activity (agent_id, task_id, actor, action, detail)
    values (
      new.agent_id, new.id, actor, 'task.created',
      actor || ' created "' || left(new.title, 180) || '" for ' || coalesce(agent_name, 'an agent') || '.'
    );
    return new;
  end if;
  if new.decision is distinct from old.decision and new.decision in ('approved', 'rejected') then
    insert into public.hq_activity (agent_id, task_id, actor, action, detail)
    values (
      new.agent_id, new.id, actor, 'task.' || new.decision,
      '"' || left(new.title, 180) || '" was ' || new.decision || '.'
    );
  elsif new.status is distinct from old.status then
    insert into public.hq_activity (agent_id, task_id, actor, action, detail)
    values (
      new.agent_id, new.id, actor, 'task.status',
      '"' || left(new.title, 180) || '" moved to ' || replace(new.status, '_', ' ') || '.'
    );
  end if;
  if new.result is distinct from old.result and btrim(coalesce(new.result, '')) <> '' then
    insert into public.hq_activity (agent_id, task_id, actor, action, detail)
    values (new.agent_id, new.id, actor, 'task.output', 'Draft output saved on "' || left(new.title, 180) || '".');
  end if;
  return new;
end;
$fn$;

create or replace function public.hq_log_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor text := public.hq_actor();
  task_title text;
  task_agent uuid;
begin
  if current_setting('hq.skip_log', true) = 'on' then
    return new;
  end if;
  select title, agent_id into task_title, task_agent from public.hq_tasks where id = new.task_id;
  insert into public.hq_activity (agent_id, task_id, actor, action, detail)
  values (
    task_agent, new.task_id, actor, 'task.comment',
    actor || ' commented on "' || left(coalesce(task_title, 'a task'), 180) || '".'
  );
  return new;
end;
$fn$;

create or replace function public.hq_log_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor text := public.hq_actor();
begin
  if current_setting('hq.skip_log', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    insert into public.hq_activity (agent_id, actor, action, detail)
    values (old.agent_id, actor, 'schedule.removed', 'Removed "' || left(old.task_template, 180) || '".');
    return old;
  end if;
  if tg_op = 'INSERT' then
    insert into public.hq_activity (agent_id, actor, action, detail)
    values (new.agent_id, actor, 'schedule.created', 'Scheduled "' || left(new.task_template, 180) || '" (' || new.cron || ' ' || new.timezone || ').');
    return new;
  end if;
  if new.enabled is distinct from old.enabled then
    insert into public.hq_activity (agent_id, actor, action, detail)
    values (new.agent_id, actor, 'schedule.toggled', (case when new.enabled then 'Enabled' else 'Paused' end) || ' "' || left(new.task_template, 180) || '".');
  elsif new.cron is distinct from old.cron or new.task_template is distinct from old.task_template or new.timezone is distinct from old.timezone or new.next_run is distinct from old.next_run then
    insert into public.hq_activity (agent_id, actor, action, detail)
    values (new.agent_id, actor, 'schedule.updated', 'Updated "' || left(new.task_template, 180) || '".');
  end if;
  return new;
end;
$fn$;

create or replace function public.hq_issue_agent_key(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $fn$
declare
  v_raw text;
  v_hash text;
  v_prefix text;
  v_id uuid := gen_random_uuid();
  v_name text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select name into v_name from public.hq_agents where id = p_agent_id and status <> 'retired';
  if v_name is null then
    raise exception 'agent not found';
  end if;
  v_raw := 'rfhq_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_raw, 'sha256'), 'hex');
  v_prefix := left(v_raw, 12);
  update private.hq_agent_key_secrets
    set revoked_at = now()
    where agent_id = p_agent_id and revoked_at is null;
  update public.hq_agent_keys
    set revoked_at = now()
    where agent_id = p_agent_id and revoked_at is null;
  insert into private.hq_agent_key_secrets (id, agent_id, key_hash, key_prefix)
  values (v_id, p_agent_id, v_hash, v_prefix);
  insert into public.hq_agent_keys (id, agent_id, key_prefix)
  values (v_id, p_agent_id, v_prefix);
  insert into public.hq_activity (agent_id, actor, action, detail)
  values (p_agent_id, 'diego', 'key.issued', 'Issued an API key for ' || v_name || ' (' || v_prefix || '…). The previous active key was revoked.');
  return jsonb_build_object('id', v_id, 'api_key', v_raw, 'key_prefix', v_prefix);
end;
$fn$;

create or replace function public.hq_revoke_agent_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  v_agent uuid;
  v_prefix text;
  v_name text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select agent_id, key_prefix into v_agent, v_prefix
  from public.hq_agent_keys
  where id = p_key_id and revoked_at is null;
  if v_agent is null then
    raise exception 'key not found';
  end if;
  select name into v_name from public.hq_agents where id = v_agent;
  update public.hq_agent_keys set revoked_at = now() where id = p_key_id;
  update private.hq_agent_key_secrets set revoked_at = now() where id = p_key_id;
  insert into public.hq_activity (agent_id, actor, action, detail)
  values (v_agent, 'diego', 'key.revoked', 'Revoked API key ' || v_prefix || '… for ' || coalesce(v_name, 'an agent') || '.');
end;
$fn$;

create or replace function public.hq_agent_dispatch(p_key_hash text, p_action text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $fn$
declare
  v_agent uuid;
  v_name text;
  v_status text;
  v_task uuid;
  v_text text;
  v_tasks jsonb;
  v_schedules jsonb;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;

  select s.agent_id, a.name
    into v_agent, v_name
  from private.hq_agent_key_secrets as s
  join public.hq_agents as a on a.id = s.agent_id
  where s.key_hash = lower(p_key_hash)
    and s.revoked_at is null
    and a.status <> 'retired'
  limit 1;

  if v_agent is null then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;

  perform set_config('hq.actor', v_name, true);
  p_payload := coalesce(p_payload, '{}'::jsonb);
  p_action := lower(btrim(coalesce(p_action, '')));

  if p_action = 'list' then
    v_status := nullif(btrim(coalesce(p_payload->>'status', '')), '');
    if v_status is not null and v_status not in ('queued', 'in_progress', 'blocked', 'needs_diego', 'done') then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Unknown status.');
    end if;
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at), '[]'::jsonb)
      into v_tasks
    from (
      select t.id, t.title, t.description, t.status, t.priority, t.due, t.result, t.created_at, t.updated_at
      from public.hq_tasks as t
      where t.agent_id = v_agent
        and (
          (v_status is null and t.status in ('queued', 'in_progress', 'blocked', 'needs_diego'))
          or t.status = v_status
        )
      order by t.created_at
      limit 200
    ) as item;
    return jsonb_build_object('ok', true, 'agent', v_name, 'tasks', coalesce(v_tasks, '[]'::jsonb));
  end if;

  if p_action = 'schedules' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.next_run nulls last), '[]'::jsonb)
      into v_schedules
    from (
      select s.id, s.task_template, s.cron, s.timezone, s.enabled, s.next_run
      from public.hq_schedules as s
      where s.agent_id = v_agent and s.enabled = true
      order by s.next_run nulls last
    ) as item;
    return jsonb_build_object('ok', true, 'agent', v_name, 'schedules', coalesce(v_schedules, '[]'::jsonb));
  end if;

  if p_action not in ('status', 'output', 'comment', 'needs_diego') then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Unknown action.');
  end if;

  begin
    v_task := nullif(p_payload->>'task_id', '')::uuid;
  exception
    when invalid_text_representation then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Invalid task id.');
  end;

  if v_task is null or not exists (
    select 1 from public.hq_tasks where id = v_task and agent_id = v_agent
  ) then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Task not found.');
  end if;

  if p_action = 'comment' then
    v_text := btrim(coalesce(p_payload->>'body', ''));
    if char_length(v_text) < 1 or char_length(v_text) > 8000 then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Comment must be 1 to 8000 characters.');
    end if;
    insert into public.hq_task_comments (task_id, author_kind, body)
    values (v_task, 'agent', v_text);
    return jsonb_build_object('ok', true, 'task_id', v_task);
  end if;

  if p_action = 'needs_diego' then
    v_text := btrim(coalesce(p_payload->>'question', ''));
    if char_length(v_text) < 1 or char_length(v_text) > 8000 then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'A question is required.');
    end if;
    update public.hq_tasks
      set status = 'needs_diego',
          decision = 'pending',
          result = case
            when btrim(coalesce(p_payload->>'result', '')) <> '' then left(btrim(p_payload->>'result'), 20000)
            else result
          end
      where id = v_task;
    insert into public.hq_task_comments (task_id, author_kind, body)
    values (v_task, 'agent', v_text);
    return jsonb_build_object('ok', true, 'task_id', v_task, 'status', 'needs_diego');
  end if;

  if p_action = 'output' then
    v_text := btrim(coalesce(p_payload->>'result', ''));
    if char_length(v_text) < 1 or char_length(v_text) > 20000 then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Result must be 1 to 20000 characters.');
    end if;
    v_status := nullif(btrim(coalesce(p_payload->>'status', '')), '');
    if v_status is not null and v_status not in ('queued', 'in_progress', 'blocked', 'done') then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Use needs_diego to ask Diego.');
    end if;
    update public.hq_tasks
      set result = v_text,
          status = coalesce(v_status, status)
      where id = v_task;
    return jsonb_build_object('ok', true, 'task_id', v_task);
  end if;

  v_status := btrim(coalesce(p_payload->>'status', ''));
  if v_status not in ('queued', 'in_progress', 'blocked', 'done') then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Status must be queued, in_progress, blocked, or done.');
  end if;
  update public.hq_tasks set status = v_status where id = v_task;
  return jsonb_build_object('ok', true, 'task_id', v_task, 'status', v_status);
end;
$fn$;

drop trigger if exists hq_agents_guard on public.hq_agents;
create trigger hq_agents_guard before insert or update on public.hq_agents
  for each row execute function public.hq_guard_agent();
drop trigger if exists hq_agents_log on public.hq_agents;
create trigger hq_agents_log after insert or update on public.hq_agents
  for each row execute function public.hq_log_agent();

drop trigger if exists hq_tasks_guard on public.hq_tasks;
create trigger hq_tasks_guard before insert or update on public.hq_tasks
  for each row execute function public.hq_guard_task();
drop trigger if exists hq_tasks_log on public.hq_tasks;
create trigger hq_tasks_log after insert or update on public.hq_tasks
  for each row execute function public.hq_log_task();

drop trigger if exists hq_comments_guard on public.hq_task_comments;
create trigger hq_comments_guard before insert on public.hq_task_comments
  for each row execute function public.hq_guard_comment();
drop trigger if exists hq_comments_log on public.hq_task_comments;
create trigger hq_comments_log after insert on public.hq_task_comments
  for each row execute function public.hq_log_comment();

drop trigger if exists hq_schedules_guard on public.hq_schedules;
create trigger hq_schedules_guard before insert or update on public.hq_schedules
  for each row execute function public.hq_guard_schedule();
drop trigger if exists hq_schedules_log on public.hq_schedules;
create trigger hq_schedules_log after insert or update or delete on public.hq_schedules
  for each row execute function public.hq_log_schedule();

alter table public.hq_agents enable row level security;
alter table public.hq_tasks enable row level security;
alter table public.hq_task_comments enable row level security;
alter table public.hq_schedules enable row level security;
alter table public.hq_activity enable row level security;
alter table public.hq_agent_keys enable row level security;

revoke all on public.hq_agents from public, anon, authenticated;
revoke all on public.hq_tasks from public, anon, authenticated;
revoke all on public.hq_task_comments from public, anon, authenticated;
revoke all on public.hq_schedules from public, anon, authenticated;
revoke all on public.hq_activity from public, anon, authenticated;
revoke all on public.hq_agent_keys from public, anon, authenticated;
revoke all on private.hq_agent_key_secrets from public, anon, authenticated;

grant select, insert, update on public.hq_agents to authenticated;
grant select, insert, update on public.hq_tasks to authenticated;
grant select, insert on public.hq_task_comments to authenticated;
grant select, insert, update, delete on public.hq_schedules to authenticated;
grant select on public.hq_activity to authenticated;
grant select on public.hq_agent_keys to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.hq_agents to service_role';
    execute 'grant all on public.hq_tasks to service_role';
    execute 'grant all on public.hq_task_comments to service_role';
    execute 'grant all on public.hq_schedules to service_role';
    execute 'grant all on public.hq_activity to service_role';
    execute 'grant all on public.hq_agent_keys to service_role';
    execute 'grant all on private.hq_agent_key_secrets to service_role';
  end if;
end $$;

drop policy if exists hq_agents_select on public.hq_agents;
create policy hq_agents_select on public.hq_agents for select to authenticated using (public.is_admin());
drop policy if exists hq_agents_insert on public.hq_agents;
create policy hq_agents_insert on public.hq_agents for insert to authenticated with check (public.is_admin());
drop policy if exists hq_agents_update on public.hq_agents;
create policy hq_agents_update on public.hq_agents for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists hq_tasks_select on public.hq_tasks;
create policy hq_tasks_select on public.hq_tasks for select to authenticated using (public.is_admin());
drop policy if exists hq_tasks_insert on public.hq_tasks;
create policy hq_tasks_insert on public.hq_tasks for insert to authenticated with check (public.is_admin());
drop policy if exists hq_tasks_update on public.hq_tasks;
create policy hq_tasks_update on public.hq_tasks for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists hq_comments_select on public.hq_task_comments;
create policy hq_comments_select on public.hq_task_comments for select to authenticated using (public.is_admin());
drop policy if exists hq_comments_insert on public.hq_task_comments;
create policy hq_comments_insert on public.hq_task_comments for insert to authenticated with check (public.is_admin());

drop policy if exists hq_schedules_select on public.hq_schedules;
create policy hq_schedules_select on public.hq_schedules for select to authenticated using (public.is_admin());
drop policy if exists hq_schedules_insert on public.hq_schedules;
create policy hq_schedules_insert on public.hq_schedules for insert to authenticated with check (public.is_admin());
drop policy if exists hq_schedules_update on public.hq_schedules;
create policy hq_schedules_update on public.hq_schedules for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists hq_schedules_delete on public.hq_schedules;
create policy hq_schedules_delete on public.hq_schedules for delete to authenticated using (public.is_admin());

drop policy if exists hq_activity_select on public.hq_activity;
create policy hq_activity_select on public.hq_activity for select to authenticated using (public.is_admin());

drop policy if exists hq_keys_select on public.hq_agent_keys;
create policy hq_keys_select on public.hq_agent_keys for select to authenticated using (public.is_admin());

revoke all on function public.hq_guard_agent() from public, anon;
revoke all on function public.hq_guard_task() from public, anon;
revoke all on function public.hq_guard_comment() from public, anon;
revoke all on function public.hq_guard_schedule() from public, anon;
revoke all on function public.hq_actor() from public, anon;
revoke all on function public.hq_log_agent() from public, anon;
revoke all on function public.hq_log_task() from public, anon;
revoke all on function public.hq_log_comment() from public, anon;
revoke all on function public.hq_log_schedule() from public, anon;
grant execute on function public.hq_guard_agent() to authenticated, service_role;
grant execute on function public.hq_guard_task() to authenticated, service_role;
grant execute on function public.hq_guard_comment() to authenticated, service_role;
grant execute on function public.hq_guard_schedule() to authenticated, service_role;
grant execute on function public.hq_actor() to authenticated, service_role;
grant execute on function public.hq_log_agent() to authenticated, service_role;
grant execute on function public.hq_log_task() to authenticated, service_role;
grant execute on function public.hq_log_comment() to authenticated, service_role;
grant execute on function public.hq_log_schedule() to authenticated, service_role;

revoke all on function public.hq_issue_agent_key(uuid) from public, anon, authenticated;
grant execute on function public.hq_issue_agent_key(uuid) to authenticated;
revoke all on function public.hq_revoke_agent_key(uuid) from public, anon, authenticated;
grant execute on function public.hq_revoke_agent_key(uuid) to authenticated;
revoke all on function public.hq_agent_dispatch(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hq_agent_dispatch(text, text, jsonb) to service_role;

do $pub$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['hq_agents', 'hq_tasks', 'hq_task_comments', 'hq_schedules', 'hq_activity', 'hq_agent_keys']
    loop
      execute format('alter table public.%I replica identity full', t);
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

-- Seeded roster. Idempotent: existing names, task titles, and schedule templates are left alone.
insert into public.hq_agents (
  source_id, name, title, department, reports_to_label, status, role, notes, standing_need,
  outside_org, is_lead, sort_order, avatar, last_active_at
)
select
  v.source_id, v.name, v.title, v.department, v.reports_to_label, v.status, v.role, v.notes, v.standing_need,
  v.outside_org, v.is_lead, v.sort_order,
  jsonb_build_object('color', v.color, 'initials', v.initials),
  v.last_active_at
from (values

  ('a0c18138-08ed-49d0-867d-748e18de5130'::uuid, 'Roleflow Agent', 'Chief of Staff', 'Executive', 'Diego (CEO)', 'active', 'Coordinates all teammates, ships site PRs, Metricool setup, video ads. Includes site work formerly under Website Buildeer.', 'Website Buildeer: Merged into Roleflow Agent site work (display only; bot still exists)', 'One reply per day to the numbered digest; merge or reject PRs.', false, false, 10, '#ff2d95', 'RA', (timestamp '2026-10-15 17:19' at time zone 'Europe/Madrid')),
  ('45235141-4989-4a02-8f0b-e243ba3c5dfe'::uuid, 'Lead Gen Manager', 'Lead Gen Manager', 'Growth', 'Roleflow Agent', 'active', 'Find and qualify offer owners hiring DM setters; own prospect CRM; track competitors.', '', 'Confirm where the CRM lives (Google Sheet not connected yet).', false, true, 20, '#ff7a18', 'LG', (timestamp '2026-10-14 22:32' at time zone 'Europe/Madrid')),
  ('d03bf079-bb6e-408c-824c-fafaf889c381'::uuid, 'Outbound Rep', 'Outbound Rep (incl. Loom outreach)', 'Growth', 'Roleflow Agent', 'active', 'Per-prospect Loom openings, talking points, day 2/4/7 follow-ups; track follow-ups due. Includes Loom outreach formerly under Loom Outreacher.', 'Loom Outreacher: Merged into Outbound Rep (display only; bot still exists, no defined role or files)', 'Record and send the Looms and DMs by hand; log what was sent each day.', false, false, 21, '#ff9a4a', 'OR', (timestamp '2026-10-10 08:44' at time zone 'Europe/Madrid')),
  ('947b77fe-8e6b-496a-801a-83a618a802ac'::uuid, 'Content Generator', 'Content Generator (organic)', 'Marketing', 'Roleflow Agent', 'active', 'IG content (reels, carousels, stories) and daily engagement list; Runway video builds.', '', 'Approve the queue; post, follow and comment by hand. Pick the review day.', false, true, 30, '#ff5470', 'CG', (timestamp '2026-10-14 22:32' at time zone 'Europe/Madrid')),
  ('66dbe411-0080-4c02-ba39-407565d9e4b9'::uuid, 'Ads Manager', 'Ads Manager (paid only)', 'Marketing', 'Roleflow Agent', 'active', 'From its files: Meta static ads + campaign plan, Reddit strategy and content pack, GEO plan, website GEO build prompt, organic IG growth plan.', '', 'Decide whether to run paid ads now; set up Meta ad account and pixel if yes.', false, false, 31, '#ff7a9a', 'AM', (timestamp '2026-10-15 00:05' at time zone 'Europe/Madrid')),
  ('7e9fbd24-0b7b-4702-acb0-d5e7c46cc819'::uuid, 'Sales Operations Manager', 'Sales Operations Manager', 'Sales', 'Roleflow Agent', 'active', 'Pre-call briefs, post-call follow-ups and proposals, pipeline hygiene.', '', 'Send call notes after each call; sign and send proposals.', false, true, 40, '#c0409a', 'SO', (timestamp '2026-10-10 08:44' at time zone 'Europe/Madrid')),
  ('dff340d8-ace8-47df-baa4-a78c3a4d5979'::uuid, 'Onboarding Prompt Builder', 'Onboarding & Client Success', 'Delivery & Finance', 'Roleflow Agent', 'active', '/onboard client prompts, /qa 10-scenario tests, /report weekly client reports.', '', 'Client intake answers and voice samples; approve prompt changes before they go live.', false, true, 50, '#c04ad0', 'OP', (timestamp '2026-10-14 19:43' at time zone 'Europe/Madrid')),
  ('9925401f-6c25-45e4-9c5a-b6fa79e51017'::uuid, 'Finance Manager', 'Finance Manager', 'Delivery & Finance', 'Roleflow Agent', 'active', 'Commission calculation, invoice drafts, run-rate vs $10k goal.', '', 'Confirm the hybrid rate (33% or 3% + $250/mo); share payment data.', false, false, 51, '#9b6dff', 'FM', (timestamp '2026-10-10 08:44' at time zone 'Europe/Madrid')),
  ('ef9a059e-11da-44c7-b003-0d809e5bd249'::uuid, 'New Bot', 'UNKNOWN (no profile description)', 'Outside', 'Outside the org', 'active', 'From its files: NOT Roleflow work. Latino first-time homebuyer county analysis and pitch for ''Robert Donoso, Flagstar'' (xlsx, pdf, html, 15 Oct).', 'Not Roleflow work. Kept outside the org.', '', true, false, 90, '#555a66', 'NB', (timestamp '2026-10-15 17:19' at time zone 'Europe/Madrid'))

) as v(source_id, name, title, department, reports_to_label, status, role, notes, standing_need, outside_org, is_lead, sort_order, color, initials, last_active_at)
where not exists (select 1 from public.hq_agents existing where existing.source_id = v.source_id);


select set_config('hq.skip_log', 'on', true);

update public.hq_agents as child
set reports_to = lead.id
from public.hq_agents as lead
where lead.name = 'Roleflow Agent'
  and child.reports_to_label = 'Roleflow Agent'
  and child.reports_to is null
  and child.source_id is distinct from lead.source_id;

select set_config('hq.skip_log', 'off', true);

insert into public.hq_tasks (agent_id, title, description, status, priority, result)
select agent.id, v.title, v.description, v.status, v.priority, ''
from (values

  ('Roleflow Agent', 'Building Agent HQ dashboard', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'in_progress', 'normal'),
  ('Roleflow Agent', 'Weekly content queue workflow (needs review day)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'queued', 'normal'),
  ('Roleflow Agent', '3am DM video (on hold behind job interview skit)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'queued', 'normal'),
  ('Roleflow Agent', 'PR #14 portal: needs businesses table migration + generate-setter-prompt redeploy', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'blocked', 'high'),
  ('Lead Gen Manager', '1,000+ ICP account list, 5k-200k followers (status UNKNOWN)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'in_progress', 'normal'),
  ('Content Generator', 'Job interview skit video (render first)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'in_progress', 'normal'),
  ('Content Generator', '3am DM video', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'queued', 'normal'),
  ('Content Generator', 'Weekly content queue for Metricool', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'queued', 'normal'),
  ('Ads Manager', 'Meta campaign (launches paused, needs Meta ad account)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'queued', 'normal'),
  ('Ads Manager', 'Reddit content pack weeks 1-2 (draft, nothing posted)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'queued', 'normal'),
  ('Ads Manager', 'Meta Business Manager / ad account / Pixel not set up', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'blocked', 'high'),
  ('Sales Operations Manager', 'No calls logged to brief (UNVERIFIED)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'blocked', 'high'),
  ('Finance Manager', 'Hybrid rate unconfirmed (33% vs 3%)', 'Seeded from the 16 Oct 2026 roster. The result is a draft for Diego.', 'blocked', 'high'),
  ('Roleflow Agent', 'Confirm 5-7% stays published on roleflow.io (placeholder note is live)', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Roleflow Agent', 'Send LinkedIn, X, Crunchbase URLs or approve removing broken footer links', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Roleflow Agent', 'Merge PR #7 (search/GEO pages) or request changes', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Roleflow Agent', 'PR #14: say go ahead for migration + redeploy, or do it and merge', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Roleflow Agent', 'Merge PR #2 (client onboarding portal) and sign up as admin', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Roleflow Agent', 'Pick the day the weekly content queue is ready for review', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Finance Manager', 'Confirm hybrid rate: 33% or 3% commission + $250/mo', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Content Generator', 'Share client results (no testimonials yet) and voice samples', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Content Generator', 'Provide a demo IG account', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Roleflow Agent', 'Yes/no on tracker sheet and 8pm daily check-in', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('Ads Manager', 'Approve Reddit pack (you post); set up Meta ad account if ads are wanted', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high'),
  ('New Bot', 'Confirm whether the Flagstar homebuyer project belongs in Roleflow or should move', 'Decision for Diego. The answer stays in Agent HQ. Nothing is sent, posted, or emailed.', 'needs_diego', 'high')

) as v(agent_name, title, description, status, priority)
join public.hq_agents as agent on agent.name = v.agent_name
where not exists (
  select 1 from public.hq_tasks existing
  where existing.agent_id = agent.id and existing.title = v.title
);

insert into public.hq_schedules (agent_id, task_template, cron, timezone, enabled, next_run)
select agent.id, v.task_template, v.cron, 'Europe/Madrid', true, v.next_run
from (values

  ('Roleflow Agent', 'Daily digest to Diego: done / doing / blocked / numbered Needs Diego list', '0 8 * * *', (timestamp '2026-10-16 08:00:00' at time zone 'Europe/Madrid')),
  ('Roleflow Agent', 'Collect status from every bot, remove duplicate asks, update Agent HQ data', '30 7 * * *', (timestamp '2026-10-16 07:30:00' at time zone 'Europe/Madrid')),
  ('Roleflow Agent', 'roleflow.io check: broken links, placeholders, open PRs and preview builds', '0 10 * * 1-5', (timestamp '2026-10-16 10:00:00' at time zone 'Europe/Madrid')),
  ('Roleflow Agent', 'Weekly scorecard vs goal (Looms sent, calls held, clients live, run-rate)', '0 18 * * 5', (timestamp '2026-10-16 18:00:00' at time zone 'Europe/Madrid')),
  ('Lead Gen Manager', 'Find and qualify 40 new ICP accounts (5k-200k followers, hiring setters) into the CRM', '0 6 * * 1-5', (timestamp '2026-10-19 06:00:00' at time zone 'Europe/Madrid')),
  ('Lead Gen Manager', 'Re-check top 50 prospects for new hiring posts or offer changes', '0 14 * * 3', (timestamp '2026-10-21 14:00:00' at time zone 'Europe/Madrid')),
  ('Lead Gen Manager', 'Hand Outbound Rep the 25 best-scored prospects for tomorrow''s Looms', '0 16 * * 1-5', (timestamp '2026-10-16 16:00:00' at time zone 'Europe/Madrid')),
  ('Lead Gen Manager', 'Competitor scan (pricing, offers, content) vs competitor-research.md', '0 9 * * 1', (timestamp '2026-10-19 09:00:00' at time zone 'Europe/Madrid')),
  ('Outbound Rep', 'Write 25 Loom openings + talking points for tomorrow''s prospects', '0 17 * * 1-5', (timestamp '2026-10-16 17:00:00' at time zone 'Europe/Madrid')),
  ('Outbound Rep', 'Prepare today''s follow-up drafts (day 2 / 4 / 7) for prospects Diego contacted', '30 7 * * 1-5', (timestamp '2026-10-16 07:30:00' at time zone 'Europe/Madrid')),
  ('Outbound Rep', 'Update follow-up tracker: who is due, who replied, who is cold', '0 19 * * 1-5', (timestamp '2026-10-16 19:00:00' at time zone 'Europe/Madrid')),
  ('Outbound Rep', 'Weekly review of reply rate by niche and opening angle', '0 10 * * 6', (timestamp '2026-10-17 10:00:00' at time zone 'Europe/Madrid')),
  ('Content Generator', 'Draft the weekly content queue (4-5 reels, 2 carousels, daily stories) for Metricool', '0 9 * * 1', (timestamp '2026-10-19 09:00:00' at time zone 'Europe/Madrid')),
  ('Content Generator', 'Daily engagement list: 30 accounts to follow, 15 posts to comment on, with angles', '0 7 * * *', (timestamp '2026-10-17 07:00:00' at time zone 'Europe/Madrid')),
  ('Content Generator', 'Video build for approved concepts (Runway), credits used reported', '0 11 * * 2,4', (timestamp '2026-10-20 11:00:00' at time zone 'Europe/Madrid')),
  ('Content Generator', 'Weekly Reddit and LinkedIn/X drafts (manual posting)', '0 12 * * 3', (timestamp '2026-10-21 12:00:00' at time zone 'Europe/Madrid')),
  ('Ads Manager', 'Refresh static ad variants from site claims only (paused drafts)', '0 10 * * 2', (timestamp '2026-10-20 10:00:00' at time zone 'Europe/Madrid')),
  ('Ads Manager', 'Once an ad account exists: daily spend and CPL report', '0 9 * * *', (timestamp '2026-10-16 09:00:00' at time zone 'Europe/Madrid')),
  ('Ads Manager', 'Weekly creative test plan and kill/scale recommendations', '0 15 * * 5', (timestamp '2026-10-16 15:00:00' at time zone 'Europe/Madrid')),
  ('Sales Operations Manager', 'Call brief for every call booked for the next day', '0 18 * * *', (timestamp '2026-10-16 18:00:00' at time zone 'Europe/Madrid')),
  ('Sales Operations Manager', 'Post-call follow-up and proposal drafts from Diego''s notes', '0 20 * * 1-5', (timestamp '2026-10-16 20:00:00' at time zone 'Europe/Madrid')),
  ('Sales Operations Manager', 'Pipeline hygiene: stages, next actions, deals stale over 5 days', '0 8 * * 1,4', (timestamp '2026-10-19 08:00:00' at time zone 'Europe/Madrid')),
  ('Onboarding Prompt Builder', 'Check for new client intake; if found, draft gap list + 10-section setter prompt (target: within 24h)', '0 * * * *', (timestamp '2026-10-16 08:00:00' at time zone 'Europe/Madrid')),
  ('Onboarding Prompt Builder', 'QA monitor: 10 scripted test conversations on each live setter', '0 6 * * *', (timestamp '2026-10-17 06:00:00' at time zone 'Europe/Madrid')),
  ('Onboarding Prompt Builder', 'Weekly client report per client (conversations, response time, calls, attributed sales)', '0 9 * * 1', (timestamp '2026-10-19 09:00:00' at time zone 'Europe/Madrid')),
  ('Onboarding Prompt Builder', 'Review flagged conversations and draft prompt fixes', '0 15 * * 1-5', (timestamp '2026-10-16 15:00:00' at time zone 'Europe/Madrid')),
  ('Finance Manager', 'Commission calc from each client''s Slack payments channel data Diego provides', '0 9 * * 1', (timestamp '2026-10-19 09:00:00' at time zone 'Europe/Madrid')),
  ('Finance Manager', 'Month-end invoice drafts with full arithmetic', '0 10 1 * *', (timestamp '2026-11-01 10:00:00' at time zone 'Europe/Madrid')),
  ('Finance Manager', 'Run-rate vs $10k/month goal in the weekly scorecard', '0 17 * * 5', (timestamp '2026-10-16 17:00:00' at time zone 'Europe/Madrid'))

) as v(agent_name, task_template, cron, next_run)
join public.hq_agents as agent on agent.name = v.agent_name
where not exists (
  select 1 from public.hq_schedules existing
  where existing.agent_id = agent.id and existing.task_template = v.task_template
);

notify pgrst, 'reload schema';
