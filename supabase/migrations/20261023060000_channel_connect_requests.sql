-- Roleflow-branded Instagram connection requests.
-- The provider id stays internal. studio_setter_sync is not changed and stays off.

alter table public.acq_settings
  add column if not exists channel_provider text not null default 'tailortalk';

alter table public.acq_settings drop constraint if exists acq_settings_channel_provider_check;
alter table public.acq_settings
  add constraint acq_settings_channel_provider_check
  check (channel_provider = 'tailortalk');

create table if not exists public.acq_channel_connect_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.acq_workspaces (id) on delete cascade,
  channel text not null default 'instagram',
  username text not null,
  status text not null default 'pending',
  notes text,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_channel_connect_channel_check check (channel = 'instagram'),
  constraint acq_channel_connect_status_check check (status in ('pending', 'in_progress', 'connected', 'failed')),
  constraint acq_channel_connect_username_check check (username ~ '^[a-z0-9._]{1,30}$')
);

create index if not exists acq_channel_connect_workspace_idx
  on public.acq_channel_connect_requests (workspace_id, created_at desc);

create unique index if not exists acq_channel_connect_open_idx
  on public.acq_channel_connect_requests (workspace_id, channel)
  where status in ('pending', 'in_progress');

alter table public.acq_channel_connect_requests enable row level security;
revoke all on table public.acq_channel_connect_requests from public, anon;
grant select on table public.acq_channel_connect_requests to authenticated;
grant select, insert, update, delete on table public.acq_channel_connect_requests to service_role;

drop policy if exists acq_channel_connect_select on public.acq_channel_connect_requests;
create policy acq_channel_connect_select on public.acq_channel_connect_requests
  for select to authenticated
  using (public.acq_can_read(workspace_id));

create or replace function public.acq_request_instagram_connection(p_workspace uuid, p_username text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_handle text := lower(regexp_replace(coalesce(p_username, ''), '^@+', ''));
  v_notes text := left(btrim(coalesce(p_notes, '')), 500);
  v_row public.acq_channel_connect_requests;
  v_name text;
begin
  if v_user is null then
    raise exception 'Sign in to connect Instagram.';
  end if;
  if not public.acq_can_edit(p_workspace) then
    raise exception 'You cannot edit this business.';
  end if;
  if v_handle !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'Enter the Instagram Business username.';
  end if;

  select * into v_row
  from public.acq_channel_connect_requests
  where workspace_id = p_workspace
    and channel = 'instagram'
    and status in ('pending', 'in_progress')
  order by created_at desc
  limit 1
  for update;

  if v_row.id is null then
    begin
      insert into public.acq_channel_connect_requests (workspace_id, channel, username, status, notes, requested_by)
      values (p_workspace, 'instagram', v_handle, 'pending', nullif(v_notes, ''), v_user)
      returning * into v_row;
    exception when unique_violation then
      update public.acq_channel_connect_requests
      set username = v_handle,
          notes = nullif(v_notes, ''),
          updated_at = now()
      where workspace_id = p_workspace
        and channel = 'instagram'
        and status in ('pending', 'in_progress')
      returning * into v_row;
    end;
  else
    update public.acq_channel_connect_requests
    set username = v_handle,
        notes = nullif(v_notes, ''),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  end if;

  select name into v_name from public.acq_workspaces where id = p_workspace;
  insert into public.acq_notifications (business_id, title, body)
  values (
    p_workspace,
    'Instagram connection waiting',
    'Connecting @' || v_handle || ' for ' || coalesce(v_name, 'this business') || '. We will finish this for you.'
  );

  return jsonb_build_object(
    'id', v_row.id,
    'workspace_id', v_row.workspace_id,
    'username', v_row.username,
    'status', v_row.status
  );
end;
$$;

create or replace function public.acq_admin_resolve_instagram_connection(p_request uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.acq_channel_connect_requests;
  v_title text;
  v_body text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin only.';
  end if;
  if p_status not in ('connected', 'failed') then
    raise exception 'Choose connected or failed.';
  end if;

  update public.acq_channel_connect_requests
  set status = p_status,
      updated_at = now()
  where id = p_request
    and status in ('pending', 'in_progress')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That connection request is no longer waiting.';
  end if;

  if p_status = 'connected' then
    insert into public.ig_connections (business_id, username, status, last_error, connected_at, updated_at)
    values (v_row.workspace_id, v_row.username, 'connected', null, now(), now())
    on conflict (business_id) do update
      set username = excluded.username,
          status = 'connected',
          last_error = null,
          connected_at = now(),
          updated_at = now();

    insert into public.acq_setter_links (business_id, provider, status, requested_handle, updated_at)
    values (v_row.workspace_id, 'tailortalk', 'connected', v_row.username, now())
    on conflict (business_id) do update
      set provider = 'tailortalk',
          status = 'connected',
          requested_handle = excluded.requested_handle,
          last_sync_error = null,
          updated_at = now();

    update public.acq_settings
    set channel_provider = 'tailortalk'
    where agent_id = v_row.workspace_id;

    v_title := 'Instagram channel connected';
    v_body := 'Your Instagram channel is connected as @' || v_row.username || '.';
  else
    insert into public.ig_connections (business_id, username, status, last_error, updated_at)
    values (v_row.workspace_id, v_row.username, 'error', 'We could not finish this connection.', now())
    on conflict (business_id) do update
      set username = case
            when public.ig_connections.status = 'connected' then public.ig_connections.username
            else excluded.username
          end,
          status = case
            when public.ig_connections.status = 'connected' then public.ig_connections.status
            else 'error'
          end,
          last_error = case
            when public.ig_connections.status = 'connected' then public.ig_connections.last_error
            else 'We could not finish this connection.'
          end,
          updated_at = now();

    insert into public.acq_setter_links (business_id, provider, status, requested_handle, updated_at)
    values (v_row.workspace_id, 'tailortalk', 'error', v_row.username, now())
    on conflict (business_id) do update
      set status = case
            when public.acq_setter_links.status = 'connected' then public.acq_setter_links.status
            else 'error'
          end,
          requested_handle = coalesce(nullif(public.acq_setter_links.requested_handle, ''), excluded.requested_handle),
          updated_at = now();

    v_title := 'Instagram channel needs another try';
    v_body := 'We could not finish this connection. Send the username again from Integrations.';
  end if;

  insert into public.acq_notifications (business_id, title, body)
  values (v_row.workspace_id, v_title, v_body);

  return jsonb_build_object('ok', true, 'status', v_row.status, 'username', v_row.username, 'workspace_id', v_row.workspace_id);
end;
$$;

revoke all on function public.acq_request_instagram_connection(uuid, text, text) from public, anon;
revoke all on function public.acq_admin_resolve_instagram_connection(uuid, text) from public, anon;
grant execute on function public.acq_request_instagram_connection(uuid, text, text) to authenticated;
grant execute on function public.acq_admin_resolve_instagram_connection(uuid, text) to authenticated;

update public.acq_dnc
set reason = regexp_replace(reason, 'tailor[[:space:]]*talk(\.ai)?', 'Instagram channel', 'gi')
where reason ~* 'tailor[[:space:]]*talk';

update public.acq_setter_links
set last_sync_error = regexp_replace(last_sync_error, 'tailor[[:space:]]*talk(\.ai)?', 'Instagram channel', 'gi')
where last_sync_error ~* 'tailor[[:space:]]*talk';

update public.acq_setter_links
set last_test_error = regexp_replace(last_test_error, 'tailor[[:space:]]*talk(\.ai)?', 'Instagram channel', 'gi')
where last_test_error ~* 'tailor[[:space:]]*talk';
