-- Phase 3 settings, statistics support, team scopes, notifications.
-- Additive. Live setter sync is not changed. Secrets stay in private.

alter table public.acq_settings
  add column if not exists office_mode text,
  add column if not exists office_start time not null default '09:00',
  add column if not exists office_end time not null default '18:00',
  add column if not exists hours_by_day jsonb not null default '{}'::jsonb,
  add column if not exists reply_delay_max_seconds integer not null default 120,
  add column if not exists keyword_only boolean not null default false,
  add column if not exists skip_followed boolean not null default false,
  add column if not exists stop_on_human boolean not null default true,
  add column if not exists stop_on_business_first boolean not null default true,
  add column if not exists stop_after_link boolean not null default false,
  add column if not exists stop_condition text not null default '',
  add column if not exists strip_inverted_punct boolean not null default false,
  add column if not exists disclosure_enabled boolean not null default true,
  add column if not exists disclosure_text text not null default '',
  add column if not exists notify_booked text not null default '',
  add column if not exists notify_proposal text not null default '',
  add column if not exists notify_paid text not null default '',
  add column if not exists notify_manual text not null default '',
  add column if not exists notify_extra text not null default '',
  add column if not exists conversion_param text not null default 'lead',
  add column if not exists conversion_state text not null default 'Booked';

alter table public.acq_settings drop constraint if exists acq_settings_office_mode_check;
alter table public.acq_settings
  add constraint acq_settings_office_mode_check check (office_mode is null or office_mode in ('always', 'same', 'per_day'));
alter table public.acq_settings drop constraint if exists acq_settings_delay_max_check;
alter table public.acq_settings
  add constraint acq_settings_delay_max_check check (reply_delay_max_seconds between 0 and 300);
alter table public.acq_settings drop constraint if exists acq_settings_conversion_state_check;
alter table public.acq_settings
  add constraint acq_settings_conversion_state_check check (conversion_state in ('Booked', 'Paid'));

alter table public.acq_members
  add column if not exists scopes text[] not null default array['conversations', 'configuration', 'analysis'];

create table if not exists public.acq_state_rules (
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  crm_state text not null,
  condition text not null default '',
  updated_at timestamptz not null default now(),
  primary key (business_id, crm_state),
  constraint acq_state_rules_state_check check (crm_state in ('Open', 'Discovering', 'Qualifying', 'Proposal', 'Booked', 'Paid', 'Lost', 'Unqualified', 'Postponed'))
);

create table if not exists public.acq_tag_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  name text not null,
  rule_kind text not null,
  rule_text text not null default '',
  notify_email text not null default '',
  created_at timestamptz not null default now(),
  constraint acq_tag_rules_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint acq_tag_rules_kind_check check (rule_kind in ('ai', 'text', 'attachment'))
);

create table if not exists public.acq_webhooks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  url text not null,
  events text[] not null default '{}',
  paused boolean not null default false,
  has_secret boolean not null default false,
  created_at timestamptz not null default now(),
  constraint acq_webhooks_url_check check (url ~ '^https://')
);

create table if not exists private.acq_webhook_secrets (
  webhook_id uuid primary key references public.acq_webhooks (id) on delete cascade,
  secret_encrypted bytea not null
);

create table if not exists public.acq_api_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  label text not null default 'Workspace key',
  prefix text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.acq_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  email text not null,
  scopes text[] not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint acq_invites_email_check check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create table if not exists public.acq_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.acq_origins (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  name text not null,
  keyword text not null,
  created_at timestamptz not null default now(),
  constraint acq_origins_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint acq_origins_keyword_len check (char_length(btrim(keyword)) between 1 and 40)
);

do $policies$
declare
  rel text;
begin
  foreach rel in array array['acq_state_rules', 'acq_tag_rules', 'acq_webhooks', 'acq_api_keys', 'acq_invites', 'acq_notifications', 'acq_origins']
  loop
    execute format('alter table public.%I enable row level security', rel);
    execute format('revoke all on table public.%I from public, anon', rel);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', rel);
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

revoke all on table private.acq_webhook_secrets from public, anon, authenticated;
revoke select (token_hash), update (token_hash) on public.acq_api_keys from authenticated, anon;

create or replace function public.acq_set_webhook_secret(p_webhook uuid, p_secret text)
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
  select business_id into v_business from public.acq_webhooks where id = p_webhook;
  if v_business is null or not public.acq_can_edit(v_business) then
    raise exception 'You cannot edit this webhook';
  end if;
  if p_secret is null or length(btrim(p_secret)) < 16 then
    raise exception 'The signing secret needs at least 16 characters';
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  if v_key is null or v_key = '' then
    raise exception 'Encryption key is missing';
  end if;
  insert into private.acq_webhook_secrets (webhook_id, secret_encrypted)
  values (p_webhook, extensions.pgp_sym_encrypt(btrim(p_secret), v_key))
  on conflict (webhook_id) do update set secret_encrypted = excluded.secret_encrypted;
  update public.acq_webhooks set has_secret = true where id = p_webhook;
  return jsonb_build_object('ok', true, 'has_secret', true);
end;
$$;

create or replace function public.acq_prepare_webhook_test(p_webhook uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_row public.acq_webhooks%rowtype;
  v_key text;
  v_secret text;
  v_body text;
  v_sig text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select * into v_row from public.acq_webhooks where id = p_webhook;
  if v_row.id is null or not public.acq_can_edit(v_row.business_id) then
    raise exception 'You cannot test this webhook';
  end if;
  if v_row.paused then
    raise exception 'This webhook is paused';
  end if;
  if v_row.has_secret is not true then
    raise exception 'Save a signing secret first';
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  select extensions.pgp_sym_decrypt(secret_encrypted, v_key) into v_secret
  from private.acq_webhook_secrets where webhook_id = p_webhook;
  if v_secret is null or v_secret = '' then
    raise exception 'The signing secret could not be read';
  end if;
  v_body := jsonb_build_object(
    'event', 'webhook.test',
    'business_id', v_row.business_id,
    'sent_at', now()
  )::text;
  v_sig := encode(extensions.hmac(convert_to(v_body, 'utf8'), convert_to(v_secret, 'utf8'), 'sha256'), 'hex');
  return jsonb_build_object('url', v_row.url, 'body', v_body, 'signature', v_sig);
end;
$$;

create or replace function public.acq_create_api_key(p_business uuid, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_prefix text;
  v_id uuid;
  v_count integer;
begin
  if auth.uid() is null or not public.acq_can_edit(p_business) then
    raise exception 'You cannot create a key for this business';
  end if;
  select count(*) into v_count from public.acq_api_keys where business_id = p_business and revoked_at is null;
  if v_count >= 8 then
    raise exception 'This business already has 8 active keys';
  end if;
  v_token := 'rfw_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_prefix := substr(v_token, 1, 12);
  insert into public.acq_api_keys (business_id, label, prefix, token_hash)
  values (p_business, left(coalesce(nullif(btrim(p_label), ''), 'Workspace key'), 60), v_prefix, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'prefix', v_prefix, 'token', v_token);
end;
$$;

create or replace function public.acq_regenerate_join_code(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
begin
  if auth.uid() is null or not public.acq_can_edit(p_business) then
    raise exception 'You cannot change this invite link';
  end if;
  v_code := lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  update public.acq_workspaces set join_code = v_code where id = p_business;
  return jsonb_build_object('ok', true, 'join_code', v_code);
end;
$$;

create or replace function public.acq_accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.acq_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  select * into v_invite from public.acq_invites where token = p_token and accepted_at is null;
  if v_invite.id is null then
    raise exception 'That invite is no longer open';
  end if;
  select lower(email) into v_email from public.profiles where id = auth.uid();
  if v_email is null or v_email <> lower(v_invite.email) then
    raise exception 'Sign in with the invited email';
  end if;
  insert into public.acq_members (business_id, user_id, role, status, scopes)
  values (v_invite.business_id, auth.uid(), 'editor', 'active', v_invite.scopes)
  on conflict (business_id, user_id) do update set status = 'active', scopes = excluded.scopes;
  update public.acq_invites set accepted_at = now() where id = v_invite.id;
  return jsonb_build_object('ok', true, 'business_id', v_invite.business_id);
end;
$$;

create or replace function public.acq_clone_business(p_source uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_code text;
  v_name text := left(btrim(coalesce(p_name, '')), 80);
begin
  if auth.uid() is null or not public.acq_can_edit(p_source) then
    raise exception 'You cannot clone this business';
  end if;
  if v_name = '' then
    raise exception 'Name the new business';
  end if;
  v_code := lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into public.acq_workspaces (owner_id, name, join_code)
  values (auth.uid(), v_name, v_code)
  returning id into v_id;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_id, auth.uid(), 'owner', 'active')
  on conflict (business_id, user_id) do nothing;
  perform public.acq_ensure(v_id);
  update public.acq_settings as dest
  set
    daily_cap = src.daily_cap,
    timezone = src.timezone,
    quiet_start = src.quiet_start,
    quiet_end = src.quiet_end,
    office_mode = src.office_mode,
    office_start = src.office_start,
    office_end = src.office_end,
    hours_by_day = src.hours_by_day,
    reply_delay_seconds = src.reply_delay_seconds,
    reply_delay_max_seconds = src.reply_delay_max_seconds,
    keyword_only = src.keyword_only,
    skip_followed = src.skip_followed,
    stop_on_human = src.stop_on_human,
    stop_on_business_first = src.stop_on_business_first,
    stop_after_link = src.stop_after_link,
    stop_condition = src.stop_condition,
    strip_inverted_punct = src.strip_inverted_punct,
    disclosure_enabled = src.disclosure_enabled,
    disclosure_text = src.disclosure_text,
    notify_booked = src.notify_booked,
    notify_proposal = src.notify_proposal,
    notify_paid = src.notify_paid,
    notify_manual = src.notify_manual,
    notify_extra = src.notify_extra,
    conversion_param = src.conversion_param,
    conversion_state = src.conversion_state,
    followup_hours = src.followup_hours,
    followup_count = src.followup_count,
    system_enabled = false
  from public.acq_settings src
  where dest.agent_id = v_id and src.agent_id = p_source;
  insert into public.acq_business_briefs (business_id, fields)
  select v_id, fields from public.acq_business_briefs where business_id = p_source;
  insert into public.acq_agent_cards (business_id, role, name, instructions, delegations)
  select v_id, role, name, instructions, delegations from public.acq_agent_cards where business_id = p_source;
  insert into public.acq_offer_links (business_id, name, body, url, coupon, average_ticket_cents, send_instructions, send_as_button, button_label, agent_roles)
  select v_id, name, body, url, coupon, average_ticket_cents, send_instructions, send_as_button, button_label, agent_roles
  from public.acq_offer_links where business_id = p_source;
  insert into public.acq_value_assets (business_id, kind, title, url, label, send_instructions, placement, agent_roles)
  select v_id, kind, title, url, label, send_instructions, placement, agent_roles
  from public.acq_value_assets where business_id = p_source and storage_path = '';
  insert into public.acq_followup_steps (business_id, hours, mode, body, crm_state)
  select v_id, hours, mode, body, crm_state from public.acq_followup_steps where business_id = p_source;
  insert into public.acq_welcome_steps (business_id, position, delay_hours, mode, body)
  select v_id, position, delay_hours, mode, body from public.acq_welcome_steps where business_id = p_source;
  insert into public.acq_state_rules (business_id, crm_state, condition)
  select v_id, crm_state, condition from public.acq_state_rules where business_id = p_source;
  insert into public.acq_tag_rules (business_id, name, rule_kind, rule_text, notify_email)
  select v_id, name, rule_kind, rule_text, notify_email from public.acq_tag_rules where business_id = p_source;
  insert into public.acq_origins (business_id, name, keyword)
  select v_id, name, keyword from public.acq_origins where business_id = p_source;
  insert into public.acq_notifications (business_id, title, body)
  values (v_id, 'Business cloned', 'Settings, brief, links, and content titles were copied. Leads, files, and keys stayed with the original.');
  return jsonb_build_object('ok', true, 'business_id', v_id);
end;
$$;

revoke all on function public.acq_set_webhook_secret(uuid, text) from public, anon;
revoke all on function public.acq_prepare_webhook_test(uuid) from public, anon;
revoke all on function public.acq_create_api_key(uuid, text) from public, anon;
revoke all on function public.acq_regenerate_join_code(uuid) from public, anon;
revoke all on function public.acq_accept_invite(text) from public, anon;
revoke all on function public.acq_clone_business(uuid, text) from public, anon;
grant execute on function public.acq_set_webhook_secret(uuid, text) to authenticated;
grant execute on function public.acq_prepare_webhook_test(uuid) to authenticated;
grant execute on function public.acq_create_api_key(uuid, text) to authenticated;
grant execute on function public.acq_regenerate_join_code(uuid) to authenticated;
grant execute on function public.acq_accept_invite(text) to authenticated;
grant execute on function public.acq_clone_business(uuid, text) to authenticated;

create or replace function public.acq_lookup_api_key(p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.acq_api_keys%rowtype;
begin
  if p_hash is null or length(p_hash) < 32 then
    return jsonb_build_object('ok', false);
  end if;
  select * into v_row from public.acq_api_keys where token_hash = p_hash and revoked_at is null;
  if v_row.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'business_id', v_row.business_id, 'key_id', v_row.id);
end;
$$;

revoke all on function public.acq_lookup_api_key(text) from public, anon, authenticated;
grant execute on function public.acq_lookup_api_key(text) to service_role;
