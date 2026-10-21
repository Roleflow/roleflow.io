-- Live acquisition product: ICP fields, Grok-scored targets that stay at
-- stage 'target', pending outreach openers, and a daily Chief of Staff job.
-- Additive. Does not unschedule acquisition-tick or acq-tailortalk-sync.

alter table public.acq_settings
  add column if not exists niche text not null default '',
  add column if not exists follower_min integer not null default 5000,
  add column if not exists follower_max integer not null default 200000,
  add column if not exists cta_keywords text not null default '';

alter table public.acq_settings drop constraint if exists acq_settings_follower_min_check;
alter table public.acq_settings
  add constraint acq_settings_follower_min_check check (follower_min between 5000 and 200000);
alter table public.acq_settings drop constraint if exists acq_settings_follower_max_check;
alter table public.acq_settings
  add constraint acq_settings_follower_max_check check (follower_max between 5000 and 200000);
alter table public.acq_settings drop constraint if exists acq_settings_follower_range_check;
alter table public.acq_settings
  add constraint acq_settings_follower_range_check check (follower_max >= follower_min);

alter table public.acq_settings alter column onboarding_step set default 'profile';
alter table public.acq_settings drop constraint if exists acq_settings_onboarding_check;
alter table public.acq_settings
  add constraint acq_settings_onboarding_check check (
    onboarding_step in (
      'instagram', 'calendar', 'voice', 'knowledge', 'caps', 'live',
      'profile', 'offer', 'connect', 'worker'
    )
  );

alter table public.acq_targets
  add column if not exists recent_posts text not null default '',
  add column if not exists score_summary text not null default '',
  add column if not exists score_model text not null default '',
  add column if not exists owner_notes text not null default '';

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
    if coalesce(auth.role(), '') <> 'service_role' then
      new.followers := old.followers;
      new.bio := old.bio;
      new.cta_detected := old.cta_detected;
      new.cta_text := old.cta_text;
      new.source := old.source;
      new.source_detail := old.source_detail;
      new.icp_score := old.icp_score;
      new.icp_reasons := old.icp_reasons;
      new.recent_posts := old.recent_posts;
      new.score_summary := old.score_summary;
      new.score_model := old.score_model;
    end if;
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
  v_posts text;
  v_cta boolean;
  v_source text;
  v_detail text;
  v_niche text;
  v_score integer;
  v_qualified boolean;
  v_summary text;
  v_model text;
  v_pass boolean;
  v_min integer;
  v_max integer;
  v_today date;
  v_new integer;
  v_id uuid;
  v_existing public.acq_targets%rowtype;
  v_stage text;
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

  v_min := least(greatest(coalesce(v_settings.follower_min, 5000), 5000), 200000);
  v_max := least(greatest(coalesce(v_settings.follower_max, 200000), v_min), 200000);
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
    v_posts := left(coalesce(v_item->>'recent_posts', ''), 4000);
    v_source := lower(btrim(coalesce(v_item->>'source', 'manual')));
    if v_source not in ('competitor_followers', 'keyword', 'hashtag', 'manual') then
      v_source := 'manual';
    end if;
    v_detail := left(nullif(btrim(coalesce(v_item->>'source_detail', '')), ''), 200);
    v_niche := left(nullif(btrim(coalesce(v_item->>'niche', v_settings.niche)), ''), 80);
    v_cta := public.acq_cta_detected(v_bio)
      or lower(coalesce(v_item->>'cta_detected', '')) in ('true', 't', '1', 'yes');
    v_summary := left(coalesce(v_item->>'score_summary', ''), 500);
    v_model := left(coalesce(v_item->>'score_model', ''), 40);
    if coalesce(v_item->>'icp_score', '') ~ '^[0-9]+$' then
      v_score := least(100, greatest(0, (v_item->>'icp_score')::integer));
    else
      v_score := public.acq_icp_score(v_followers, v_cta, v_source);
      if v_model = '' then
        v_model := 'rules';
      end if;
    end if;
    if v_item ? 'qualified' then
      v_qualified := lower(coalesce(v_item->>'qualified', '')) in ('true', 't', '1', 'yes');
    else
      v_qualified := v_cta and v_followers between v_min and v_max and coalesce(v_score, 0) >= 70;
    end if;
    v_pass := v_qualified and v_followers between v_min and v_max;
    v_stage := case when v_pass then 'target' else 'skipped' end;

    select * into v_existing from public.acq_targets where agent_id = p_agent and handle = v_handle;
    if v_existing.id is not null then
      update public.acq_targets
        set followers = v_followers,
            bio = v_bio,
            recent_posts = case when v_posts <> '' then v_posts else recent_posts end,
            cta_detected = v_cta,
            cta_text = left(nullif(btrim(coalesce(v_item->>'cta_text', '')), ''), 200),
            source = v_source,
            source_detail = coalesce(v_detail, source_detail),
            niche = coalesce(v_niche, niche),
            icp_score = v_score,
            icp_reasons = jsonb_build_object(
              'followers', v_followers between v_min and v_max,
              'cta', v_cta,
              'qualified', v_pass,
              'source', v_source,
              'model', v_model
            ),
            score_summary = v_summary,
            score_model = v_model,
            stage = case
              when stage in ('skipped') and v_pass then 'target'
              else stage
            end
        where id = v_existing.id;
      perform public.acq_log(p_agent, v_existing.id, 'icp_acquisition', 'target.scored', case when v_pass then 'done' else 'skipped' end,
        v_summary, 'bot', jsonb_build_object('icp_score', v_score, 'qualified', v_pass, 'model', v_model));
      v_accepted := v_accepted || jsonb_build_array(jsonb_build_object(
        'id', v_existing.id, 'handle', v_handle, 'icp_score', v_score, 'stage', case when v_existing.stage = 'skipped' and v_pass then 'target' else v_existing.stage end, 'qualified', v_pass, 'updated', true
      ));
      continue;
    end if;

    if v_pass and v_new >= v_settings.daily_cap then
      v_held := v_held || jsonb_build_array(jsonb_build_object('handle', v_handle, 'reason', 'daily_cap'));
      continue;
    end if;

    insert into public.acq_targets (
      agent_id, handle, followers, bio, recent_posts, cta_detected, cta_text, source, source_detail, niche,
      icp_score, icp_reasons, score_summary, score_model, stage, peak_stage, lead_status, added_on
    ) values (
      p_agent, v_handle, v_followers, v_bio, v_posts, v_cta,
      left(nullif(btrim(coalesce(v_item->>'cta_text', '')), ''), 200),
      v_source, v_detail, v_niche, v_score,
      jsonb_build_object('followers', v_followers between v_min and v_max, 'cta', v_cta, 'qualified', v_pass, 'source', v_source, 'model', v_model),
      v_summary, v_model, v_stage, v_stage, 'cold', v_today
    ) returning id into v_id;

    if v_pass then
      v_new := v_new + 1;
    end if;
    perform public.acq_log(p_agent, v_id, 'icp_acquisition', 'target.scored', case when v_pass then 'done' else 'skipped' end,
      v_summary, 'bot', jsonb_build_object('icp_score', v_score, 'qualified', v_pass, 'model', v_model, 'source', v_source));
    v_accepted := v_accepted || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'handle', v_handle, 'icp_score', v_score, 'stage', v_stage, 'qualified', v_pass
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

create or replace function public.acq_open_outreach(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.acq_targets%rowtype;
  v_out public.acq_outreach%rowtype;
begin
  select * into v_target from public.acq_targets where id = p_target;
  if v_target.id is null then
    return;
  end if;
  if exists (select 1 from public.acq_warmup_steps where target_id = p_target and status = 'pending') then
    return;
  end if;
  select * into v_out from public.acq_outreach where target_id = p_target;
  if v_out.id is not null and btrim(v_out.opener) <> '' and v_out.decision in ('pending', 'send') then
    update public.acq_targets
      set stage = 'outreach'
      where id = v_target.id
        and public.acq_stage_rank(stage) < public.acq_stage_rank('outreach');
    return;
  end if;
  if v_out.id is not null then
    return;
  end if;
  if coalesce(v_target.icp_score, 0) < 70 or v_target.stage = 'skipped' then
    insert into public.acq_outreach (agent_id, target_id, decision, opener)
    values (v_target.agent_id, v_target.id, 'skip', '')
    on conflict (target_id) do nothing;
    perform public.acq_log(
      v_target.agent_id, v_target.id, 'personalised_outreach', 'outreach.decided', 'skip',
      '', 'system', jsonb_build_object('icp_score', v_target.icp_score)
    );
  end if;
end;
$$;

create or replace function public.acq_store_opener(p_target uuid, p_opener text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.acq_targets%rowtype;
  v_text text := left(btrim(coalesce(p_opener, '')), 1000);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized.');
  end if;
  if v_text = '' then
    return jsonb_build_object('ok', false, 'error', 'Opener is empty.');
  end if;
  select * into v_target from public.acq_targets where id = p_target;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'Unknown target.');
  end if;
  if exists (select 1 from public.acq_outreach where target_id = p_target and sent_result is not null) then
    return jsonb_build_object('ok', true, 'stored', false);
  end if;
  insert into public.acq_outreach (agent_id, target_id, decision, opener)
  values (v_target.agent_id, v_target.id, 'pending', v_text)
  on conflict (target_id) do update
    set opener = excluded.opener,
        decision = 'pending'
    where public.acq_outreach.sent_result is null;
  perform public.acq_log(
    v_target.agent_id, v_target.id, 'personalised_outreach', 'outreach.drafted', 'pending',
    v_text, 'system', jsonb_build_object('model', 'grok-4.3')
  );
  update public.business_workforce
    set last_run_at = now(), last_error = null
    where agent_id = v_target.agent_id and role = 'personalised_outreach';
  return jsonb_build_object('ok', true, 'stored', true, 'target_id', v_target.id);
end;
$$;

revoke all on function public.acq_store_opener(uuid, text) from public, anon, authenticated;
grant execute on function public.acq_store_opener(uuid, text) to service_role;

create or replace function public.acq_openers_needed(p_agent uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  from (
    select t.id, t.handle, t.bio, t.recent_posts, coalesce(t.niche, '') as niche
    from public.acq_targets as t
    where t.agent_id = p_agent
      and t.stage in ('target', 'warmup', 'outreach')
      and coalesce(t.icp_score, 0) >= 70
      and not exists (
        select 1 from public.acq_outreach as o
        where o.target_id = t.id and length(btrim(o.opener)) > 0
      )
    order by t.icp_score desc nulls last, t.created_at
    limit 8
  ) as q;
$$;

revoke all on function public.acq_openers_needed(uuid) from public, anon, authenticated;
grant execute on function public.acq_openers_needed(uuid) to service_role;

create or replace function public.acq_build_work_queue(p_agent uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.acq_settings%rowtype;
  v_today date;
  v_room integer;
  v_target uuid;
  v_queued integer := 0;
  v_warmup integer := 0;
  v_outreach integer := 0;
begin
  select * into v_settings from public.acq_settings where agent_id = p_agent;
  if v_settings.agent_id is null then
    return jsonb_build_object('ok', false, 'error', 'Acquisition is not set up for this business.');
  end if;
  v_today := public.acq_local_today(v_settings.timezone);
  if v_settings.system_enabled and public.acq_role_on(p_agent, 'engagement_warmup') then
    select count(*) into v_room
    from public.acq_targets
    where agent_id = p_agent
      and added_on = v_today
      and stage not in ('skipped', 'target');
    v_room := greatest(v_settings.daily_cap - coalesce(v_room, 0), 0);
    for v_target in
      select id from public.acq_targets
      where agent_id = p_agent
        and stage = 'target'
        and coalesce(icp_score, 0) >= 70
      order by icp_score desc nulls last, created_at
      limit v_room
    loop
      perform public.acq_schedule_warmup(v_target);
      v_queued := v_queued + 1;
    end loop;
  end if;
  select count(*) into v_warmup
  from public.acq_warmup_steps
  where agent_id = p_agent and status = 'pending' and scheduled_for <= v_today;
  select count(*) into v_outreach
  from public.acq_outreach
  where agent_id = p_agent and decision in ('pending', 'send') and sent_result is null and btrim(opener) <> '';
  return jsonb_build_object(
    'ok', true,
    'warmup_queued', v_queued,
    'warmup_due', v_warmup,
    'outreach_pending', v_outreach,
    'daily_cap', v_settings.daily_cap
  );
end;
$$;

revoke all on function public.acq_build_work_queue(uuid) from public, anon, authenticated;
grant execute on function public.acq_build_work_queue(uuid) to service_role;

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
        and o.decision in ('pending', 'send')
        and o.sent_result is null
        and btrim(o.opener) <> ''
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
  v_pending integer;
  v_queue jsonb;
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
  v_queue := public.acq_build_work_queue(p_agent);
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
  select count(*) into v_pending from public.acq_outreach
    where agent_id = p_agent and decision = 'pending' and sent_result is null and btrim(opener) <> '';

  v_summary := 'Cap ' || v_settings.daily_cap
    || '. New targets today: ' || v_added
    || '. Warm-up queued: ' || coalesce((v_queue->>'warmup_queued')::integer, 0)
    || '. Pending openers: ' || coalesce(v_pending, 0)
    || '. Actions today: ' || v_actions || '.';
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
    'pending_openers', v_pending,
    'work_queue', v_queue,
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
      'Week ending ' || v_today || '. Attributed revenue ' || (v_revenue / 100.0) || '. Roleflow share ' || (v_share / 100.0) || '.',
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

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, then re-run to schedule acq-chief-daily.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('acq-chief-daily');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'acq-chief-daily',
    '15 6 * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acquisition-bot',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select value from private.acquisition_settings where key = 'cron_secret'), '')
      ),
      body := '{"action":"chief_daily"}'::jsonb,
      timeout_milliseconds := 120000
    );
    $job$
  );
end
$cron$;
