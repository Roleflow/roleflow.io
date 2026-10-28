-- NOT APPLIED.
-- One follow-to-DM control per workspace. New businesses get a row that starts off.
-- Do not run this against production from the repo.
-- It does not remove a table, does not store an Instagram login, and does not turn a setter on.

create table if not exists public.acq_dm_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  handle text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint acq_dm_sends_handle_check check (char_length(btrim(handle)) between 1 and 30),
  constraint acq_dm_sends_body_check check (char_length(btrim(body)) between 1 and 1000)
);

create index if not exists acq_dm_sends_business_idx
  on public.acq_dm_sends (business_id, created_at desc);

alter table public.acq_dm_sends enable row level security;
revoke all on public.acq_dm_sends from public, anon;
grant select, insert on public.acq_dm_sends to authenticated;

drop policy if exists acq_dm_sends_read on public.acq_dm_sends;
create policy acq_dm_sends_read on public.acq_dm_sends
  for select to authenticated
  using (public.acq_can_read(business_id));

drop policy if exists acq_dm_sends_insert on public.acq_dm_sends;
create policy acq_dm_sends_insert on public.acq_dm_sends
  for insert to authenticated
  with check (public.acq_can_edit(business_id));

insert into public.acq_dm_controls (business_id, enabled, killed, daily_cap)
select workspace.id, false, false, 20
from public.acq_workspaces as workspace
on conflict (business_id) do nothing;

create or replace function public.acq_dm_control_for_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.acq_dm_controls (business_id, enabled, killed, daily_cap)
  values (new.id, false, false, 20)
  on conflict (business_id) do nothing;
  return new;
end;
$$;

drop trigger if exists acq_workspaces_dm_control on public.acq_workspaces;
create trigger acq_workspaces_dm_control
  after insert on public.acq_workspaces
  for each row execute function public.acq_dm_control_for_workspace();

revoke all on function public.acq_dm_control_for_workspace() from public, anon;
