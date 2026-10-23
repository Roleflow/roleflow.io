-- The account authorized on Instagram becomes that workspace's connection.
-- No handle is required or checked. Disconnect keeps the profile so Connect can run again.

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
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  v_handle := nullif(lower(regexp_replace(coalesce(p_username, ''), '^@+', '')), '');
  begin
    update public.ig_gateway_accounts
      set account_id = nullif(p_account, ''),
          username = v_handle,
          status = 'connected',
          connected_at = coalesce(connected_at, now()),
          updated_at = now()
      where business_id = p_business;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'missing');
    end if;
    insert into public.ig_connections (business_id, username, status, last_error, connected_at, updated_at)
    values (p_business, v_handle, 'connected', null, now(), now())
    on conflict (business_id) do update
      set username = excluded.username,
          status = 'connected',
          last_error = null,
          connected_at = coalesce(public.ig_connections.connected_at, now()),
          updated_at = now();
    update public.ig_gateway_states set used_at = now() where nonce = p_nonce;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'taken');
  end;
  return jsonb_build_object('ok', true, 'username', v_handle);
end;
$$;

revoke all on function public.acq_gateway_connect_account(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.acq_gateway_connect_account(uuid, text, text, text) to service_role;

create or replace function public.acq_gateway_disconnect(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  update public.ig_gateway_accounts
    set account_id = null,
        username = null,
        status = 'pending',
        updated_at = now()
    where business_id = p_business;
  insert into public.ig_connections (business_id, username, status, last_error, updated_at)
  values (p_business, null, 'disconnected', null, now())
  on conflict (business_id) do update
    set username = null,
        status = 'disconnected',
        last_error = null,
        updated_at = now();
  update public.acq_channel_connect_requests
    set status = 'failed',
        updated_at = now()
    where workspace_id = p_business
      and channel = 'instagram'
      and status in ('pending', 'in_progress');
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.acq_gateway_disconnect(uuid) from public, anon, authenticated;
grant execute on function public.acq_gateway_disconnect(uuid) to service_role;
