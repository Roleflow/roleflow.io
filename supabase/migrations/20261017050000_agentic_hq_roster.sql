-- Archive bots that are no longer on the Roleflow team. Retired keeps their
-- tasks, comments, schedules, and activity. Agentic HQ hides those rows.
-- Ads Manager stays on the roster and is paused. Onboarding Prompt Builder
-- is shown as Onboarding & Client Success.

select set_config('hq.skip_log', 'on', true);

update public.hq_agents
set status = 'retired'
where status <> 'retired'
  and (
    name in (
      'Loom Outreacher',
      'Website Buildeer',
      'Website Builder',
      'Sales Operations Manager',
      'Finance Manager',
      'Trading Bot',
      'New Bot',
      'Marketing Researcher'
    )
    or source_id in (
      '7e9fbd24-0b7b-4702-acb0-d5e7c46cc819'::uuid,
      '9925401f-6c25-45e4-9c5a-b6fa79e51017'::uuid,
      'ef9a059e-11da-44c7-b003-0d809e5bd249'::uuid
    )
  );

update public.hq_agents
set status = 'paused'
where status <> 'retired'
  and (
    name = 'Ads Manager'
    or source_id = '66dbe411-0080-4c02-ba39-407565d9e4b9'::uuid
  );

update public.hq_agents
set name = 'Onboarding & Client Success',
    title = 'Onboarding & Client Success'
where source_id = 'dff340d8-ace8-47df-baa4-a78c3a4d5979'::uuid
   or name = 'Onboarding Prompt Builder';

update public.hq_schedules
set enabled = false
where agent_id in (select id from public.hq_agents where status = 'retired')
  and enabled;

select set_config('hq.skip_log', 'off', true);

alter table public.hq_tasks
  add column if not exists setter_id uuid;

alter table public.hq_tasks
  drop constraint if exists hq_tasks_setter_fkey;

alter table public.hq_tasks
  add constraint hq_tasks_setter_fkey
  foreign key (setter_id) references public.tailortalk_agents (id) on delete set null;

create index if not exists hq_tasks_setter_idx on public.hq_tasks (setter_id);
