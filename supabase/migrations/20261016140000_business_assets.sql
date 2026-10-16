-- Business assets and workforce status.
-- Apply after 20261016120000_business_members.sql.
-- Does not deploy an edge function and does not store agent tokens.
-- The hourly sync does not read these rows yet. business_agent_assets is the
-- view it can select later. Files live in the private business-assets bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-assets',
  'business-assets',
  false,
  26214400,
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/webm',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/wav',
    'audio/ogg',
    'audio/x-m4a',
    'audio/m4a'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.business_assets (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.tailortalk_agents (id) on delete cascade,
  kind text not null,
  title text not null,
  url text,
  storage_path text,
  mime_type text,
  byte_size bigint,
  when_to_use text,
  available_to_agent boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_assets_kind_check check (kind in ('doc', 'link', 'voice')),
  constraint business_assets_shape_check check (
    (kind = 'link' and url is not null and storage_path is null)
    or (kind in ('doc', 'voice') and storage_path is not null and url is null)
  ),
  constraint business_assets_voice_note_check check (
    kind <> 'voice' or nullif(btrim(when_to_use), '') is not null
  ),
  constraint business_assets_url_check check (
    url is null or url ~* '^https?://'
  )
);

create index if not exists business_assets_agent_idx
  on public.business_assets (agent_id, created_at desc);

create table if not exists public.business_workforce (
  agent_id uuid not null references public.tailortalk_agents (id) on delete cascade,
  role text not null,
  status text not null default 'not_set_up',
  updated_at timestamptz not null default now(),
  primary key (agent_id, role),
  constraint business_workforce_role_check check (role in ('outreach', 'follow_up', 'setting')),
  constraint business_workforce_status_check check (status in ('active', 'paused', 'not_set_up'))
);

alter table public.business_assets enable row level security;
alter table public.business_workforce enable row level security;

revoke all on table public.business_assets from public, anon;
revoke all on table public.business_workforce from public, anon;
grant select, insert, update, delete on table public.business_assets to authenticated;
grant select, insert, update on table public.business_workforce to authenticated;

drop policy if exists business_assets_select on public.business_assets;
create policy business_assets_select on public.business_assets
  for select to authenticated
  using (public.can_read_business(agent_id));

drop policy if exists business_assets_insert on public.business_assets;
create policy business_assets_insert on public.business_assets
  for insert to authenticated
  with check (public.can_edit_business(agent_id) and created_by = auth.uid());

drop policy if exists business_assets_update on public.business_assets;
create policy business_assets_update on public.business_assets
  for update to authenticated
  using (public.can_edit_business(agent_id))
  with check (public.can_edit_business(agent_id));

drop policy if exists business_assets_delete on public.business_assets;
create policy business_assets_delete on public.business_assets
  for delete to authenticated
  using (public.can_edit_business(agent_id));

drop policy if exists business_workforce_select on public.business_workforce;
create policy business_workforce_select on public.business_workforce
  for select to authenticated
  using (public.can_read_business(agent_id));

drop policy if exists business_workforce_insert on public.business_workforce;
create policy business_workforce_insert on public.business_workforce
  for insert to authenticated
  with check (public.can_edit_business(agent_id));

drop policy if exists business_workforce_update on public.business_workforce;
create policy business_workforce_update on public.business_workforce
  for update to authenticated
  using (public.can_edit_business(agent_id))
  with check (public.can_edit_business(agent_id));

create or replace function public.storage_agent_id(object_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = public, storage
as $$
declare
  folder text;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null or folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return folder::uuid;
end;
$$;

revoke all on function public.storage_agent_id(text) from public, anon;
grant execute on function public.storage_agent_id(text) to authenticated;

drop policy if exists business_assets_storage_read on storage.objects;
create policy business_assets_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'business-assets'
    and public.can_read_business(public.storage_agent_id(name))
  );

drop policy if exists business_assets_storage_insert on storage.objects;
create policy business_assets_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-assets'
    and public.can_edit_business(public.storage_agent_id(name))
  );

drop policy if exists business_assets_storage_update on storage.objects;
create policy business_assets_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-assets'
    and public.can_edit_business(public.storage_agent_id(name))
  )
  with check (
    bucket_id = 'business-assets'
    and public.can_edit_business(public.storage_agent_id(name))
  );

drop policy if exists business_assets_storage_delete on storage.objects;
create policy business_assets_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-assets'
    and public.can_edit_business(public.storage_agent_id(name))
  );

create or replace view public.business_agent_assets
with (security_invoker = true) as
select
  id,
  agent_id,
  kind,
  title,
  url,
  storage_path,
  mime_type,
  when_to_use,
  updated_at
from public.business_assets
where available_to_agent;

revoke all on table public.business_agent_assets from public, anon;
grant select on table public.business_agent_assets to authenticated, service_role;

create or replace function public.business_workforce_counts(p_agent uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'conversations', (
      select total_leads from public.tailortalk_agent_stats where agent_id = p_agent
    ),
    'booked', (
      select converted_count from public.tailortalk_agent_stats where agent_id = p_agent
    ),
    'followups', (
      select case when count(total_followups) = 0 then null else sum(total_followups) end
      from public.tailortalk_leads
      where agent_id = p_agent
    ),
    'warm_quiet', (
      select count(*)
      from public.tailortalk_leads
      where agent_id = p_agent
        and lower(coalesce(lead_status, '')) = 'warm'
        and is_converted is not true
        and last_message_time is not null
        and last_message_time < now() - interval '3 days'
    )
  );
$$;

revoke all on function public.business_workforce_counts(uuid) from public, anon;
grant execute on function public.business_workforce_counts(uuid) to authenticated;
