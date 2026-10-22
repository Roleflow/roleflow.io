-- Diego's Instagram setter is engine agent eujfwcrm (Roleflow Acquisition).
-- udnnperp (VAM) is the website chat bot and is blocked from acquisition.
-- A new account owns an acquisition workspace even when the person is an admin
-- who can already read other businesses.

alter table public.tailortalk_agents
  add column if not exists acquisition_blocked boolean not null default false;

update public.tailortalk_agents
set acquisition_blocked = true,
    updated_at = now()
where tailortalk_agent_id = 'udnnperp';

select public.tailortalk_upsert_agent(
  'eujfwcrm',
  'Roleflow Acquisition',
  null,
  null,
  null,
  '["instagram"]'::jsonb,
  null,
  null,
  false
);

update public.tailortalk_agents
set acquisition_blocked = false,
    channels = '["instagram"]'::jsonb,
    updated_at = now()
where tailortalk_agent_id = 'eujfwcrm';

update public.acq_setter_links
set external_agent_id = null,
    status = case when status = 'connected' then 'pending' else status end,
    updated_at = now()
where external_agent_id = 'udnnperp';

create or replace function public.acq_put_tt_secret(
  p_business uuid,
  p_api_key text,
  p_agent_id text,
  p_webhook_secret text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_business is null
     or p_api_key is null or length(btrim(p_api_key)) < 8
     or p_agent_id is null or length(btrim(p_agent_id)) = 0
     or p_webhook_secret is null or length(btrim(p_webhook_secret)) < 16 then
    raise exception 'missing secret';
  end if;
  if btrim(p_agent_id) = 'udnnperp' or exists (
    select 1 from public.tailortalk_agents
    where tailortalk_agent_id = btrim(p_agent_id)
      and acquisition_blocked
  ) then
    raise exception 'This engine agent is not used for acquisition.';
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  if v_key is null or length(v_key) < 16 then
    raise exception 'token key missing';
  end if;
  insert into private.tt_business_secrets (
    business_id, api_key_encrypted, agent_id_encrypted, webhook_secret_encrypted
  ) values (
    p_business,
    extensions.pgp_sym_encrypt(btrim(p_api_key), v_key),
    extensions.pgp_sym_encrypt(btrim(p_agent_id), v_key),
    extensions.pgp_sym_encrypt(btrim(p_webhook_secret), v_key)
  )
  on conflict (business_id) do update
    set api_key_encrypted = excluded.api_key_encrypted,
        agent_id_encrypted = excluded.agent_id_encrypted,
        webhook_secret_encrypted = excluded.webhook_secret_encrypted,
        updated_at = now();
end;
$$;

create or replace function public.acq_tt_businesses_for_tt_agent(p_agent text)
returns table (business_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_agent is null or btrim(p_agent) = '' or btrim(p_agent) = 'udnnperp' then
    return;
  end if;
  if exists (
    select 1 from public.tailortalk_agents
    where tailortalk_agent_id = btrim(p_agent)
      and acquisition_blocked
  ) then
    return;
  end if;
  select value into v_key from private.acquisition_settings where key = 'tt_token_key';
  if v_key is null then
    return;
  end if;
  return query
  select s.business_id
  from private.tt_business_secrets s
  join public.acq_settings a on a.agent_id = s.business_id
  join public.acq_setter_links l on l.business_id = s.business_id
  where a.setter_provider in ('engine', 'tailortalk')
    and l.status = 'connected'
    and extensions.pgp_sym_decrypt(s.agent_id_encrypted, v_key) = btrim(p_agent);
end;
$$;

revoke all on function public.acq_tt_businesses_for_tt_agent(text) from public, anon, authenticated;
grant execute on function public.acq_tt_businesses_for_tt_agent(text) to service_role;

create or replace view public.engine_registry
with (security_invoker = true) as
select
  id,
  tailortalk_agent_id as external_agent_id,
  agent_name,
  label,
  profile_id,
  client_id,
  channels,
  prompt_sections,
  prompt_version_id,
  prompt_updated_at,
  tailortalk_created_at as created_remote,
  archived,
  last_synced_at,
  regexp_replace(coalesce(last_sync_error, ''), 'tailortalk', 'setter engine', 'gi') as last_sync_error,
  last_activity_at,
  acquisition_blocked
from public.tailortalk_agents;

grant select on public.engine_registry to authenticated;

create or replace function public.acq_ensure_owned_workspace(p_user uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_email text;
  v_name text;
  v_code text;
begin
  if p_user is null then
    raise exception 'not allowed';
  end if;
  if auth.uid() is distinct from p_user
     and coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin', 'supabase_auth_admin') then
    raise exception 'not allowed';
  end if;
  select lower(email) into v_email from public.profiles where id = p_user;
  if v_email is null or v_email = '' then
    select lower(coalesce(email, '')) into v_email from auth.users where id = p_user;
  end if;
  select id into v_id
  from public.acq_workspaces
  where owner_id = p_user
  order by created_at
  limit 1;
  if v_id is null then
    v_name := left(btrim(coalesce(nullif(p_name, ''), 'Acquisition')), 80);
    if v_email = 'diego@roleflow.io' then
      v_name := 'Roleflow';
    end if;
    if v_name is null or char_length(btrim(v_name)) = 0 then
      v_name := 'Acquisition';
    end if;
    v_code := lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    insert into public.acq_workspaces (owner_id, name, join_code)
    values (p_user, v_name, v_code)
    returning id into v_id;
  end if;
  insert into public.acq_members (business_id, user_id, role, status)
  values (v_id, p_user, 'owner', 'active')
  on conflict (business_id, user_id) do nothing;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform public.acq_ensure(v_id);
  if v_email = 'diego@roleflow.io' then
    update public.acq_settings
      set setter_provider = 'engine'
      where agent_id = v_id;
    insert into public.acq_setter_links (
      business_id, provider, status, requested_handle, external_agent_id, updated_at
    ) values (
      v_id, 'engine', 'pending', 'roleflow.io', 'eujfwcrm', now()
    )
    on conflict (business_id) do update
      set provider = 'engine',
          requested_handle = coalesce(nullif(public.acq_setter_links.requested_handle, ''), 'roleflow.io'),
          external_agent_id = 'eujfwcrm',
          status = case
            when public.acq_setter_links.status = 'connected'
             and public.acq_setter_links.external_agent_id = 'eujfwcrm'
            then 'connected'
            else 'pending'
          end,
          updated_at = now();
  end if;
  return v_id;
end;
$$;

revoke all on function public.acq_ensure_owned_workspace(uuid, text) from public, anon;
grant execute on function public.acq_ensure_owned_workspace(uuid, text) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.acq_ensure_owned_workspace(uuid, text) to supabase_auth_admin;
  end if;
end
$$;

create or replace function public.acq_open_workspace(p_name text default 'Acquisition')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  v_id := public.acq_ensure_owned_workspace(auth.uid(), p_name);
  return jsonb_build_object('ok', true, 'agent_id', v_id, 'business_id', v_id);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited uuid;
begin
  insert into public.profiles (id, full_name, email, instagram)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'instagram', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when public.profiles.full_name = '' then excluded.full_name
          else public.profiles.full_name
        end,
        instagram = case
          when public.profiles.instagram = '' then excluded.instagram
          else public.profiles.instagram
        end,
        updated_at = now();

  insert into public.onboarding_submissions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  if lower(coalesce(new.email, '')) = 'diego@roleflow.io' then
    insert into public.admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;

  begin
    invited := nullif(new.raw_user_meta_data->>'invite_member_id', '')::uuid;
  exception when invalid_text_representation then
    invited := null;
  end;
  if invited is not null then
    update public.business_members
      set user_id = new.id,
          status = 'active',
          accepted_at = now()
      where id = invited
        and status = 'pending'
        and lower(email) = lower(coalesce(new.email, ''));
  end if;

  perform public.acq_ensure_owned_workspace(new.id, null);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.acq_store_diego_engine_token(p_api_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
  v_agent uuid;
  v_business uuid;
  v_hook text;
  v_existing private.tt_business_secrets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  if p_api_key is null or length(btrim(p_api_key)) < 8 then
    raise exception 'missing secret';
  end if;
  select id into v_agent
  from public.tailortalk_agents
  where tailortalk_agent_id = 'eujfwcrm';
  if v_agent is null then
    raise exception 'engine agent is not registered';
  end if;
  perform public.tailortalk_put_secret(v_agent, btrim(p_api_key));
  select w.id into v_business
  from public.acq_workspaces w
  join public.profiles p on p.id = w.owner_id
  where lower(p.email) = 'diego@roleflow.io'
  order by w.created_at
  limit 1;
  if v_business is not null then
    select value into v_key from private.acquisition_settings where key = 'tt_token_key';
    if v_key is null or length(v_key) < 16 then
      raise exception 'token key missing';
    end if;
    select * into v_existing from private.tt_business_secrets where business_id = v_business;
    if v_existing.business_id is null then
      v_hook := encode(extensions.gen_random_bytes(24), 'hex');
      insert into private.tt_business_secrets (
        business_id, api_key_encrypted, agent_id_encrypted, webhook_secret_encrypted
      ) values (
        v_business,
        extensions.pgp_sym_encrypt(btrim(p_api_key), v_key),
        extensions.pgp_sym_encrypt('eujfwcrm', v_key),
        extensions.pgp_sym_encrypt(v_hook, v_key)
      );
    else
      update private.tt_business_secrets
        set api_key_encrypted = extensions.pgp_sym_encrypt(btrim(p_api_key), v_key),
            agent_id_encrypted = extensions.pgp_sym_encrypt('eujfwcrm', v_key),
            updated_at = now()
        where business_id = v_business;
    end if;
    perform public.acq_ensure_owned_workspace(
      (select owner_id from public.acq_workspaces where id = v_business),
      null
    );
    update public.acq_setter_links
      set provider = 'engine',
          external_agent_id = 'eujfwcrm',
          requested_handle = coalesce(nullif(requested_handle, ''), 'roleflow.io'),
          status = case
            when external_agent_id = 'eujfwcrm' and status = 'connected' then 'connected'
            else 'pending'
          end,
          updated_at = now()
      where business_id = v_business;
  end if;
  return jsonb_build_object(
    'ok', true,
    'external_agent_id', 'eujfwcrm',
    'business_id', v_business,
    'pending', true
  );
end;
$$;

revoke all on function public.acq_store_diego_engine_token(text) from public, anon, authenticated;
grant execute on function public.acq_store_diego_engine_token(text) to service_role;
