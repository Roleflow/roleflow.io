-- Official Instagram connect accounts, one-time connect state, and inbound dedupe.
-- Does not insert API keys. The Meta outbox claim skips transport = 'official'.

create table if not exists public.ig_gateway_accounts (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  profile_id text not null,
  account_id text,
  username text,
  status text not null default 'pending',
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ig_gateway_accounts_status_check check (status in ('pending', 'connected', 'error'))
);

create unique index if not exists ig_gateway_accounts_account_idx
  on public.ig_gateway_accounts (account_id)
  where account_id is not null;

create table if not exists public.ig_gateway_states (
  nonce text primary key,
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.ig_gateway_events (
  event_id text primary key,
  business_id uuid references public.acq_workspaces (id) on delete set null,
  event_name text not null default '',
  received_at timestamptz not null default now()
);

alter table public.ig_outbox
  add column if not exists transport text not null default 'meta';

alter table public.ig_outbox drop constraint if exists ig_outbox_transport_check;
alter table public.ig_outbox
  add constraint ig_outbox_transport_check check (transport in ('meta', 'official'));

alter table public.ig_outbox drop constraint if exists ig_outbox_status_check;
alter table public.ig_outbox
  add constraint ig_outbox_status_check check (status in ('pending', 'running', 'done', 'failed', 'blocked', 'not_thread_owner'));

alter table public.ig_gateway_accounts enable row level security;
alter table public.ig_gateway_states enable row level security;
alter table public.ig_gateway_events enable row level security;

revoke all on table public.ig_gateway_accounts from public, anon;
revoke all on table public.ig_gateway_states from public, anon, authenticated;
revoke all on table public.ig_gateway_events from public, anon, authenticated;

grant select on table public.ig_gateway_accounts to authenticated;
grant select, insert, update, delete on table public.ig_gateway_accounts to service_role;
grant select, insert, update, delete on table public.ig_gateway_states to service_role;
grant select, insert, update, delete on table public.ig_gateway_events to service_role;

drop policy if exists ig_gateway_accounts_select on public.ig_gateway_accounts;
create policy ig_gateway_accounts_select on public.ig_gateway_accounts
  for select to authenticated
  using (public.acq_can_read(business_id));

create or replace function public.acq_read_gateway_settings()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
  v_secret text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select value into v_key from private.acquisition_settings where key = 'zernio_api_key';
  select value into v_secret from private.acquisition_settings where key = 'zernio_webhook_secret';
  return jsonb_build_object('api_key', coalesce(v_key, ''), 'webhook_secret', coalesce(v_secret, ''));
end;
$$;

revoke all on function public.acq_read_gateway_settings() from public, anon, authenticated;
grant execute on function public.acq_read_gateway_settings() to service_role;

create or replace function public.acq_gateway_save_profile(p_business uuid, p_profile text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.ig_gateway_accounts (business_id, profile_id, status)
  values (p_business, p_profile, 'pending')
  on conflict (business_id) do update
    set profile_id = excluded.profile_id,
        updated_at = now()
    where ig_gateway_accounts.status <> 'connected';
end;
$$;

revoke all on function public.acq_gateway_save_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.acq_gateway_save_profile(uuid, text) to service_role;

create or replace function public.acq_gateway_issue_state(p_business uuid, p_nonce text, p_expires timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.ig_gateway_states (nonce, business_id, expires_at)
  values (p_nonce, p_business, p_expires);
end;
$$;

revoke all on function public.acq_gateway_issue_state(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.acq_gateway_issue_state(uuid, text, timestamptz) to service_role;

create or replace function public.acq_gateway_connect_account(
  p_business uuid,
  p_nonce text,
  p_account text,
  p_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.ig_gateway_states;
  v_handle text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select * into v_state
  from public.ig_gateway_states
  where nonce = p_nonce
  for update;
  if v_state.nonce is null or v_state.business_id <> p_business or v_state.used_at is not null or v_state.expires_at < now() then
    return jsonb_build_object('ok', false);
  end if;
  update public.ig_gateway_states set used_at = now() where nonce = p_nonce;
  v_handle := nullif(lower(regexp_replace(coalesce(p_username, ''), '^@+', '')), '');
  update public.ig_gateway_accounts
    set account_id = nullif(p_account, ''),
        username = v_handle,
        status = 'connected',
        connected_at = coalesce(connected_at, now()),
        updated_at = now()
    where business_id = p_business;
  insert into public.ig_connections (business_id, username, status, last_error, connected_at, updated_at)
  values (p_business, v_handle, 'connected', null, now(), now())
  on conflict (business_id) do update
    set username = coalesce(excluded.username, public.ig_connections.username),
        status = 'connected',
        last_error = null,
        connected_at = coalesce(public.ig_connections.connected_at, now()),
        updated_at = now();
  return jsonb_build_object('ok', true, 'username', v_handle);
end;
$$;

revoke all on function public.acq_gateway_connect_account(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.acq_gateway_connect_account(uuid, text, text, text) to service_role;

create or replace function public.acq_gateway_seen_event(p_event text, p_business uuid, p_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.ig_gateway_events (event_id, business_id, event_name)
  values (p_event, p_business, left(coalesce(p_name, ''), 80))
  on conflict (event_id) do nothing
  returning event_id into v_new;
  return v_new is null;
end;
$$;

revoke all on function public.acq_gateway_seen_event(text, uuid, text) from public, anon, authenticated;
grant execute on function public.acq_gateway_seen_event(text, uuid, text) to service_role;

create or replace function public.acq_gateway_store_inbound(
  p_business uuid,
  p_sender text,
  p_username text,
  p_conversation text,
  p_external text,
  p_body text,
  p_at timestamptz,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text;
  v_handle text;
  v_contact uuid;
  v_conversation uuid;
  v_thread uuid;
  v_state text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  v_sender := nullif(left(coalesce(p_sender, ''), 80), '');
  if v_sender is null then
    return jsonb_build_object('ok', false);
  end if;
  v_handle := nullif(lower(regexp_replace(coalesce(p_username, ''), '^@+', '')), '');
  v_state := case when p_kind = 'comment' then 'comment_to_dm' else 'qualification' end;
  insert into public.acq_contacts (business_id, external_id, name, ig_handle, source_detail, last_message_at)
  values (p_business, v_sender, coalesce(v_handle, ''), v_handle, 'instagram', p_at)
  on conflict (business_id, external_id) do update
    set ig_handle = coalesce(excluded.ig_handle, public.acq_contacts.ig_handle),
        last_message_at = excluded.last_message_at,
        updated_at = now()
  returning id into v_contact;
  select id into v_conversation from public.acq_conversations where contact_id = v_contact;
  if v_conversation is null then
    insert into public.acq_conversations (business_id, contact_id, external_id, status)
    values (p_business, v_contact, left(coalesce(nullif(p_conversation, ''), v_sender), 200), 'warm')
    returning id into v_conversation;
  else
    update public.acq_conversations
      set external_id = coalesce(nullif(p_conversation, ''), external_id),
          updated_at = now()
      where id = v_conversation;
  end if;
  insert into public.acq_messages (business_id, conversation_id, external_id, role, body, sent_at)
  values (
    p_business,
    v_conversation,
    left(p_external, 200),
    case when p_kind = 'sent' then 'assistant' else 'user' end,
    left(coalesce(p_body, ''), 4000),
    p_at
  )
  on conflict (conversation_id, external_id) do nothing;
  insert into public.ig_threads (business_id, igsid, username, state, last_user_message_at)
  values (p_business, v_sender, v_handle, v_state, p_at)
  on conflict (business_id, igsid) do update
    set username = coalesce(excluded.username, public.ig_threads.username),
        last_user_message_at = case
          when p_kind = 'sent' then public.ig_threads.last_user_message_at
          else excluded.last_user_message_at
        end,
        followup_count = case when p_kind = 'sent' then public.ig_threads.followup_count else 0 end,
        updated_at = now()
  returning id into v_thread;
  insert into public.ig_messages (business_id, thread_id, direction, body, meta_mid, kind)
  values (
    p_business,
    v_thread,
    case when p_kind = 'sent' then 'out' else 'in' end,
    left(coalesce(p_body, ''), 4000),
    nullif(left(p_external, 200), ''),
    case when p_kind = 'comment' then 'comment' else 'text' end
  )
  on conflict (meta_mid) do nothing;
  return jsonb_build_object('ok', true, 'conversation_id', v_conversation, 'thread_id', v_thread);
end;
$$;

revoke all on function public.acq_gateway_store_inbound(uuid, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.acq_gateway_store_inbound(uuid, text, text, text, text, text, timestamptz, text) to service_role;

create or replace function public.acq_gateway_enqueue(
  p_business uuid,
  p_thread uuid,
  p_kind text,
  p_payload jsonb,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_kind not in ('reply', 'comment_private') then
    raise exception 'unknown kind';
  end if;
  insert into public.ig_outbox (business_id, thread_id, kind, payload, run_at, idempotency_key, transport)
  values (
    p_business,
    p_thread,
    p_kind,
    coalesce(p_payload, '{}'::jsonb) - 'api_key' - 'token' - 'authorization' - 'webhook_secret',
    now(),
    left(p_key, 200),
    'official'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.ig_outbox where idempotency_key = left(p_key, 200);
  end if;
  return v_id;
end;
$$;

revoke all on function public.acq_gateway_enqueue(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.acq_gateway_enqueue(uuid, uuid, text, jsonb, text) to service_role;

create or replace function public.acq_claim_outbox(p_limit integer)
returns setof public.ig_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  with picked as (
    select id
    from public.ig_outbox
    where status = 'pending' and run_at <= now() and transport = 'meta'
    order by run_at
    limit least(greatest(coalesce(p_limit, 10), 1), 20)
    for update skip locked
  )
  update public.ig_outbox o
    set status = 'running', attempts = o.attempts + 1
    from picked
    where o.id = picked.id
    returning o.*;
end;
$$;

create or replace function public.acq_claim_gateway_outbox(p_limit integer)
returns setof public.ig_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  with picked as (
    select id
    from public.ig_outbox
    where status = 'pending' and run_at <= now() and transport = 'official'
    order by run_at
    limit least(greatest(coalesce(p_limit, 5), 1), 10)
    for update skip locked
  )
  update public.ig_outbox o
    set status = 'running', attempts = o.attempts + 1
    from picked
    where o.id = picked.id
    returning o.*;
end;
$$;

revoke all on function public.acq_claim_gateway_outbox(integer) from public, anon, authenticated;
grant execute on function public.acq_claim_gateway_outbox(integer) to service_role;
