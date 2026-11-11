-- Team join link: owner-only, least privilege by default.
--
-- NOT APPLIED. Apply after review, after 20261111120000_business_testers.sql.
--
-- Before this, every business had a join code in acq_workspaces.join_code that
-- anyone who could read the business (viewers and editors too) could see, and
-- acq_join_workspace turned it into full Editor access, including the live
-- setter switch. Any editor could also regenerate it.
--
-- After this:
--   * Join links live in public.acq_join_links, one per business, readable and
--     removable only by the owner (or an admin) through acq_can_manage_team.
--   * Only the owner (or an admin) can create or replace a link.
--   * A link joins as Tester unless the owner picked another role for it
--     (Tester + prompt edits or Editor).
--   * Joining never changes the role of someone who is already a member.
--   * Codes are 24 hex characters (96 bits) instead of 8.
--   * Every old code stops working: acq_join_workspace no longer reads
--     acq_workspaces.join_code, and the old codes are cleared.

-- 1. Join links ---------------------------------------------------------------

create table if not exists public.acq_join_links (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  code text not null unique,
  role text not null default 'tester',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint acq_join_links_role_check check (role in ('tester', 'prompt_editor', 'editor')),
  constraint acq_join_links_code_check check (code ~ '^[0-9a-f]{24}$')
);

alter table public.acq_join_links enable row level security;

drop policy if exists acq_join_links_read on public.acq_join_links;
create policy acq_join_links_read on public.acq_join_links
  for select to authenticated using (public.acq_can_manage_team(business_id));
drop policy if exists acq_join_links_delete on public.acq_join_links;
create policy acq_join_links_delete on public.acq_join_links
  for delete to authenticated using (public.acq_can_manage_team(business_id));
-- No insert or update policy: links are written only by acq_regenerate_join_code.

revoke all on table public.acq_join_links from public, anon, authenticated;
grant select, delete on table public.acq_join_links to authenticated;
grant all on table public.acq_join_links to service_role;

-- 2. Retire the old Editor codes ---------------------------------------------

update public.acq_workspaces set join_code = null where join_code is not null;

-- 3. Only the owner creates a link, and picks its role -----------------------

drop function if exists public.acq_regenerate_join_code(uuid);

create or replace function public.acq_regenerate_join_code(p_business uuid, p_role text default 'tester')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_role text := coalesce(nullif(btrim(p_role), ''), 'tester');
begin
  if auth.uid() is null or p_business is null or not public.acq_can_manage_team(p_business) then
    raise exception 'Only the business owner can change the team link';
  end if;
  if v_role not in ('tester', 'prompt_editor', 'editor') then
    raise exception 'Choose Tester, Tester + prompt edits, or Editor';
  end if;
  v_code := encode(extensions.gen_random_bytes(12), 'hex');
  insert into public.acq_join_links (business_id, code, role, created_by, created_at)
  values (p_business, v_code, v_role, auth.uid(), now())
  on conflict (business_id) do update
    set code = excluded.code,
        role = excluded.role,
        created_by = excluded.created_by,
        created_at = excluded.created_at;
  return jsonb_build_object('ok', true, 'join_code', v_code, 'role', v_role);
end;
$$;

revoke all on function public.acq_regenerate_join_code(uuid, text) from public, anon;
grant execute on function public.acq_regenerate_join_code(uuid, text) to authenticated;

-- 4. Joining uses the link's role and never changes an existing member -------

create or replace function public.acq_join_workspace(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.acq_join_links%rowtype;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  select * into v_link
  from public.acq_join_links
  where code = lower(btrim(coalesce(p_code, '')));
  if v_link.business_id is null then
    return jsonb_build_object('ok', false, 'error', 'That join link does not match a business.');
  end if;
  if exists (select 1 from public.acq_workspaces w where w.id = v_link.business_id and w.owner_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'business_id', v_link.business_id, 'role', 'owner');
  end if;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_link.business_id, auth.uid(), v_link.role, 'active')
  on conflict (business_id, user_id) do nothing;
  select role into v_role from public.acq_members
  where business_id = v_link.business_id and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'business_id', v_link.business_id, 'role', v_role);
end;
$$;

revoke all on function public.acq_join_workspace(text) from public, anon;
grant execute on function public.acq_join_workspace(text) to authenticated;
