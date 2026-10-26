-- NOT APPLIED.
-- Business model keys for the client dashboard.
-- Do not run this against production from the repo. Apply it yourself when ready.
--
-- The encrypted table already exists (private.business_llm_secrets) and is
-- revoked from public, anon, and authenticated. This migration does not
-- recreate it and does not delete any key. A key is encrypted with
-- extensions.pgp_sym_encrypt and the server-held private.acquisition_settings
-- value llm_token_key. acq_llm_key_hints returns provider and last4 only.
-- acq_llm_read_key stays service_role only, so the browser never receives
-- the key after save.
--
-- Saving or removing a key requires the workspace owner, an active member
-- with role owner, or a platform admin. Editors and viewers cannot set it.

create or replace function public.acq_can_manage_model_key(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_workspace is not null and (
    public.is_admin()
    or exists (
      select 1 from public.acq_workspaces w
      where w.id = p_workspace
        and w.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.acq_members m
      where m.business_id = p_workspace
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = 'owner'
    )
  );
$$;

revoke all on function public.acq_can_manage_model_key(uuid) from public, anon;
grant execute on function public.acq_can_manage_model_key(uuid) to authenticated, service_role;

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
  if auth.uid() is null or public.acq_can_manage_model_key(p_business) is not true then
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
  if auth.uid() is null or public.acq_can_manage_model_key(p_business) is not true then
    raise exception 'forbidden';
  end if;
  v_provider := lower(btrim(coalesce(p_provider, '')));
  delete from private.business_llm_secrets
  where business_id = p_business and provider = v_provider;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on table private.business_llm_secrets from public, anon, authenticated;
revoke all on function public.acq_llm_save_key(uuid, text, text, text) from public, anon;
revoke all on function public.acq_llm_clear_key(uuid, text) from public, anon;
revoke all on function public.acq_llm_read_key(uuid, text) from public, anon, authenticated;
grant execute on function public.acq_llm_save_key(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.acq_llm_clear_key(uuid, text) to authenticated, service_role;
grant execute on function public.acq_llm_read_key(uuid, text) to service_role;

comment on table private.business_llm_secrets is
  'Per-business model API keys. Encrypted with pgp_sym_encrypt. Clients see last4 only.';
