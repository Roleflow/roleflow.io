-- Repo copy of the outbound worker pipeline already applied on production.
-- Applied as acq_outbound_worker_pipeline, acq_worker_pipeline_role_inference,
-- and acq_worker_pipeline_daily_counts. Do not run this file again.

-- Outbound prospect pipeline: extra tracking on acq_targets + worker-key RPC for daily routines.
alter table public.acq_targets
  add column if not exists full_name text not null default '',
  add column if not exists warm_actions integer not null default 0,
  add column if not exists last_action_at timestamptz,
  add column if not exists warmed_at timestamptz,
  add column if not exists dm_sent_at timestamptz,
  add column if not exists replied_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'acq_targets_warm_actions_check') then
    alter table public.acq_targets add constraint acq_targets_warm_actions_check check (warm_actions >= 0);
  end if;
end $$;

create index if not exists acq_targets_agent_stage_idx on public.acq_targets (agent_id, stage, icp_score desc);
create index if not exists acq_activity_agent_created_idx on public.acq_activity (agent_id, created_at desc);

-- Pipeline vocabulary -> panel stage
create or replace function public.acq_pipeline_stage(p text)
returns text language sql immutable set search_path to 'public' as $$
  select case lower(coalesce(p, ''))
    when 'found' then 'target' when 'warming' then 'warmup' when 'warmed' then 'warmup'
    when 'dm_sent' then 'outreach' when 'replied' then 'reply' when 'won' then 'closed'
    when 'lost' then 'dead' when 'dnc' then 'dead'
    when 'target' then 'target' when 'warmup' then 'warmup' when 'outreach' then 'outreach'
    when 'reply' then 'reply' when 'qualified' then 'qualified' when 'booked' then 'booked'
    when 'showed' then 'showed' when 'closed' then 'closed' when 'skipped' then 'skipped'
    when 'dead' then 'dead' else null end;
$$;

create or replace function public.acq_pipeline_role(p text)
returns text language sql immutable set search_path to 'public' as $$
  select case lower(coalesce(p, ''))
    when 'lead_finder' then 'icp_acquisition' when 'finder' then 'icp_acquisition' when 'icp' then 'icp_acquisition'
    when 'warmup' then 'engagement_warmup' when 'warm_up' then 'engagement_warmup'
    when 'outreach' then 'personalised_outreach' when 'followup' then 'conversation_recovery'
    when 'follow_up' then 'conversation_recovery' when 'setter' then 'qualification'
    when 'chief' then 'chief_of_staff'
    else lower(coalesce(p, '')) end;
$$;

create or replace function public.acq_worker_pipeline(p_key text, p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
          coalesce(v_item->>'why_fit', ''), 'grok-routine',
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

revoke all on function public.acq_worker_pipeline(text, text, jsonb) from public;
grant execute on function public.acq_worker_pipeline(text, text, jsonb) to anon, authenticated, service_role;
