-- Phase 2: follow-ups, reminders, comment and story calls to action.
-- Additive. Nothing here sends a message.

alter table public.acq_settings
  add column if not exists followup_restart_on_reply boolean not null default false,
  add column if not exists followup_before_close boolean not null default false;

alter table public.acq_message_queue
  add column if not exists send_at timestamptz;

create table if not exists public.acq_followup_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  hours integer not null,
  mode text not null,
  body text not null,
  crm_state text,
  asset_id uuid references public.acq_value_assets (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint acq_followup_steps_hours_check check (hours between 1 and 23),
  constraint acq_followup_steps_mode_check check (mode in ('ai', 'text')),
  constraint acq_followup_steps_state_check check (
    crm_state is null or crm_state in ('open', 'discovering', 'qualifying', 'proposal', 'booked', 'paid', 'lost', 'unqualified', 'postponed')
  )
);

create table if not exists public.acq_welcome_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  position integer not null,
  delay_hours numeric not null default 0,
  mode text not null default 'text',
  body text not null,
  created_at timestamptz not null default now(),
  constraint acq_welcome_steps_position_check check (position in (1, 2)),
  constraint acq_welcome_steps_delay_check check (delay_hours >= 0 and delay_hours <= 24),
  constraint acq_welcome_steps_mode_check check (mode in ('ai', 'text')),
  constraint acq_welcome_steps_position_unique unique (business_id, position)
);

create table if not exists public.acq_manual_followups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  contact_id uuid references public.acq_contacts (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete cascade,
  body text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint acq_manual_followups_status_check check (status in ('pending', 'sent_by_human'))
);

create table if not exists public.acq_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  contact_id uuid references public.acq_contacts (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete cascade,
  kind text not null default 'task',
  source text not null default 'manual',
  title text not null,
  due_at timestamptz not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint acq_reminders_kind_check check (kind in ('task', 'resume')),
  constraint acq_reminders_source_check check (source in ('manual', 'ai')),
  constraint acq_reminders_status_check check (status in ('open', 'done'))
);

create table if not exists public.acq_comment_ctas (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  keyword text not null,
  match_mode text not null default 'contains',
  dm_text text not null default '',
  button_label text not null default '',
  button_url text not null default '',
  agent_role text not null default '',
  reply_to_comments boolean not null default false,
  dm_anyone boolean not null default false,
  public_replies text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint acq_comment_ctas_match_check check (match_mode in ('equals', 'contains')),
  constraint acq_comment_ctas_button_check check (char_length(button_label) <= 20)
);

create table if not exists public.acq_story_ctas (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  keyword text not null,
  agent_role text not null default '',
  extra_instructions text not null default '',
  created_at timestamptz not null default now()
);

alter table public.acq_followup_steps enable row level security;
alter table public.acq_welcome_steps enable row level security;
alter table public.acq_manual_followups enable row level security;
alter table public.acq_reminders enable row level security;
alter table public.acq_comment_ctas enable row level security;
alter table public.acq_story_ctas enable row level security;

do $grants$
declare
  rel text;
begin
  foreach rel in array array[
    'acq_followup_steps', 'acq_welcome_steps', 'acq_manual_followups',
    'acq_reminders', 'acq_comment_ctas', 'acq_story_ctas'
  ]
  loop
    execute format('revoke all on table public.%I from public, anon', rel);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', rel);
    execute format('grant select, insert, update, delete on table public.%I to service_role', rel);
  end loop;
end
$grants$;

do $policies$
declare
  rel text;
begin
  foreach rel in array array[
    'acq_followup_steps', 'acq_welcome_steps', 'acq_manual_followups',
    'acq_reminders', 'acq_comment_ctas', 'acq_story_ctas'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', rel || '_read', rel);
    execute format('create policy %I on public.%I for select to authenticated using (public.acq_can_read(business_id))', rel || '_read', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_insert', rel);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.acq_can_edit(business_id))', rel || '_insert', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_update', rel);
    execute format('create policy %I on public.%I for update to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id))', rel || '_update', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_delete', rel);
    execute format('create policy %I on public.%I for delete to authenticated using (public.acq_can_edit(business_id))', rel || '_delete', rel);
  end loop;
end
$policies$;
