-- NOT APPLIED.
-- Instagram login streams through Supabase Realtime. The box dials out on 443.
-- Broadcast checks are rolled back by Realtime. This file does not keep frames or typed input.
-- Do not run this against production from the repo.
-- It does not remove a table, does not store an Instagram login, and does not turn a setter on.

create table if not exists public.acq_dm_login_service (
  id integer primary key,
  seen_at timestamptz not null default now(),
  constraint acq_dm_login_service_singleton check (id = 1)
);

insert into public.acq_dm_login_service (id, seen_at)
values (1, '2000-01-01T00:00:00Z')
on conflict (id) do nothing;

alter table public.acq_dm_login_service enable row level security;
revoke all on public.acq_dm_login_service from public, anon;
grant select on public.acq_dm_login_service to authenticated;

drop policy if exists acq_dm_login_service_read on public.acq_dm_login_service;
create policy acq_dm_login_service_read on public.acq_dm_login_service
  for select to authenticated
  using (id = 1);

create or replace function public.acq_dm_login_beat()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.acq_dm_login_service (id, seen_at)
  values (1, now())
  on conflict (id) do update set seen_at = excluded.seen_at;
$$;

revoke all on function public.acq_dm_login_beat() from public, anon, authenticated;
grant execute on function public.acq_dm_login_beat() to service_role;

create or replace function public.acq_dm_login_channel_ok(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.acq_dm_login_links as link
    where p_topic = 'dm-login:' || link.token_hash
      and link.purpose = 'login'
      and link.used_at is null
      and link.expires_at > now()
      and public.acq_can_edit(link.business_id)
  );
$$;

revoke all on function public.acq_dm_login_channel_ok(text) from public, anon;
grant execute on function public.acq_dm_login_channel_ok(text) to authenticated;

drop policy if exists acq_dm_login_broadcast_read on realtime.messages;
create policy acq_dm_login_broadcast_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.acq_dm_login_channel_ok(realtime.topic())
  );

drop policy if exists acq_dm_login_broadcast_send on realtime.messages;
create policy acq_dm_login_broadcast_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.acq_dm_login_channel_ok(realtime.topic())
  );
