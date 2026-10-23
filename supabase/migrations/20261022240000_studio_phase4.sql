-- Phase 4 sync log. The per-business sync flag stays off.
-- Tokens stay in private.tt_business_secrets. This file does not read them.

update public.acq_settings set studio_setter_sync = false where studio_setter_sync is distinct from false;

create table if not exists public.acq_sync_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  direction text not null,
  action text not null,
  result text not null,
  detail text not null default '',
  created_at timestamptz not null default now(),
  constraint acq_sync_log_direction_check check (direction in ('push', 'pull')),
  constraint acq_sync_log_result_check check (result in ('ok', 'error', 'skipped', 'roleflow_only'))
);

create index if not exists acq_sync_log_business_idx
  on public.acq_sync_log (business_id, created_at desc);

alter table public.acq_sync_log enable row level security;
revoke all on table public.acq_sync_log from public, anon;
grant select on table public.acq_sync_log to authenticated;
grant select, insert on table public.acq_sync_log to service_role;

drop policy if exists acq_sync_log_read on public.acq_sync_log;
create policy acq_sync_log_read on public.acq_sync_log
  for select to authenticated using (public.acq_can_read(business_id));

do $cron$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron or pg_net is not available. The sync tick can be called when both are enabled.';
    return;
  end;
  begin
    perform cron.unschedule('roleflow-setter-sync');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'roleflow-setter-sync',
    '*/15 * * * *',
    $job$
    select net.http_post(
      url := 'https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/roleflow-setter-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce((select value from private.acquisition_settings where key = 'cron_secret'), '')
      ),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 120000
    );
    $job$
  );
end
$cron$;
