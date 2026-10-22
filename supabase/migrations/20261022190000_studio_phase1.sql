-- Phase 1 studio: business brief, CRM fields, sales links, value content.
-- Additive. Live setter sync stays off. No provider calls.

alter table public.acq_assistant_turns
  add column if not exists kind text not null default 'ask';

alter table public.acq_assistant_turns drop constraint if exists acq_assistant_turns_kind_check;
alter table public.acq_assistant_turns
  add constraint acq_assistant_turns_kind_check check (kind in ('ask', 'studio'));

alter table public.acq_settings
  add column if not exists studio_setter_sync boolean not null default false;

alter table public.acq_contacts
  add column if not exists crm_state text,
  add column if not exists ai_enabled boolean not null default true,
  add column if not exists assigned_agent text not null default '',
  add column if not exists tags text[] not null default '{}',
  add column if not exists follower_count integer,
  add column if not exists is_verified boolean not null default false,
  add column if not exists we_follow boolean not null default false,
  add column if not exists they_follow boolean not null default false,
  add column if not exists message_count integer not null default 0,
  add column if not exists automated boolean not null default true,
  add column if not exists sales_link_id uuid;

alter table public.acq_contacts drop constraint if exists acq_contacts_crm_state_check;
alter table public.acq_contacts
  add constraint acq_contacts_crm_state_check
  check (crm_state is null or crm_state in ('open', 'discovering', 'qualifying', 'proposal', 'booked', 'paid', 'lost', 'unqualified', 'postponed'));

alter table public.acq_targets
  add column if not exists crm_state text,
  add column if not exists ai_enabled boolean not null default true,
  add column if not exists assigned_agent text not null default '',
  add column if not exists tags text[] not null default '{}',
  add column if not exists follower_count integer,
  add column if not exists is_verified boolean not null default false,
  add column if not exists we_follow boolean not null default false,
  add column if not exists they_follow boolean not null default false,
  add column if not exists message_count integer not null default 0;

alter table public.acq_targets drop constraint if exists acq_targets_crm_state_check;
alter table public.acq_targets
  add constraint acq_targets_crm_state_check
  check (crm_state is null or crm_state in ('open', 'discovering', 'qualifying', 'proposal', 'booked', 'paid', 'lost', 'unqualified', 'postponed'));

grant update on table public.acq_contacts to authenticated;

drop policy if exists acq_contacts_update on public.acq_contacts;
create policy acq_contacts_update on public.acq_contacts
  for update to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

create table if not exists public.acq_business_briefs (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table if not exists public.acq_brief_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  fields jsonb not null default '{}'::jsonb,
  cards jsonb not null default '[]'::jsonb,
  char_count integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create index if not exists acq_brief_versions_business_idx
  on public.acq_brief_versions (business_id, created_at desc);

create table if not exists public.acq_agent_cards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  role text not null,
  name text not null default '',
  instructions text not null default '',
  delegations jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint acq_agent_cards_role_unique unique (business_id, role)
);

create table if not exists public.acq_lead_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  contact_id uuid references public.acq_contacts (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create index if not exists acq_lead_notes_business_idx
  on public.acq_lead_notes (business_id, created_at desc);

create table if not exists public.acq_message_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  contact_id uuid references public.acq_contacts (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete cascade,
  body text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint acq_message_queue_status_check check (status in ('pending', 'cancelled'))
);

create table if not exists public.acq_offer_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  name text not null,
  body text not null default '',
  url text not null,
  coupon text not null default '',
  average_ticket_cents integer,
  send_instructions text not null default '',
  send_as_button boolean not null default false,
  button_label text not null default '',
  agent_roles text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acq_schedule_endpoints (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  provider text not null,
  name text not null default '',
  availability_url text not null default '',
  booking_url text not null default '',
  condition text not null default '',
  has_api_key boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_schedule_provider_check check (provider in ('calendly', 'gohighlevel', 'custom'))
);

create table if not exists private.acq_schedule_secrets (
  endpoint_id uuid primary key references public.acq_schedule_endpoints (id) on delete cascade,
  api_key_encrypted bytea not null
);

revoke all on private.acq_schedule_secrets from public, anon, authenticated;

create table if not exists public.acq_value_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  kind text not null,
  title text not null default '',
  url text not null default '',
  label text not null default '',
  storage_path text not null default '',
  send_instructions text not null default '',
  placement text not null default 'ai',
  agent_roles text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint acq_value_assets_kind_check check (kind in ('image', 'audio', 'video', 'link', 'button')),
  constraint acq_value_assets_placement_check check (placement in ('before', 'after', 'ai'))
);

alter table public.acq_business_briefs enable row level security;
alter table public.acq_brief_versions enable row level security;
alter table public.acq_agent_cards enable row level security;
alter table public.acq_lead_notes enable row level security;
alter table public.acq_message_queue enable row level security;
alter table public.acq_offer_links enable row level security;
alter table public.acq_schedule_endpoints enable row level security;
alter table public.acq_value_assets enable row level security;

do $grants$
declare
  rel text;
begin
  foreach rel in array array[
    'acq_business_briefs', 'acq_brief_versions', 'acq_agent_cards', 'acq_lead_notes',
    'acq_message_queue', 'acq_offer_links', 'acq_schedule_endpoints', 'acq_value_assets'
  ]
  loop
    execute format('revoke all on table public.%I from public, anon', rel);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', rel);
    execute format('grant select, insert, update, delete on table public.%I to service_role', rel);
  end loop;
end
$grants$;

do $policies$
declare
  rel text;
begin
  foreach rel in array array[
    'acq_business_briefs', 'acq_brief_versions', 'acq_agent_cards', 'acq_lead_notes',
    'acq_message_queue', 'acq_offer_links', 'acq_schedule_endpoints', 'acq_value_assets'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', rel || '_read', rel);
    execute format('create policy %I on public.%I for select to authenticated using (public.acq_can_read(business_id))', rel || '_read', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_insert', rel);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.acq_can_edit(business_id))', rel || '_insert', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_update', rel);
    execute format('create policy %I on public.%I for update to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id))', rel || '_update', rel);
    execute format('drop policy if exists %I on public.%I', rel || '_delete', rel);
    execute format('create policy %I on public.%I for delete to authenticated using (public.acq_can_edit(business_id))', rel || '_delete', rel);
  end loop;
end
$policies$;

create or replace function public.acq_set_schedule_secret(p_endpoint uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_business uuid;
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select business_id into v_business from public.acq_schedule_endpoints where id = p_endpoint;
  if v_business is null then
    raise exception 'That schedule was not found';
  end if;
  if not public.acq_can_edit(v_business) then
    raise exception 'You cannot edit this business';
  end if;
  if p_key is null or btrim(p_key) = '' then
    delete from private.acq_schedule_secrets where endpoint_id = p_endpoint;
    update public.acq_schedule_endpoints set has_api_key = false, updated_at = now() where id = p_endpoint;
    return jsonb_build_object('ok', true, 'has_api_key', false);
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  if v_key is null or v_key = '' then
    raise exception 'Encryption key is missing';
  end if;
  insert into private.acq_schedule_secrets (endpoint_id, api_key_encrypted)
  values (p_endpoint, extensions.pgp_sym_encrypt(btrim(p_key), v_key))
  on conflict (endpoint_id) do update set api_key_encrypted = excluded.api_key_encrypted;
  update public.acq_schedule_endpoints set has_api_key = true, updated_at = now() where id = p_endpoint;
  return jsonb_build_object('ok', true, 'has_api_key', true);
end;
$$;

revoke all on function public.acq_set_schedule_secret(uuid, text) from public, anon;
grant execute on function public.acq_set_schedule_secret(uuid, text) to authenticated;

do $bucket$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage.buckets is missing. Create a private acq-value bucket before uploading content.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'acq-value',
    'acq-value',
    false,
    52428800,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg',
      'video/mp4', 'video/webm', 'video/quicktime'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists acq_value_storage_read on storage.objects;
  create policy acq_value_storage_read on storage.objects
    for select to authenticated
    using (bucket_id = 'acq-value' and public.acq_can_read(public.storage_agent_id(name)));
  drop policy if exists acq_value_storage_insert on storage.objects;
  create policy acq_value_storage_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'acq-value' and public.acq_can_edit(public.storage_agent_id(name)));
  drop policy if exists acq_value_storage_delete on storage.objects;
  create policy acq_value_storage_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'acq-value' and public.acq_can_edit(public.storage_agent_id(name)));
exception
  when others then
    raise notice 'acq-value bucket was not created (%).', sqlerrm;
end
$bucket$;
