-- Stand-in for the live objects 20261111120000_business_testers.sql touches.
-- Used only by scripts/business-testers-sql-check.mjs (in-memory PGlite).
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create extension pgcrypto with schema extensions;
create schema auth; create schema private;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb, raw_app_meta_data jsonb not null default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table private.signup_settings (id int primary key, access_code text not null);
insert into private.signup_settings values (1, 'Code2026');
create table public.profiles (id uuid primary key, full_name text default '', email text default '', instagram text default '', updated_at timestamptz default now());
create table public.admins (user_id uuid primary key);
create table public.onboarding_submissions (user_id uuid primary key);
create table public.tailortalk_agents (id uuid primary key default gen_random_uuid(), client_id uuid, agent_name text, label text);
create table public.business_members (id uuid primary key default gen_random_uuid(), agent_id uuid, email text, user_id uuid, role text, status text default 'pending', accepted_at timestamptz);
create table private.business_invite_secrets (member_id uuid primary key, token_hash text, expires_at timestamptz);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
create function public.can_read_business(p uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.tailortalk_agents a where a.id = p and a.client_id = auth.uid()) $$;
create function public.can_edit_business(p uuid) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.tailortalk_agents a where a.id = p and a.client_id = auth.uid()) $$;
create table public.acq_workspaces (id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id), name text not null default 'Acquisition', tailortalk_agent_id uuid, join_code text, created_at timestamptz default now());
create table public.acq_members (business_id uuid not null references public.acq_workspaces(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, role text not null, status text not null default 'active', created_at timestamptz default now(), scopes text[] not null default array['conversations','configuration','analysis'], primary key (business_id, user_id), constraint acq_members_role_check check (role in ('owner','editor','viewer')), constraint acq_members_status_check check (status in ('active','invited')));
create table public.acq_invites (id uuid primary key default gen_random_uuid(), business_id uuid not null references public.acq_workspaces(id) on delete cascade, email text not null, scopes text[] not null, token text not null unique, created_at timestamptz default now(), accepted_at timestamptz);
create table public.acq_settings (agent_id uuid primary key references public.acq_workspaces(id), system_enabled boolean default false);
create table public.acq_agent_prompts (business_id uuid primary key references public.acq_workspaces(id), body text);
-- live definitions
CREATE OR REPLACE FUNCTION public.acq_can_edit(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  select p_workspace is not null and (public.is_admin() or exists (select 1 from public.acq_workspaces w where w.id = p_workspace and (w.owner_id = auth.uid() or (w.tailortalk_agent_id is not null and public.can_edit_business(w.tailortalk_agent_id)))) or exists (select 1 from public.acq_members m where m.business_id = p_workspace and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'editor')));
$function$;
CREATE OR REPLACE FUNCTION public.acq_can_read(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  select p_workspace is not null and (public.is_admin() or exists (select 1 from public.acq_workspaces w where w.id = p_workspace and (w.owner_id = auth.uid() or (w.tailortalk_agent_id is not null and public.can_read_business(w.tailortalk_agent_id)))) or exists (select 1 from public.acq_members m where m.business_id = p_workspace and m.user_id = auth.uid() and m.status = 'active'));
$function$;
create function public.acq_ensure_owned_workspace(p_user uuid, p_name text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; begin
  select id into v from public.acq_workspaces where owner_id = p_user order by created_at limit 1;
  if v is null then insert into public.acq_workspaces (owner_id, name) values (p_user, coalesce(p_name, 'Acquisition')) returning id into v; end if;
  insert into public.acq_members (business_id, user_id, role, status) values (v, p_user, 'owner', 'active') on conflict do nothing;
  return v; end $$;
create function private.enforce_signup_access_code() returns trigger language plpgsql security definer set search_path = '' as $$ begin return new; end $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin return new; end $$;
create trigger enforce_signup_access_code before insert on auth.users for each row execute function private.enforce_signup_access_code();
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.acq_accept_invite(p_token text) returns jsonb language plpgsql as $$ begin return null; end $$;
create function public.preview_invite(p_token text) returns jsonb language plpgsql as $$ begin return null; end $$;
-- live RLS
alter table public.acq_workspaces enable row level security; grant select, update on public.acq_workspaces to authenticated;
create policy acq_workspaces_select on public.acq_workspaces for select to authenticated using (public.acq_can_read(id));
alter table public.acq_members enable row level security; grant select on public.acq_members to authenticated;
create policy acq_members_select on public.acq_members for select to authenticated using (public.acq_can_read(business_id));
alter table public.acq_invites enable row level security; grant select, insert, update, delete on public.acq_invites to authenticated;
create policy acq_invites_read on public.acq_invites for select to authenticated using (public.acq_can_read(business_id));
create policy acq_invites_insert on public.acq_invites for insert to authenticated with check (public.acq_can_edit(business_id));
create policy acq_invites_update on public.acq_invites for update to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id));
create policy acq_invites_delete on public.acq_invites for delete to authenticated using (public.acq_can_edit(business_id));
alter table public.acq_settings enable row level security; grant select, insert, update on public.acq_settings to authenticated;
create policy acq_settings_select on public.acq_settings for select to authenticated using (public.acq_can_read(agent_id));
create policy acq_settings_update on public.acq_settings for update to authenticated using (public.acq_can_edit(agent_id)) with check (public.acq_can_edit(agent_id));
alter table public.acq_agent_prompts enable row level security; grant select, insert, update, delete on public.acq_agent_prompts to authenticated;
create policy acq_agent_prompts_read on public.acq_agent_prompts for select to authenticated using (public.acq_can_read(business_id));
create policy acq_agent_prompts_write on public.acq_agent_prompts for all to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id));
