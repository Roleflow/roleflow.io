-- New businesses do not inherit a shared calendar link.
-- Existing rows keep whatever link was already saved for that business.
alter table public.acq_settings
  alter column booking_fallback_url set default '';
