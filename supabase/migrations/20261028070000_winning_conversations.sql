-- NOT APPLIED.
-- Winning DM conversations for one business.
-- Do not run this against production from the repo. Apply it yourself when ready.
-- It does not drop tables and it does not change an existing setter prompt.

create table if not exists public.acq_winning_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  title text not null default '',
  raw_text text not null default '',
  messages jsonb not null default '[]'::jsonb,
  outcome text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint acq_winning_conversations_outcome check (outcome in ('', 'booked', 'closed'))
);

create index if not exists acq_winning_conversations_business_idx
  on public.acq_winning_conversations (business_id, created_at desc);

alter table public.acq_winning_conversations enable row level security;

drop policy if exists acq_winning_conversations_read on public.acq_winning_conversations;
create policy acq_winning_conversations_read on public.acq_winning_conversations
  for select to authenticated using (public.acq_can_read(business_id));

drop policy if exists acq_winning_conversations_write on public.acq_winning_conversations;
create policy acq_winning_conversations_write on public.acq_winning_conversations
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

grant select, insert, update, delete on public.acq_winning_conversations to authenticated;
grant all on public.acq_winning_conversations to service_role;
revoke all on public.acq_winning_conversations from anon;
