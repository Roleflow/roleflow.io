-- Roleflow accounts, onboarding storage, and admin tracking.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- It is idempotent: running it again updates functions, policies, and triggers
-- without dropping client data.
--
-- Before or after this script, in Authentication → URL configuration:
--   Site URL: https://www.roleflow.io
--   Redirect URLs:
--     https://www.roleflow.io/account/
--     https://www.roleflow.io/reset/
--     https://roleflow.io/account/
--     https://roleflow.io/reset/
--     http://127.0.0.1:4173/account/
--     http://127.0.0.1:4173/reset/
-- In Authentication → Providers → Email, turn "Confirm email" ON for production.
-- The site handles the "check your email" state when confirmation is required.
--
-- Admin: sign up once as diego@roleflow.io (password or magic link). This script
-- inserts that user into public.admins if the account already exists, and the
-- signup trigger does it for a later signup. Re-run the final insert anytime.
--
-- Optional notification (not created here): Dashboard → Database → Webhooks,
-- table public.onboarding_submissions, event UPDATE, and call your mail or Slack
-- hook when the new row's status is submitted. Keep that API key in the webhook
-- config, not in this file.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  instagram text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_submissions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  step_index integer not null default 0,
  status text not null default 'not_started',
  prompt_text text,
  submitted_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.onboarding_submissions
  drop constraint if exists onboarding_submissions_status_check;
alter table public.onboarding_submissions
  add constraint onboarding_submissions_status_check
  check (status in ('not_started', 'in_progress', 'submitted', 'integrated', 'live'));

alter table public.onboarding_submissions
  drop constraint if exists onboarding_submissions_step_check;
alter table public.onboarding_submissions
  add constraint onboarding_submissions_step_check
  check (step_index >= 0 and step_index <= 24);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint admin_notes_body_check check (char_length(btrim(body)) > 0)
);

create index if not exists onboarding_submissions_status_idx
  on public.onboarding_submissions (status, last_activity_at desc);
create index if not exists admin_notes_client_idx
  on public.admin_notes (client_id, created_at);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, instagram)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'instagram', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when public.profiles.full_name = '' then excluded.full_name
          else public.profiles.full_name
        end,
        instagram = case
          when public.profiles.instagram = '' then excluded.instagram
          else public.profiles.instagram
        end,
        updated_at = now();

  insert into public.onboarding_submissions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  if lower(coalesce(new.email, '')) = 'diego@roleflow.io' then
    insert into public.admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set email = coalesce(new.email, ''),
        updated_at = now()
    where id = new.id;

  if lower(coalesce(new.email, '')) = 'diego@roleflow.io' then
    insert into public.admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    new.updated_at = now();
    return new;
  end if;
  if auth.uid() is distinct from old.id then
    raise exception 'not allowed';
  end if;
  new.id = old.id;
  new.email = old.email;
  new.created_at = old.created_at;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.guard_onboarding_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.last_activity_at = now();
  new.user_id = old.user_id;
  new.created_at = old.created_at;

  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if auth.uid() is distinct from old.user_id then
    raise exception 'not allowed';
  end if;

  if old.status in ('integrated', 'live') then
    raise exception 'This onboarding is locked';
  end if;

  if new.status is null or new.status not in ('not_started', 'in_progress', 'submitted') then
    raise exception 'status not allowed';
  end if;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_at = coalesce(new.submitted_at, now());
  end if;

  if new.status <> 'submitted' then
    new.submitted_at = null;
    new.prompt_text = null;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

drop trigger if exists onboarding_guard_update on public.onboarding_submissions;
create trigger onboarding_guard_update
  before update on public.onboarding_submissions
  for each row execute function public.guard_onboarding_update();

alter table public.profiles enable row level security;
alter table public.onboarding_submissions enable row level security;
alter table public.admins enable row level security;
alter table public.admin_notes enable row level security;

revoke all on public.profiles from public, anon;
revoke all on public.onboarding_submissions from public, anon;
revoke all on public.admins from public, anon;
revoke all on public.admin_notes from public, anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.onboarding_submissions to authenticated;
grant select on public.admins to authenticated;
grant select, insert, update, delete on public.admin_notes to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.profiles to service_role';
    execute 'grant all on public.onboarding_submissions to service_role';
    execute 'grant all on public.admins to service_role';
    execute 'grant all on public.admin_notes to service_role';
    execute 'grant execute on function public.is_admin() to service_role';
  end if;
end $$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists submissions_select on public.onboarding_submissions;
create policy submissions_select on public.onboarding_submissions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists submissions_insert on public.onboarding_submissions;
create policy submissions_insert on public.onboarding_submissions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists submissions_update on public.onboarding_submissions;
create policy submissions_update on public.onboarding_submissions
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins
  for select to authenticated
  using (public.is_admin());

drop policy if exists notes_select on public.admin_notes;
create policy notes_select on public.admin_notes
  for select to authenticated
  using (public.is_admin());

drop policy if exists notes_insert on public.admin_notes;
create policy notes_insert on public.admin_notes
  for insert to authenticated
  with check (public.is_admin() and author_id = auth.uid());

drop policy if exists notes_update on public.admin_notes;
create policy notes_update on public.admin_notes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin() and author_id = auth.uid());

drop policy if exists notes_delete on public.admin_notes;
create policy notes_delete on public.admin_notes
  for delete to authenticated
  using (public.is_admin());

insert into public.profiles (id, full_name, email, instagram)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data->>'instagram', '')
from auth.users u
on conflict (id) do nothing;

insert into public.onboarding_submissions (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

insert into public.admins (user_id)
select u.id from auth.users u
where lower(u.email) = 'diego@roleflow.io'
on conflict (user_id) do nothing;
