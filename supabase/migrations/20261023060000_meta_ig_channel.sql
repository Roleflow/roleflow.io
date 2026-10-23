-- Channel for engine-outbox drafts. tailortalk stays the default.
-- The panel has no control for this column.

alter table public.acq_settings
  add column if not exists channel_provider text not null default 'tailortalk';

alter table public.acq_settings drop constraint if exists acq_settings_channel_provider_check;
alter table public.acq_settings
  add constraint acq_settings_channel_provider_check
  check (channel_provider in ('tailortalk', 'meta'));

comment on column public.acq_settings.channel_provider is
  'Delivery channel for engine outbox drafts. tailortalk is the default. meta uses the Roleflow Instagram Send API. There is no control for this in the panel.';

create index if not exists ig_connections_refresh_idx
  on public.ig_connections (expires_at)
  where status = 'connected';
