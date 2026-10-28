-- NOT APPLIED.
-- One panel layout for every business.
-- Do not run this against production from the repo. Apply it when this pull request is merged.
-- It does not remove a table, does not delete prompt text, and does not turn a setter on.

create or replace function public.acq_section_bucket(p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_name ~* 'exclusion|highest priority' then 'exclusion'
    when p_name ~* 'objection' then 'objections'
    when p_name ~* 'non-?negotiable' then 'non_negotiables'
    when p_name ~* 'style|format|tone' then 'non_negotiables'
    when p_name ~* 'guardrail' then 'guardrails'
    when p_name ~* 'identity|mission|(^|[[:space:]])role$' then 'role'
    when p_name ~* 'qualif|conversation|workflow|follow|route|comment|verification' then 'workflow'
    else 'knowledge'
  end;
$$;

create or replace function public.acq_roleflow_sections(p_sections jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_out jsonb := jsonb_build_object(
    'exclusion', '',
    'non_negotiables', '',
    'role', '',
    'guardrails', '',
    'knowledge', '',
    'workflow', '',
    'objections', ''
  );
  v_node jsonb;
  v_title text;
  v_body text;
  v_bucket text;
  v_key text;
  v_legacy jsonb := '{"objective":"role","personality":"non_negotiables","qualification_rules":"workflow","followup_logic":"workflow","booking_logic":"workflow","notes":"knowledge"}'::jsonb;
begin
  if p_sections is null then
    return v_out;
  end if;
  if jsonb_typeof(p_sections) = 'array' then
    for v_node in select value from jsonb_array_elements(p_sections)
    loop
      if jsonb_typeof(v_node) <> 'object' then
        continue;
      end if;
      v_title := btrim(coalesce(v_node->>'node', v_node->>'title', v_node->>'id', ''));
      v_body := btrim(coalesce(v_node->>'instruction', v_node->>'text', v_node->>'body', ''));
      if v_body = '' then
        continue;
      end if;
      if v_title <> '' and position(lower(v_title) in lower(v_body)) = 0 then
        v_body := v_title || E'\n' || v_body;
      end if;
      v_bucket := public.acq_section_bucket(v_title);
      v_out := jsonb_set(
        v_out,
        array[v_bucket],
        to_jsonb(btrim(concat_ws(E'\n\n', nullif(v_out->>v_bucket, ''), v_body)))
      );
    end loop;
    return v_out;
  end if;
  if jsonb_typeof(p_sections) <> 'object' then
    return v_out;
  end if;
  foreach v_key in array array['exclusion', 'non_negotiables', 'role', 'guardrails', 'knowledge', 'workflow', 'objections']
  loop
    v_out := jsonb_set(v_out, array[v_key], to_jsonb(btrim(coalesce(p_sections->>v_key, ''))));
  end loop;
  for v_key, v_bucket in select key, value from jsonb_each_text(v_legacy)
  loop
    v_body := btrim(coalesce(p_sections->>v_key, ''));
    if v_body = '' then
      continue;
    end if;
    v_out := jsonb_set(
      v_out,
      array[v_bucket],
      to_jsonb(btrim(concat_ws(E'\n\n', nullif(v_out->>v_bucket, ''), v_body)))
    );
  end loop;
  return v_out;
end;
$$;

revoke all on function public.acq_section_bucket(text) from public, anon;
revoke all on function public.acq_roleflow_sections(jsonb) from public, anon;
grant execute on function public.acq_section_bucket(text) to authenticated, service_role;
grant execute on function public.acq_roleflow_sections(jsonb) to authenticated, service_role;

alter table public.acq_settings alter column onboarding_step set default 'live';

alter table public.acq_workspaces
  add column if not exists engine_business_id uuid;

create unique index if not exists acq_workspaces_engine_business_idx
  on public.acq_workspaces (engine_business_id)
  where engine_business_id is not null;

update public.acq_workspaces
set engine_business_id = tailortalk_agent_id
where engine_business_id is null
  and tailortalk_agent_id is not null;

update public.acq_workspaces as workspace
set tailortalk_agent_id = engine.id,
    engine_business_id = engine.id
from public.engine_registry as engine
join public.acq_setter_links as link
  on link.external_agent_id = engine.external_agent_id
where link.business_id = workspace.id
  and workspace.tailortalk_agent_id is null
  and not exists (
    select 1 from public.acq_workspaces as other
    where other.tailortalk_agent_id = engine.id
  );

insert into public.acq_workspaces (id, owner_id, name, join_code, tailortalk_agent_id, engine_business_id)
select
  engine.id,
  coalesce(client.id, diego.id),
  left(btrim(coalesce(nullif(engine.agent_name, ''), nullif(engine.label, ''), 'Business')), 80),
  lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8)),
  engine.id,
  engine.id
from public.engine_registry as engine
left join public.profiles as client on client.id = engine.client_id
left join public.profiles as diego on lower(diego.email) = 'diego@roleflow.io'
where coalesce(engine.archived, false) = false
  and coalesce(client.id, diego.id) is not null
  and not exists (
    select 1 from public.acq_workspaces as workspace
    where workspace.id = engine.id or workspace.tailortalk_agent_id = engine.id
  );

insert into public.acq_members (business_id, user_id, role, status)
select workspace.id, workspace.owner_id, 'owner', 'active'
from public.acq_workspaces as workspace
where workspace.tailortalk_agent_id is not null
on conflict (business_id, user_id) do nothing;

insert into public.acq_settings (agent_id, onboarding_step)
select workspace.id, 'live'
from public.acq_workspaces as workspace
where not exists (
  select 1 from public.acq_settings as settings where settings.agent_id = workspace.id
);

insert into public.business_workforce (agent_id, role, status, parameters)
select workspace.id, role.name, 'paused', role.parameters
from public.acq_workspaces as workspace
cross join (
  values
    ('chief_of_staff', '{"stuck_days":3}'::jsonb),
    ('icp_acquisition', '{"follower_min":5000,"follower_max":200000}'::jsonb),
    ('engagement_warmup', '{"like_posts":2,"days":4,"comment_hint":""}'::jsonb),
    ('personalised_outreach', '{"min_score":70}'::jsonb),
    ('comment_to_dm', '{"engine":"roleflow"}'::jsonb),
    ('qualification', '{"engine":"roleflow"}'::jsonb),
    ('conversation_recovery', '{"engine":"roleflow","followup_hours":6,"followup_count":3}'::jsonb),
    ('appointment_booking', '{"engine":"roleflow"}'::jsonb)
) as role(name, parameters)
where not exists (
  select 1 from public.business_workforce as existing
  where existing.agent_id = workspace.id and existing.role = role.name
);

update public.acq_prompt_versions
set sections = public.acq_roleflow_sections(sections)
where sections is distinct from public.acq_roleflow_sections(sections);

insert into public.acq_prompt_versions (business_id, role, version, sections)
select engine.id, 'inbound_manager', 1, public.acq_roleflow_sections(engine.prompt_sections)
from public.engine_registry as engine
join public.acq_workspaces as workspace on workspace.id = engine.id
where jsonb_typeof(engine.prompt_sections) = 'array'
  and jsonb_array_length(engine.prompt_sections) > 0
  and not exists (
    select 1 from public.acq_prompt_versions as versions
    where versions.business_id = workspace.id and versions.role = 'inbound_manager'
  );

insert into public.acq_prompt_current (business_id, role, version_id)
select versions.business_id, 'inbound_manager', versions.id
from public.acq_prompt_versions as versions
where versions.role = 'inbound_manager'
  and versions.version = 1
  and not exists (
    select 1 from public.acq_prompt_current as current
    where current.business_id = versions.business_id and current.role = 'inbound_manager'
  );

insert into public.acq_agent_prompts (business_id, agent_key, body, updated_at)
select workspace.id, 'setter', imported.body, now()
from public.acq_workspaces as workspace
join lateral (
  select string_agg(section.el->>'instruction', E'\n\n' order by section.ord) as body
  from public.engine_registry as engine
  cross join lateral jsonb_array_elements(engine.prompt_sections) with ordinality as section(el, ord)
  where engine.id = workspace.tailortalk_agent_id
    and jsonb_typeof(engine.prompt_sections) = 'array'
    and jsonb_typeof(section.el) = 'object'
    and coalesce(section.el->>'instruction', '') <> ''
) as imported on imported.body is not null and length(imported.body) > 0
on conflict (business_id) do update
  set body = excluded.body,
      updated_at = now()
  where length(btrim(public.acq_agent_prompts.body)) = 0;

create or replace function public.acq_create_onboarding_workspace(p_name text, p_handle text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  if v_name is null or char_length(v_name) = 0 then
    raise exception 'name required';
  end if;
  v_code := lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into public.acq_workspaces (owner_id, name, join_code)
  values (auth.uid(), v_name, v_code)
  returning id into v_id;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_id, auth.uid(), 'owner', 'active')
  on conflict (business_id, user_id) do nothing;
  perform public.acq_ensure(v_id);
  update public.business_workforce set status = 'paused' where agent_id = v_id;
  update public.acq_settings
    set system_enabled = false,
        studio_setter_sync = false,
        onboarding_step = 'live'
    where agent_id = v_id;
  if nullif(btrim(coalesce(p_handle, '')), '') is not null then
    insert into public.acq_setter_links (business_id, provider, status, requested_handle, updated_at)
    values (v_id, 'engine', 'pending', left(btrim(p_handle), 30), now())
    on conflict (business_id) do nothing;
  end if;
  return v_id;
end;
$$;
