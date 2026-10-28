-- NOT APPLIED.
-- Permanently deletes Caleb Wat, Chad Owens, Dorian, and Thomas Miller.
-- Do not run this against production from the repo.
-- Roleflow (840b08a9-869c-4650-8dc7-f78fdfa0e112) and
-- Value Add Marketing (1351d2ac-79bb-545d-8da0-c49ecff28a47) are not in the list.
--
-- Row counts on 28 Oct 2026, before this file is applied:
--   acq_workspaces 4
--   acq_settings 4
--   acq_members 4
--   business_workforce 32
--   acq_agent_prompts 4
--   acq_prompt_versions 4
--   acq_prompt_current 4
--   engine_registry 4
--   engine_lead_cache 647
--   engine_lead_stats 4
--   engine_prompt_history 4
--   tailortalk_agents 4
--   tailortalk_leads 647
--   tailortalk_agent_stats 4
--   tailortalk_prompt_versions 4
--   private.tailortalk_agent_secrets 4

do $$
declare
  v_ids uuid[] := array[
    'a01eb1d4-645d-4bd8-bcc5-538aca888eb6',
    'f8cb90c7-c26d-4b4a-baf4-da4e684f8fa0',
    'b02ee24a-95f6-4027-bacb-9f4157ca5298',
    'cb3b9823-c4c7-47d5-b130-54569de838d7'
  ]::uuid[];
  v_keep uuid[] := array[
    '840b08a9-869c-4650-8dc7-f78fdfa0e112',
    '1351d2ac-79bb-545d-8da0-c49ecff28a47'
  ]::uuid[];
begin
  if exists (select 1 from unnest(v_ids) as id where id = any (v_keep)) then
    raise exception 'refusing to delete Roleflow or Value Add Marketing';
  end if;

  delete from public.engine_lead_cache where agent_id = any (v_ids);
  delete from public.engine_lead_stats where agent_id = any (v_ids);
  delete from public.engine_prompt_history where agent_id = any (v_ids);
  delete from public.tailortalk_leads where agent_id = any (v_ids);
  delete from public.tailortalk_contacts where agent_id = any (v_ids);
  delete from public.tailortalk_prompt_versions where agent_id = any (v_ids);
  delete from public.tailortalk_agent_stats where agent_id = any (v_ids);
  delete from private.tailortalk_agent_secrets where agent_id = any (v_ids);
  delete from private.tt_business_secrets where business_id = any (v_ids);
  delete from private.ig_token_secrets where business_id = any (v_ids);
  delete from private.business_llm_secrets where business_id = any (v_ids);
  delete from private.google_token_secrets where business_id = any (v_ids);
  delete from public.business_workforce where agent_id = any (v_ids);
  delete from public.acq_prompt_current where business_id = any (v_ids);
  delete from public.acq_prompt_versions where business_id = any (v_ids);
  delete from public.acq_agent_prompt_versions where business_id = any (v_ids);
  delete from public.acq_agent_prompts where business_id = any (v_ids);
  delete from public.acq_members where business_id = any (v_ids);
  delete from public.acq_settings where agent_id = any (v_ids);
  delete from public.acq_workspaces where id = any (v_ids);
  delete from public.tailortalk_agents where id = any (v_ids);
  delete from public.engine_registry where id = any (v_ids);
end
$$;
