-- Per-business model choice and owner recordings the setter can send.
-- API keys stay in private, encrypted with pgcrypto. The browser receives
-- only the last four characters. speech_provider 'elevenlabs' is reserved
-- and is not implemented.

create extension if not exists pgcrypto with schema extensions;

insert into private.acquisition_settings (key, value)
values ('llm_token_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

alter table public.acq_settings drop constraint if exists acq_settings_setter_model_check;
alter table public.acq_settings drop constraint if exists acq_settings_setter_model_len;
alter table public.acq_settings
  add constraint acq_settings_setter_model_len
  check (char_length(btrim(setter_model)) between 1 and 120);

alter table public.acq_settings
  add column if not exists llm_setter_provider text not null default 'xai',
  add column if not exists llm_setter_own_key boolean not null default false,
  add column if not exists llm_setter_base_url text not null default '',
  add column if not exists llm_prompt_provider text not null default 'xai',
  add column if not exists llm_prompt_model text not null default 'grok-4.7',
  add column if not exists llm_prompt_own_key boolean not null default false,
  add column if not exists llm_prompt_base_url text not null default '';

alter table public.acq_settings drop constraint if exists acq_settings_llm_setter_provider_check;
alter table public.acq_settings
  add constraint acq_settings_llm_setter_provider_check
  check (llm_setter_provider in ('xai', 'openai', 'anthropic', 'gemini', 'openrouter', 'custom'));

alter table public.acq_settings drop constraint if exists acq_settings_llm_prompt_provider_check;
alter table public.acq_settings
  add constraint acq_settings_llm_prompt_provider_check
  check (llm_prompt_provider in ('xai', 'openai', 'anthropic', 'gemini', 'openrouter', 'custom'));

alter table public.acq_settings drop constraint if exists acq_settings_llm_prompt_model_len;
alter table public.acq_settings
  add constraint acq_settings_llm_prompt_model_len
  check (char_length(btrim(llm_prompt_model)) between 1 and 120);

alter table public.acq_settings drop constraint if exists acq_settings_llm_setter_base_url_check;
alter table public.acq_settings
  add constraint acq_settings_llm_setter_base_url_check
  check (
    llm_setter_base_url = ''
    or (
      llm_setter_base_url ~ '^https://'
      and position('@' in llm_setter_base_url) = 0
      and char_length(llm_setter_base_url) <= 300
    )
  );

alter table public.acq_settings drop constraint if exists acq_settings_llm_prompt_base_url_check;
alter table public.acq_settings
  add constraint acq_settings_llm_prompt_base_url_check
  check (
    llm_prompt_base_url = ''
    or (
      llm_prompt_base_url ~ '^https://'
      and position('@' in llm_prompt_base_url) = 0
      and char_length(llm_prompt_base_url) <= 300
    )
  );

create table if not exists private.business_llm_secrets (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  provider text not null,
  key_encrypted bytea not null,
  key_last4 text not null,
  base_url text not null default '',
  updated_at timestamptz not null default now(),
  primary key (business_id, provider),
  constraint business_llm_secrets_provider_check check (provider in ('xai', 'openai', 'anthropic', 'gemini', 'openrouter', 'custom')),
  constraint business_llm_secrets_last4_check check (char_length(key_last4) = 4)
);

revoke all on table private.business_llm_secrets from public, anon, authenticated;

create or replace function public.acq_llm_save_key(
  p_business uuid,
  p_provider text,
  p_key text,
  p_base_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_provider text;
  v_secret text;
  v_base text;
begin
  if auth.uid() is null or public.acq_can_edit(p_business) is not true then
    raise exception 'forbidden';
  end if;
  v_provider := lower(btrim(coalesce(p_provider, '')));
  if v_provider not in ('xai', 'openai', 'anthropic', 'gemini', 'openrouter', 'custom') then
    raise exception 'provider';
  end if;
  v_secret := btrim(coalesce(p_key, ''));
  if char_length(v_secret) < 8 or char_length(v_secret) > 400 then
    raise exception 'key';
  end if;
  v_base := btrim(coalesce(p_base_url, ''));
  if v_base <> '' and (v_base !~ '^https://' or position('@' in v_base) > 0 or char_length(v_base) > 300) then
    raise exception 'base';
  end if;
  select value into v_token from private.acquisition_settings where key = 'llm_token_key';
  if v_token is null or length(v_token) < 16 then
    raise exception 'token key missing';
  end if;
  insert into private.business_llm_secrets (business_id, provider, key_encrypted, key_last4, base_url)
  values (
    p_business,
    v_provider,
    extensions.pgp_sym_encrypt(v_secret, v_token),
    right(v_secret, 4),
    v_base
  )
  on conflict (business_id, provider) do update
    set key_encrypted = excluded.key_encrypted,
        key_last4 = excluded.key_last4,
        base_url = excluded.base_url,
        updated_at = now();
  return jsonb_build_object('ok', true, 'last4', right(v_secret, 4));
end;
$$;

create or replace function public.acq_llm_clear_key(p_business uuid, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
begin
  if auth.uid() is null or public.acq_can_edit(p_business) is not true then
    raise exception 'forbidden';
  end if;
  v_provider := lower(btrim(coalesce(p_provider, '')));
  delete from private.business_llm_secrets
  where business_id = p_business and provider = v_provider;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.acq_llm_key_hints(p_business uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.acq_can_read(p_business) is not true then
    raise exception 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('provider', provider, 'last4', key_last4) order by provider)
    from private.business_llm_secrets
    where business_id = p_business
  ), '[]'::jsonb);
end;
$$;

create or replace function public.acq_llm_read_key(p_business uuid, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_row private.business_llm_secrets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select value into v_token from private.acquisition_settings where key = 'llm_token_key';
  select * into v_row
  from private.business_llm_secrets
  where business_id = p_business and provider = lower(btrim(coalesce(p_provider, '')));
  if v_row.business_id is null or v_token is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'api_key', extensions.pgp_sym_decrypt(v_row.key_encrypted, v_token),
    'base_url', v_row.base_url
  );
end;
$$;

revoke all on function public.acq_llm_save_key(uuid, text, text, text) from public, anon;
revoke all on function public.acq_llm_clear_key(uuid, text) from public, anon;
revoke all on function public.acq_llm_key_hints(uuid) from public, anon;
revoke all on function public.acq_llm_read_key(uuid, text) from public, anon, authenticated;
grant execute on function public.acq_llm_save_key(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.acq_llm_clear_key(uuid, text) to authenticated, service_role;
grant execute on function public.acq_llm_key_hints(uuid) to authenticated, service_role;
grant execute on function public.acq_llm_read_key(uuid, text) to service_role;

create table if not exists public.acq_llm_errors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  purpose text not null,
  provider text not null default '',
  model text not null default '',
  message text not null default '',
  fell_back boolean not null default false,
  created_at timestamptz not null default now(),
  constraint acq_llm_errors_purpose_check check (purpose in ('setter', 'prompt', 'assistant', 'test')),
  constraint acq_llm_errors_message_check check (char_length(message) <= 240)
);

alter table public.acq_llm_errors enable row level security;
revoke all on table public.acq_llm_errors from public, anon;
grant select on table public.acq_llm_errors to authenticated;
grant select, insert on table public.acq_llm_errors to service_role;

drop policy if exists acq_llm_errors_select on public.acq_llm_errors;
create policy acq_llm_errors_select on public.acq_llm_errors
  for select to authenticated
  using (public.acq_can_read(business_id));

create table if not exists public.acq_owner_clips (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  label text not null,
  when_to_use text not null,
  kind text not null default 'audio',
  storage_path text not null,
  mime_type text not null default '',
  delivery_path text not null default '',
  delivery_mime text not null default '',
  byte_size integer not null default 0,
  active boolean not null default true,
  speech_provider text not null default 'recording',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acq_owner_clips_label_check check (char_length(btrim(label)) between 1 and 120),
  constraint acq_owner_clips_when_check check (char_length(btrim(when_to_use)) between 1 and 500),
  constraint acq_owner_clips_kind_check check (kind in ('audio', 'video', 'image')),
  constraint acq_owner_clips_path_check check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'),
  constraint acq_owner_clips_bytes_check check (byte_size >= 0 and byte_size <= 20971520),
  constraint acq_owner_clips_speech_check check (speech_provider in ('recording', 'elevenlabs'))
);

create index if not exists acq_owner_clips_business_idx
  on public.acq_owner_clips (business_id, created_at desc);

alter table public.acq_owner_clips enable row level security;
revoke all on table public.acq_owner_clips from public, anon;
grant select, insert, update, delete on table public.acq_owner_clips to authenticated;
grant select, insert, update, delete on table public.acq_owner_clips to service_role;

drop policy if exists acq_owner_clips_select on public.acq_owner_clips;
create policy acq_owner_clips_select on public.acq_owner_clips
  for select to authenticated
  using (public.acq_can_read(business_id));

drop policy if exists acq_owner_clips_insert on public.acq_owner_clips;
create policy acq_owner_clips_insert on public.acq_owner_clips
  for insert to authenticated
  with check (
    public.acq_can_edit(business_id)
    and created_by = auth.uid()
    and storage_path like business_id::text || '/%'
    and speech_provider = 'recording'
  );

drop policy if exists acq_owner_clips_update on public.acq_owner_clips;
create policy acq_owner_clips_update on public.acq_owner_clips
  for update to authenticated
  using (public.acq_can_edit(business_id))
  with check (
    public.acq_can_edit(business_id)
    and storage_path like business_id::text || '/%'
    and speech_provider = 'recording'
  );

drop policy if exists acq_owner_clips_delete on public.acq_owner_clips;
create policy acq_owner_clips_delete on public.acq_owner_clips
  for delete to authenticated
  using (public.acq_can_edit(business_id));

create table if not exists public.acq_clip_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  clip_id uuid not null references public.acq_owner_clips (id) on delete cascade,
  conversation_key text not null,
  created_at timestamptz not null default now(),
  constraint acq_clip_sends_key_check check (char_length(conversation_key) between 1 and 200),
  constraint acq_clip_sends_once unique (clip_id, conversation_key)
);

alter table public.acq_clip_sends enable row level security;
revoke all on table public.acq_clip_sends from public, anon, authenticated;
grant select on table public.acq_clip_sends to authenticated;
grant select, insert, delete on table public.acq_clip_sends to service_role;

drop policy if exists acq_clip_sends_select on public.acq_clip_sends;
create policy acq_clip_sends_select on public.acq_clip_sends
  for select to authenticated
  using (public.acq_can_read(business_id));

do $bucket$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage.buckets is missing. Create a private owner-clips bucket before uploading recordings.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'owner-clips',
    'owner-clips',
    false,
    20971520,
    array[
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
      'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg', 'audio/aac', 'audio/webm',
      'image/jpeg', 'image/png',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists owner_clips_storage_read on storage.objects;
  create policy owner_clips_storage_read on storage.objects
    for select to authenticated
    using (
      bucket_id = 'owner-clips'
      and public.acq_can_read(public.storage_agent_id(name))
    );
  drop policy if exists owner_clips_storage_insert on storage.objects;
  create policy owner_clips_storage_insert on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'owner-clips'
      and public.acq_can_edit(public.storage_agent_id(name))
    );
  drop policy if exists owner_clips_storage_update on storage.objects;
  create policy owner_clips_storage_update on storage.objects
    for update to authenticated
    using (
      bucket_id = 'owner-clips'
      and public.acq_can_edit(public.storage_agent_id(name))
    )
    with check (
      bucket_id = 'owner-clips'
      and public.acq_can_edit(public.storage_agent_id(name))
    );
  drop policy if exists owner_clips_storage_delete on storage.objects;
  create policy owner_clips_storage_delete on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'owner-clips'
      and public.acq_can_edit(public.storage_agent_id(name))
    );
exception
  when others then
    raise notice 'owner-clips bucket was not created (%).', sqlerrm;
end
$bucket$;
