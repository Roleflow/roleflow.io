-- NOT APPLIED.
-- The owner applies this file. It does not run against production from the
-- pull request. It does not remove any table and it does not delete prompt text.
-- Apply after 20261026120000_client_dashboard_agents.sql.
--
-- When acq_agent_prompts.body is empty, the latest deployed section
-- instructions for that workspace's linked agent are copied in stored order,
-- joined by a blank line. Each instruction string is copied unchanged.
-- Saving a prompt still does not turn an agent on. The comment-voice switch
-- is added off. A missing switch row stays off.

alter table public.acq_agent_switches drop constraint if exists acq_agent_switches_key;
alter table public.acq_agent_switches
  add constraint acq_agent_switches_key
  check (agent_key in ('warmer', 'outreacher', 'setter', 'followup', 'comment_voice'));

create table if not exists public.acq_agent_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  version integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (business_id, version),
  constraint acq_agent_prompt_versions_number check (version >= 1)
);

create index if not exists acq_agent_prompt_versions_business_idx
  on public.acq_agent_prompt_versions (business_id, version desc);

alter table public.acq_agent_prompt_versions enable row level security;
drop policy if exists acq_agent_prompt_versions_read on public.acq_agent_prompt_versions;
create policy acq_agent_prompt_versions_read on public.acq_agent_prompt_versions
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_agent_prompt_versions_write on public.acq_agent_prompt_versions;
create policy acq_agent_prompt_versions_write on public.acq_agent_prompt_versions
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));
grant select, insert, update, delete on public.acq_agent_prompt_versions to authenticated;
grant all on public.acq_agent_prompt_versions to service_role;
revoke all on public.acq_agent_prompt_versions from anon;

insert into public.acq_agent_prompts (business_id, agent_key, body, tested_at, updated_at)
select workspace.id, 'setter', imported.body, null, now()
from public.acq_workspaces as workspace
join lateral (
  select string_agg(section.el->>'instruction', E'\n\n' order by section.ord) as body
  from (
    select versions.sections
    from public.tailortalk_prompt_versions as versions
    where versions.agent_id = workspace.tailortalk_agent_id
      and jsonb_typeof(versions.sections) = 'array'
    order by versions.deployed_at desc nulls last
    limit 1
  ) as latest
  cross join lateral jsonb_array_elements(latest.sections) with ordinality as section(el, ord)
  where jsonb_typeof(section.el) = 'object'
    and section.el->>'instruction' is not null
) as imported on imported.body is not null and length(imported.body) > 0
where workspace.tailortalk_agent_id is not null
on conflict (business_id) do update
  set body = excluded.body,
      updated_at = now()
  where length(btrim(public.acq_agent_prompts.body)) = 0;

insert into public.acq_agent_prompt_versions (business_id, version, body, created_by)
select prompt.business_id, 1, prompt.body, null
from public.acq_agent_prompts as prompt
where length(btrim(prompt.body)) > 0
  and not exists (
    select 1 from public.acq_agent_prompt_versions as versions
    where versions.business_id = prompt.business_id
  );

create table if not exists public.acq_comment_voice_settings (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  daily_cap integer not null default 30,
  updated_at timestamptz not null default now(),
  constraint acq_comment_voice_cap check (daily_cap between 1 and 500)
);

create table if not exists public.acq_comment_voice_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  keywords text[] not null default '{}',
  intent text not null default '',
  message text not null default '',
  clip_id uuid,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acq_comment_voice_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  comment_id text not null default '',
  commenter_id text not null default '',
  commenter_username text not null default '',
  comment_text text not null default '',
  matched boolean not null,
  queued boolean not null default false,
  reason text not null default '',
  rule_id uuid,
  clip_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists acq_comment_voice_log_business_idx
  on public.acq_comment_voice_log (business_id, created_at desc);
create unique index if not exists acq_comment_voice_log_comment_idx
  on public.acq_comment_voice_log (business_id, comment_id)
  where comment_id <> '';

alter table public.acq_comment_voice_settings enable row level security;
alter table public.acq_comment_voice_rules enable row level security;
alter table public.acq_comment_voice_log enable row level security;

drop policy if exists acq_comment_voice_settings_read on public.acq_comment_voice_settings;
create policy acq_comment_voice_settings_read on public.acq_comment_voice_settings
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_comment_voice_settings_write on public.acq_comment_voice_settings;
create policy acq_comment_voice_settings_write on public.acq_comment_voice_settings
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_comment_voice_rules_read on public.acq_comment_voice_rules;
create policy acq_comment_voice_rules_read on public.acq_comment_voice_rules
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_comment_voice_rules_write on public.acq_comment_voice_rules;
create policy acq_comment_voice_rules_write on public.acq_comment_voice_rules
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_comment_voice_log_read on public.acq_comment_voice_log;
create policy acq_comment_voice_log_read on public.acq_comment_voice_log
  for select to authenticated using (public.acq_can_read(business_id));

grant select, insert, update, delete on public.acq_comment_voice_settings to authenticated;
grant select, insert, update, delete on public.acq_comment_voice_rules to authenticated;
grant select on public.acq_comment_voice_log to authenticated;
grant all on public.acq_comment_voice_settings to service_role;
grant all on public.acq_comment_voice_rules to service_role;
grant all on public.acq_comment_voice_log to service_role;
revoke all on public.acq_comment_voice_settings from anon;
revoke all on public.acq_comment_voice_rules from anon;
revoke all on public.acq_comment_voice_log from anon;

alter table public.ig_outbox drop constraint if exists ig_outbox_kind_check;
alter table public.ig_outbox
  add constraint ig_outbox_kind_check
  check (kind in ('reply', 'recovery', 'human', 'comment_private', 'comment_public', 'comment_voice'));

create or replace function public.acq_gateway_enqueue(
  p_business uuid,
  p_thread uuid,
  p_kind text,
  p_payload jsonb,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_kind not in ('reply', 'comment_private', 'comment_voice') then
    raise exception 'unknown kind';
  end if;
  insert into public.ig_outbox (business_id, thread_id, kind, payload, run_at, idempotency_key, transport)
  values (
    p_business,
    p_thread,
    p_kind,
    coalesce(p_payload, '{}'::jsonb) - 'api_key' - 'token' - 'authorization' - 'webhook_secret',
    now(),
    left(p_key, 200),
    'official'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.ig_outbox where idempotency_key = left(p_key, 200);
  end if;
  return v_id;
end;
$$;

-- Roleflow's booking link fills an empty field or the previous product default.
-- A link a business already chose is left as stored.
update public.acq_settings as settings
set booking_fallback_url = 'https://calendar.app.google/R4wpQ4b8F5J7xnD39'
from public.acq_workspaces as workspace
where settings.agent_id = workspace.id
  and (
    workspace.name ilike '%roleflow%'
    or workspace.id = '1351d2ac-79bb-545d-8da0-c49ecff28a47'
  )
  and settings.booking_fallback_url in (
    '',
    'https://calendar.app.google/8i1gomkozavqYU5b8'
  );
