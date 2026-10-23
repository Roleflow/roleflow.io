-- Read the Resend key and From address already stored in private.acquisition_settings.
-- Does not insert or replace those values, and does not send mail.

create or replace function public.acq_read_resend_settings()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_key text;
  v_from text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select value into v_key from private.acquisition_settings where key = 'resend_api_key';
  select value into v_from from private.acquisition_settings where key = 'resend_from';
  return jsonb_build_object('api_key', coalesce(v_key, ''), 'from', coalesce(v_from, ''));
end;
$$;

revoke all on function public.acq_read_resend_settings() from public, anon, authenticated;
grant execute on function public.acq_read_resend_settings() to service_role;
