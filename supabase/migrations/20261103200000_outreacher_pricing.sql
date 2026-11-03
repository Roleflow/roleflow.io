-- Outreacher price term and the monthly growth-fee ledger.
-- Not applied. The usage cron calls outreach-usage, which stays inert until
-- STRIPE_SECRET_KEY and STRIPE_OUTREACH_METER_EVENT_NAME are both set.
-- Until that function is deployed, the scheduled request has nothing to reach.

alter table public.client_machines
  add column if not exists minimum_term_ends_at timestamptz,
  add column if not exists subscription_cancel_at timestamptz;

comment on column public.client_machines.minimum_term_ends_at is
  'Subscription start plus 3 months. A cancellation requested earlier is scheduled for this instant.';

comment on column public.client_machines.subscription_cancel_at is
  'When Stripe will end the subscription. Null while no cancellation is scheduled.';

grant select (minimum_term_ends_at, subscription_cancel_at)
  on public.client_machines to authenticated;

create table if not exists public.outreach_usage_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  fee_cents integer not null,
  currency text not null default 'USD',
  stripe_identifier text,
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  constraint outreach_usage_fee_check check (fee_cents >= 0),
  constraint outreach_usage_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint outreach_usage_period_unique unique (business_id, period_start),
  constraint outreach_usage_identifier_unique unique (stripe_identifier),
  constraint outreach_usage_reported_check check (
    reported_at is null
    or (fee_cents = 0 and stripe_identifier is null)
    or (fee_cents > 0 and stripe_identifier is not null)
  )
);

comment on table public.outreach_usage_reports is
  'One row per business per UTC month. fee_cents is round(attributed acq_deals.amount_cents * share_bps / 10000) for deals closed that month on or after the machine was created. A zero fee is stored and not sent to Stripe. A positive fee is stored only after the billing meter accepts it. Service role only.';

alter table public.outreach_usage_reports enable row level security;

revoke all on public.outreach_usage_reports from public, anon, authenticated;
grant select, insert, update, delete on public.outreach_usage_reports to service_role;

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available (%). Enable both, then re-run to schedule the outreacher usage report.', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule('outreach-usage');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'outreach-usage',
    '15 6 * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/outreach-usage',
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
