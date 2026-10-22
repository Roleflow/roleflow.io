-- Rate limit for the Roleflow Assistant. One row per question.
-- The signed-in user inserts their own row. Reads stay on that user.

create table if not exists public.acq_assistant_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.acq_assistant_turns enable row level security;
revoke all on table public.acq_assistant_turns from public, anon;
grant select, insert on table public.acq_assistant_turns to authenticated;

drop policy if exists acq_assistant_turns_select on public.acq_assistant_turns;
create policy acq_assistant_turns_select on public.acq_assistant_turns
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists acq_assistant_turns_insert on public.acq_assistant_turns;
create policy acq_assistant_turns_insert on public.acq_assistant_turns
  for insert to authenticated
  with check (user_id = auth.uid() and public.acq_can_read(business_id));

create index if not exists acq_assistant_turns_user_idx
  on public.acq_assistant_turns (user_id, created_at desc);
