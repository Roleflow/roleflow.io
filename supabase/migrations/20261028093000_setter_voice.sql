-- NOT APPLIED.
-- Human ↔ AI control for the setter. 0 is more human. 100 is more consistent.
-- Do not run this against production from the repo. Apply it yourself when ready.
-- It does not drop tables and it does not turn a setter on.

alter table public.acq_settings
  add column if not exists setter_voice integer not null default 50;

alter table public.acq_settings drop constraint if exists acq_settings_setter_voice_check;
alter table public.acq_settings
  add constraint acq_settings_setter_voice_check
  check (setter_voice between 0 and 100);

comment on column public.acq_settings.setter_voice is
  '0 sounds more human. 100 sounds more consistent. Claude 5 uses prompt guidance instead of temperature.';

alter table public.acq_agent_prompt_versions
  add column if not exists setter_voice integer;

alter table public.acq_agent_prompt_versions drop constraint if exists acq_agent_prompt_versions_setter_voice_check;
alter table public.acq_agent_prompt_versions
  add constraint acq_agent_prompt_versions_setter_voice_check
  check (setter_voice is null or setter_voice between 0 and 100);
