-- NOT APPLIED.
-- Self-serve Instagram login for follow-to-DM. One control row already exists per workspace.
-- The encrypted browser state stays on the worker computer. This file does not store it.
-- Do not run this against production from the repo.
-- It does not remove a table, does not store an Instagram login, and does not turn a setter on.

alter table public.acq_dm_controls
  add column if not exists ig_handle text,
  add column if not exists session_ready boolean not null default false;

alter table public.acq_dm_controls
  drop constraint if exists acq_dm_ig_handle_check;

alter table public.acq_dm_controls
  add constraint acq_dm_ig_handle_check
  check (ig_handle is null or char_length(btrim(ig_handle)) between 1 and 30);

create table if not exists public.acq_dm_login_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  token_hash text not null unique,
  purpose text not null default 'login',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint acq_dm_login_purpose_check check (purpose in ('login', 'disconnect')),
  constraint acq_dm_login_hash_check check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists acq_dm_login_links_business_idx
  on public.acq_dm_login_links (business_id, created_at desc);

create table if not exists public.acq_dm_login_config (
  id integer primary key,
  public_origin text not null default '',
  constraint acq_dm_login_config_singleton check (id = 1)
);

insert into public.acq_dm_login_config (id, public_origin)
values (1, '')
on conflict (id) do nothing;

alter table public.acq_dm_login_links enable row level security;
alter table public.acq_dm_login_config enable row level security;
revoke all on public.acq_dm_login_links from public, anon;
revoke all on public.acq_dm_login_config from public, anon;
grant select, insert on public.acq_dm_login_links to authenticated;
grant select on public.acq_dm_login_config to authenticated;

drop policy if exists acq_dm_login_links_insert on public.acq_dm_login_links;
create policy acq_dm_login_links_insert on public.acq_dm_login_links
  for insert to authenticated
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_dm_login_links_read on public.acq_dm_login_links;
create policy acq_dm_login_links_read on public.acq_dm_login_links
  for select to authenticated
  using (public.acq_can_read(business_id));

drop policy if exists acq_dm_login_config_read on public.acq_dm_login_config;
create policy acq_dm_login_config_read on public.acq_dm_login_config
  for select to authenticated
  using (true);

create or replace function public.acq_dm_login_link_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.expires_at is null or new.expires_at > now() + interval '10 minutes' then
    new.expires_at := now() + interval '10 minutes';
  end if;
  new.used_at := null;
  return new;
end;
$$;

drop trigger if exists acq_dm_login_links_guard on public.acq_dm_login_links;
create trigger acq_dm_login_links_guard
  before insert on public.acq_dm_login_links
  for each row execute function public.acq_dm_login_link_guard();

create or replace function public.acq_dm_controls_member_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.ig_handle := old.ig_handle;
    new.session_ready := old.session_ready;
  else
    new.ig_handle := null;
    new.session_ready := false;
  end if;
  return new;
end;
$$;

drop trigger if exists acq_dm_controls_member_guard on public.acq_dm_controls;
create trigger acq_dm_controls_member_guard
  before insert or update on public.acq_dm_controls
  for each row execute function public.acq_dm_controls_member_guard();

revoke all on function public.acq_dm_login_link_guard() from public, anon;
revoke all on function public.acq_dm_controls_member_guard() from public, anon;
