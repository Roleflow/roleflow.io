-- Task timing for the office progress bar.
-- estimate_minutes and started_at stay nullable. The office draws progress
-- from them and caps the bar at 95% until status is actually done.
-- Agents set the fields through hq_agent_dispatch action "timing".
-- That action does not change status.

alter table public.hq_tasks add column if not exists estimate_minutes integer;
alter table public.hq_tasks add column if not exists started_at timestamptz;

alter table public.hq_tasks drop constraint if exists hq_tasks_estimate_check;
alter table public.hq_tasks add constraint hq_tasks_estimate_check
  check (estimate_minutes is null or (estimate_minutes between 1 and 480));

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
  v_set_minutes boolean;
  v_set_started boolean;
  v_minutes integer;
  v_started timestamptz;
  v_estimate integer;
  v_started_out timestamptz;
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
      select t.id, t.title, t.description, t.status, t.priority, t.due, t.result,
             t.estimate_minutes, t.started_at, t.created_at, t.updated_at
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

  if p_action not in ('status', 'output', 'comment', 'needs_diego', 'timing') then
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

  if p_action = 'timing' then
    v_set_minutes := p_payload ? 'estimate_minutes';
    v_set_started := p_payload ? 'started_at';
    if not v_set_minutes and not v_set_started then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'estimate_minutes or started_at is required.');
    end if;
    v_minutes := null;
    v_started := null;
    if v_set_minutes and jsonb_typeof(p_payload->'estimate_minutes') is distinct from 'null' then
      begin
        v_minutes := (p_payload->>'estimate_minutes')::integer;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          return jsonb_build_object('ok', false, 'status', 400, 'error', 'estimate_minutes must be between 1 and 480.');
      end;
      if v_minutes is null or v_minutes < 1 or v_minutes > 480 then
        return jsonb_build_object('ok', false, 'status', 400, 'error', 'estimate_minutes must be between 1 and 480.');
      end if;
    end if;
    if v_set_started and jsonb_typeof(p_payload->'started_at') is distinct from 'null' then
      begin
        v_started := (p_payload->>'started_at')::timestamptz;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          return jsonb_build_object('ok', false, 'status', 400, 'error', 'started_at must be a timestamp.');
      end;
    end if;
    update public.hq_tasks
      set estimate_minutes = case when v_set_minutes then v_minutes else estimate_minutes end,
          started_at = case when v_set_started then v_started else started_at end
      where id = v_task
      returning estimate_minutes, started_at into v_estimate, v_started_out;
    return jsonb_build_object(
      'ok', true,
      'task_id', v_task,
      'estimate_minutes', v_estimate,
      'started_at', v_started_out
    );
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
