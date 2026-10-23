-- Send official Instagram outbox rows that the webhook deferred past 25 seconds.
-- Claim is skip-locked, pending only, and ignores a second row with the same key.

create or replace function public.acq_claim_gateway_outbox(p_limit integer)
returns setof public.ig_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  with picked as (
    select id
    from public.ig_outbox
    where status = 'pending'
      and run_at <= now()
      and transport = 'official'
      and coalesce(payload->>'needsPlan', '') is distinct from 'true'
      and length(btrim(coalesce(payload->>'text', ''))) > 0
    order by run_at
    limit least(greatest(coalesce(p_limit, 5), 1), 10)
    for update skip locked
  )
  update public.ig_outbox o
    set status = 'running', attempts = o.attempts + 1
    from picked
    where o.id = picked.id
    returning o.*;
end;
$$;

revoke all on function public.acq_claim_gateway_outbox(integer) from public, anon, authenticated;
grant execute on function public.acq_claim_gateway_outbox(integer) to service_role;

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, then re-run to schedule the official outbox tick.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('ig-outbox-tick');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'ig-outbox-tick',
    '* * * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/ig-outbox-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select value from private.acquisition_settings where key = 'cron_secret'), '')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    $job$
  );
end
$cron$;
