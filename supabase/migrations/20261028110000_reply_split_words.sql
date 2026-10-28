-- NOT APPLIED.
-- Split long setter replies into consecutive messages.
-- Do not run this against production from the repo. Apply it yourself when ready.

alter table public.acq_settings
  add column if not exists reply_split_words integer not null default 15;

alter table public.acq_settings drop constraint if exists acq_settings_reply_split_words_check;
alter table public.acq_settings
  add constraint acq_settings_reply_split_words_check
  check (reply_split_words between 0 and 80);

comment on column public.acq_settings.reply_split_words is
  'Replies over this many words are sent as consecutive messages. 0 sends one message.';
