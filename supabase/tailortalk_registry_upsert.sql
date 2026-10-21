-- Exact registry upsert for org ntrtnxfad.
-- Run this in the Supabase SQL editor, or through execute_sql as the
-- service role / postgres, after 20261014180000_tailortalk_registry.sql.
--
-- Do not commit access tokens or live prompt text. Null sections, a null
-- version, and a null token leave whatever is already stored.
--
-- Channels come from the agent object. TailorTalk has no channels array.
-- On 14 October 2026 the integration objects were:
--   insta_integration null and whatsapp_integration null for all five
--   web_integration set for Chad Owens and VAM, null for the other three
-- Every agent still had an insta_settings object, so a null insta_integration
-- is not proof that Instagram is off. Pass '["instagram"]' yourself when you
-- know that channel is connected. The arrays below use only non-null
-- integration objects.
--
-- Live sections are agent_instructions from get_agent_by_id: a JSON array of
-- {"node","instruction"}. The version id and deployed_at are versions[0].id
-- and versions[0].deployed_at from get_prompt_versions (newest first).
-- Pass those three together. A changed version id inserts one history row
-- with the sections you pass.

select public.tailortalk_upsert_agent(
  'afwbuhnx', 'Dorian', null, null, null,
  '[]'::jsonb, '2026-07-29T15:37:58+00:00', null, false
);

select public.tailortalk_upsert_agent(
  'bsojvzgf', 'Caleb Wat', null, null, null,
  '[]'::jsonb, '2026-03-30T08:57:15+00:00', null, false
);

select public.tailortalk_upsert_agent(
  'rojkojbk', 'Thomas Miller', null, null, null,
  '[]'::jsonb, '2026-03-27T13:43:00+00:00', null, false
);

select public.tailortalk_upsert_agent(
  'taongeti', 'Chad Owens', null, null, null,
  '["web"]'::jsonb, '2026-04-10T12:35:39+00:00', null, false
);

select public.tailortalk_upsert_agent(
  'udnnperp', 'VAM', null, null, null,
  '["web"]'::jsonb, '2026-03-27T13:47:04+00:00', null, false
);

select public.tailortalk_upsert_agent(
  'eujfwcrm', 'Roleflow Acquisition', null, null, null,
  '["instagram"]'::jsonb, null, null, false
);

-- VAM is the website chat bot. Do not archive it, and do not use it for acquisition.
update public.tailortalk_agents
set acquisition_blocked = true, updated_at = now()
where tailortalk_agent_id = 'udnnperp';

-- Agents that were not in this registry.
update public.tailortalk_agents
set archived = true, updated_at = now()
where tailortalk_agent_id is not null
  and tailortalk_agent_id not in (
    'afwbuhnx', 'bsojvzgf', 'rojkojbk', 'taongeti', 'udnnperp', 'eujfwcrm'
  );

-- Full call the scheduler should generate per agent. The section text below
-- is an example of the shape, not a live prompt. Replace it, the version id,
-- deployed_at, and the token from the MCP response. Re-running the same
-- version id does not insert another history row.
--
-- select public.tailortalk_upsert_agent(
--   'afwbuhnx',
--   'Dorian',
--   $sections$[
--     {"node":"Identity and mission","instruction":"EXAMPLE ONLY. Replace with agent_instructions."}
--   ]$sections$::jsonb,
--   'version-id-from-get_prompt_versions',
--   'deployed_at-from-that-version',
--   '[]'::jsonb,
--   '2026-07-29T15:37:58+00:00',
--   'paste-access-token',
--   false
-- );
