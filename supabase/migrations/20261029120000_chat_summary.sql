-- NOT APPLIED.
-- Delivery state for chats, and a cache for conversation summaries.
-- Do not run this against production from the repo.
-- It does not remove a table and does not turn a setter on.

alter table public.acq_messages
  add column if not exists delivery_status text not null default 'sent';

alter table public.acq_messages drop constraint if exists acq_messages_delivery_check;
alter table public.acq_messages
  add constraint acq_messages_delivery_check
  check (delivery_status in ('sending', 'sent', 'failed'));

create table if not exists public.acq_chat_summaries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  contact_id uuid not null references public.acq_contacts (id) on delete cascade,
  period_days integer not null default 7,
  body jsonb not null default '{}'::jsonb,
  model text not null default '',
  updated_at timestamptz not null default now(),
  constraint acq_chat_summaries_period_check check (period_days in (7, 30)),
  constraint acq_chat_summaries_unique unique (business_id, contact_id, period_days)
);

alter table public.acq_chat_summaries enable row level security;
revoke all on public.acq_chat_summaries from public, anon;
grant select on public.acq_chat_summaries to authenticated;
grant select, insert, update, delete on public.acq_chat_summaries to service_role;

drop policy if exists acq_chat_summaries_read on public.acq_chat_summaries;
create policy acq_chat_summaries_read on public.acq_chat_summaries
  for select to authenticated
  using (public.acq_can_read(business_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'acq_messages'
    ) then
      execute 'alter publication supabase_realtime add table public.acq_messages';
    end if;
  end if;
exception when others then
  raise notice 'acq_messages was not added to supabase_realtime';
end $$;
