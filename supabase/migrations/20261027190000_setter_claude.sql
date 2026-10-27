-- NOT APPLIED.
-- Claude Sonnet mode for the Agentic Setter.
-- Do not run this against production from the repo. Apply it yourself when ready.
--
-- setter_claude_mode = default uses the platform ANTHROPIC_API_KEY.
-- setter_claude_mode = own uses the encrypted business Claude key.
-- This migration does not recreate private.business_llm_secrets and does not
-- delete a key. The key stays encrypted with extensions.pgp_sym_encrypt and
-- private.acquisition_settings llm_token_key. acq_llm_key_hints returns
-- provider and last4 only. acq_llm_read_key stays service_role only, so the
-- browser never receives the key. The private table is revoked from
-- public, anon, and authenticated, so another business cannot read it.

alter table public.acq_settings
  add column if not exists setter_claude_mode text not null default 'default';

alter table public.acq_settings drop constraint if exists acq_settings_setter_claude_mode_check;
alter table public.acq_settings
  add constraint acq_settings_setter_claude_mode_check
  check (setter_claude_mode in ('default', 'own'));

comment on column public.acq_settings.setter_claude_mode is
  'default uses the platform Claude key. own uses the encrypted business Claude key.';

revoke all on table private.business_llm_secrets from public, anon, authenticated;
revoke all on function public.acq_llm_read_key(uuid, text) from public, anon, authenticated;
grant execute on function public.acq_llm_read_key(uuid, text) to service_role;
