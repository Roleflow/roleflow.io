-- pgcrypto lives in the extensions schema. Functions locked to
-- search_path = public could not see gen_random_bytes or digest, so opening
-- a workspace failed before a business id existed.

update public.acq_workspaces
  set join_code = lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8))
  where join_code is null;

create or replace function public.acq_open_workspace(p_name text default 'Acquisition')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := left(btrim(coalesce(nullif(p_name, ''), 'Acquisition')), 80);
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  if v_name is null or char_length(btrim(v_name)) = 0 then
    v_name := 'Acquisition';
  end if;
  select id into v_id
  from public.acq_workspaces
  where owner_id = auth.uid()
  order by created_at
  limit 1;
  if v_id is null then
    v_code := lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    insert into public.acq_workspaces (owner_id, name, join_code)
    values (auth.uid(), v_name, v_code)
    returning id into v_id;
  end if;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_id, auth.uid(), 'owner', 'active')
  on conflict (business_id, user_id) do nothing;
  perform public.acq_ensure(v_id);
  return jsonb_build_object('ok', true, 'agent_id', v_id, 'business_id', v_id);
end;
$$;

create or replace function public.acq_worker_issue(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_id uuid;
begin
  if not public.acq_can_edit(p_business) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;
  v_raw := 'rfw_' || encode(extensions.gen_random_bytes(32), 'hex');
  update public.acq_workers
    set enabled = false, status = 'offline', rotated_at = now()
    where business_id = p_business and enabled;
  insert into public.acq_workers (business_id, key_prefix, key_hash, enabled, status)
  values (p_business, left(v_raw, 12), encode(extensions.digest(v_raw, 'sha256'), 'hex'), true, 'offline')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'worker_id', v_id, 'api_key', v_raw, 'prefix', left(v_raw, 12));
end;
$$;

create or replace function public.acq_worker_auth(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.acq_workers%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  if p_key is null or length(p_key) < 20 then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  select * into v_row
  from public.acq_workers
  where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if v_row.id is null or not v_row.enabled then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  update public.acq_workers
    set last_heartbeat_at = now(),
        status = case when status = 'paused' then 'paused' else 'online' end
    where id = v_row.id;
  return jsonb_build_object(
    'ok', true,
    'business_id', v_row.business_id,
    'worker_id', v_row.id,
    'paused', v_row.status = 'paused'
  );
end;
$$;
