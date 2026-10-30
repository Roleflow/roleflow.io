-- NOT APPLIED.
-- Follow-ups: 24-hour ladder steps gain a voice note, per-state instructions
-- and an on/off flag; a 7-day manual track; a follow-up send log.
-- Additive only: new nullable or defaulted columns, new tables, new indexes.
-- No drop of a table, column or row. acq_followup_policy is kept as it is.
-- It does not turn sending on and it adds no webhook.

alter table public.acq_followup_steps
  add column if not exists voice_note_id uuid references public.acq_voice_library (id) on delete set null,
  add column if not exists state_prompts jsonb not null default '{}'::jsonb,
  add column if not exists enabled boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.acq_manual_followup_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  wait_half_days integer not null,
  mode text not null default 'text',
  body text not null default '',
  asset_id uuid references public.acq_value_assets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_manual_followup_steps_wait_check check (wait_half_days between 2 and 13),
  constraint acq_manual_followup_steps_mode_check check (mode in ('ai', 'text')),
  constraint acq_manual_followup_steps_body_check check (char_length(body) <= 4000)
);
create index if not exists acq_manual_followup_steps_business on public.acq_manual_followup_steps (business_id, wait_half_days);

alter table public.acq_manual_followups
  add column if not exists step_id uuid references public.acq_manual_followup_steps (id) on delete set null,
  add column if not exists due_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_via text;

alter table public.acq_manual_followups drop constraint if exists acq_manual_followups_sent_via_check;
alter table public.acq_manual_followups
  add constraint acq_manual_followups_sent_via_check check (sent_via is null or sent_via in ('desk', 'instagram'));

create table if not exists public.acq_followup_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  track text not null,
  step_id uuid not null,
  thread_id uuid references public.ig_threads (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete set null,
  contact_id uuid references public.acq_contacts (id) on delete set null,
  cycle text not null default '0',
  status text not null,
  reason text,
  voice_note_id uuid references public.acq_voice_library (id) on delete set null,
  replied boolean not null default false,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_followup_sends_track_check check (track in ('auto', 'welcome', 'manual')),
  constraint acq_followup_sends_status_check check (status in ('held', 'queued', 'sent', 'skipped', 'failed'))
);
create unique index if not exists acq_followup_sends_once on public.acq_followup_sends (thread_id, step_id, cycle);
create index if not exists acq_followup_sends_business on public.acq_followup_sends (business_id, created_at desc);

alter table public.acq_manual_followup_steps enable row level security;
alter table public.acq_followup_sends enable row level security;

revoke all on table public.acq_manual_followup_steps from public, anon;
grant select, insert, update, delete on table public.acq_manual_followup_steps to authenticated;
grant select, insert, update, delete on table public.acq_manual_followup_steps to service_role;

revoke all on table public.acq_followup_sends from public, anon;
grant select on table public.acq_followup_sends to authenticated;
grant select, insert, update, delete on table public.acq_followup_sends to service_role;

drop policy if exists acq_manual_followup_steps_read on public.acq_manual_followup_steps;
create policy acq_manual_followup_steps_read on public.acq_manual_followup_steps
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_manual_followup_steps_insert on public.acq_manual_followup_steps;
create policy acq_manual_followup_steps_insert on public.acq_manual_followup_steps
  for insert to authenticated with check (public.acq_can_edit(business_id));
drop policy if exists acq_manual_followup_steps_update on public.acq_manual_followup_steps;
create policy acq_manual_followup_steps_update on public.acq_manual_followup_steps
  for update to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id));
drop policy if exists acq_manual_followup_steps_delete on public.acq_manual_followup_steps;
create policy acq_manual_followup_steps_delete on public.acq_manual_followup_steps
  for delete to authenticated using (public.acq_can_edit(business_id));

drop policy if exists acq_followup_sends_read on public.acq_followup_sends;
create policy acq_followup_sends_read on public.acq_followup_sends
  for select to authenticated using (public.acq_can_read(business_id));
