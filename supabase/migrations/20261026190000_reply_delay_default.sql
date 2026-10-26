-- New businesses start with a 30 second minimum reply delay.
-- Rows that already saved a delay are left as they are.

alter table public.acq_settings
  alter column reply_delay_seconds set default 30;
