-- APPLIED in production as version 20261028150149.
-- Do not run this file again from the repo.
-- Follow-to-DM settings for @roleflow.io. Off until enabled. The kill switch stops it.
-- It does not remove a table, does not store an Instagram login, and does not turn a setter on.

create table if not exists public.acq_dm_controls (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  enabled boolean not null default false,
  killed boolean not null default false,
  daily_cap integer not null default 20,
  paused_reason text not null default '',
  updated_at timestamptz not null default now(),
  constraint acq_dm_cap_check check (daily_cap between 1 and 50)
);

create table if not exists public.acq_dm_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  name text not null,
  template text not null default '',
  handles text not null default '',
  exclusions text not null default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint acq_dm_campaign_name_check check (char_length(btrim(name)) between 1 and 80)
);

alter table public.acq_dm_controls enable row level security;
alter table public.acq_dm_campaigns enable row level security;
revoke all on public.acq_dm_controls from public, anon;
revoke all on public.acq_dm_campaigns from public, anon;
grant select, insert, update, delete on public.acq_dm_controls to authenticated;
grant select, insert, update, delete on public.acq_dm_campaigns to authenticated;

drop policy if exists acq_dm_controls_all on public.acq_dm_controls;
create policy acq_dm_controls_all on public.acq_dm_controls
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_dm_controls_read on public.acq_dm_controls;
create policy acq_dm_controls_read on public.acq_dm_controls
  for select to authenticated
  using (public.acq_can_read(business_id));

drop policy if exists acq_dm_campaigns_all on public.acq_dm_campaigns;
create policy acq_dm_campaigns_all on public.acq_dm_campaigns
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_dm_campaigns_read on public.acq_dm_campaigns;
create policy acq_dm_campaigns_read on public.acq_dm_campaigns
  for select to authenticated
  using (public.acq_can_read(business_id));
