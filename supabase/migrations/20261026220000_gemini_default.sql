-- New businesses start on Gemini 3 Flash. A business that already chose
-- another provider, or saved its own key, is left as it is.

alter table public.acq_settings
  alter column llm_setter_provider set default 'gemini';

alter table public.acq_settings
  alter column setter_model set default 'gemini-3-flash-preview';

update public.acq_settings
set llm_setter_provider = 'gemini',
    setter_model = 'gemini-3-flash-preview'
where llm_setter_provider = 'xai'
  and setter_model = 'grok-4.3'
  and llm_setter_own_key = false;
