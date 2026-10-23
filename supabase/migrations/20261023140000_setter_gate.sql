-- The model a workspace prefers for the live setter.
-- grok-4.3 is the default. grok-4.7 is the escalation model.

alter table public.acq_settings
  add column if not exists setter_model text not null default 'grok-4.3';

alter table public.acq_settings drop constraint if exists acq_settings_setter_model_check;
alter table public.acq_settings
  add constraint acq_settings_setter_model_check check (setter_model in ('grok-4.3', 'grok-4.7'));
