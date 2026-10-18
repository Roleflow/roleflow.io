-- Workforce stations share the content-factory station column.
-- A DM setter office can store leads_in, qualify, book_call, follow_up, report, and overseer.

alter table public.hq_tasks drop constraint if exists hq_tasks_station_check;
alter table public.hq_tasks
  add constraint hq_tasks_station_check check (
    station is null or station in (
      'research', 'writers_room', 'film_studio', 'edit_bay',
      'shipping_dock', 'client_floor', 'chief_of_staff',
      'mail_room', 'sales_desk', 'back_office',
      'leads_in', 'qualify', 'book_call', 'follow_up', 'report', 'overseer'
    )
  );

alter table public.hq_agents drop constraint if exists hq_agents_station_check;
alter table public.hq_agents
  add constraint hq_agents_station_check check (
    station is null or station in (
      'research', 'writers_room', 'film_studio', 'edit_bay',
      'shipping_dock', 'client_floor', 'chief_of_staff',
      'mail_room', 'sales_desk', 'back_office',
      'leads_in', 'qualify', 'book_call', 'follow_up', 'report', 'overseer'
    )
  );

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
  v_key_id uuid;
  v_business uuid;
  v_station text;
  v_title text;
  v_desc text;
  v_priority text;
  v_count integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;

  select s.agent_id, a.name, s.id
    into v_agent, v_name, v_key_id
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
             t.business_id, t.station, t.estimate_minutes, t.started_at, t.created_at, t.updated_at
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


  if p_action = 'create' then
    v_title := btrim(coalesce(p_payload->>'title', ''));
    if char_length(v_title) < 1 or char_length(v_title) > 240 then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Title must be 1 to 240 characters.');
    end if;
    v_desc := coalesce(p_payload->>'description', '');
    if char_length(v_desc) > 8000 then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Description must be 8000 characters or fewer.');
    end if;
    v_priority := 'normal';
    if p_payload ? 'priority' and jsonb_typeof(p_payload->'priority') is distinct from 'null' then
      v_priority := lower(btrim(coalesce(p_payload->>'priority', '')));
      if v_priority = '' then
        v_priority := 'normal';
      elsif v_priority not in ('low', 'normal', 'high') then
        return jsonb_build_object('ok', false, 'status', 400, 'error', 'Priority must be low, normal, or high.');
      end if;
    end if;
    v_minutes := null;
    if p_payload ? 'estimate_minutes' and jsonb_typeof(p_payload->'estimate_minutes') is distinct from 'null' then
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
    v_business := null;
    if p_payload ? 'business_id' and jsonb_typeof(p_payload->'business_id') is distinct from 'null'
       and nullif(btrim(coalesce(p_payload->>'business_id', '')), '') is not null then
      begin
        v_business := (p_payload->>'business_id')::uuid;
      exception
        when invalid_text_representation then
          return jsonb_build_object('ok', false, 'status', 400, 'error', 'Invalid business id.');
      end;
      if not exists (select 1 from public.tailortalk_agents where id = v_business) then
        return jsonb_build_object('ok', false, 'status', 400, 'error', 'Unknown business.');
      end if;
    end if;
    v_station := null;
    if p_payload ? 'station' and jsonb_typeof(p_payload->'station') is distinct from 'null'
       and nullif(btrim(coalesce(p_payload->>'station', '')), '') is not null then
      v_station := lower(btrim(p_payload->>'station'));
      if v_station not in (
        'research', 'writers_room', 'film_studio', 'edit_bay',
        'shipping_dock', 'client_floor', 'chief_of_staff',
        'mail_room', 'sales_desk', 'back_office',
        'leads_in', 'qualify', 'book_call', 'follow_up', 'report', 'overseer'
      ) then
        return jsonb_build_object('ok', false, 'status', 400, 'error', 'Station must be research, writers_room, film_studio, edit_bay, shipping_dock, client_floor, chief_of_staff, mail_room, sales_desk, back_office, leads_in, qualify, book_call, follow_up, report, or overseer.');
      end if;
    else
      select a.station into v_station from public.hq_agents as a where a.id = v_agent;
    end if;
    perform pg_advisory_xact_lock(hashtext(v_key_id::text));
    select count(*) into v_count
    from public.hq_activity
    where action = 'task.created'
      and created_at > now() - interval '24 hours'
      and position('key:' || v_key_id::text in detail) > 0;
    if v_count >= 50 then
      return jsonb_build_object('ok', false, 'status', 429, 'error', 'This key can create 50 tasks per day.');
    end if;
    perform set_config('hq.skip_log', 'on', true);
    insert into public.hq_tasks (agent_id, title, description, status, priority, estimate_minutes, business_id, station)
    values (v_agent, v_title, v_desc, 'queued', v_priority, v_minutes, v_business, v_station)
    returning id, estimate_minutes, station into v_task, v_estimate, v_station;
    perform set_config('hq.skip_log', 'off', true);
    insert into public.hq_activity (agent_id, task_id, actor, action, detail)
    values (
      v_agent,
      v_task,
      v_name,
      'task.created',
      v_name || ' created ' || chr(34) || left(v_title, 180) || chr(34) || '. key:' || v_key_id::text
    );
    return jsonb_build_object(
      'ok', true,
      'task_id', v_task,
      'agent_id', v_agent,
      'business_id', v_business,
      'station', v_station,
      'status', 'queued',
      'priority', v_priority,
      'estimate_minutes', v_estimate
    );
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
