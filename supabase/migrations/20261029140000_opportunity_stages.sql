-- NOT APPLIED.
-- Stage history for the opportunities board. Setter updates and board moves both write here.
-- Do not run this against production from the repo.
-- It does not remove a table and does not turn a setter on.

create table if not exists public.acq_stage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  contact_id uuid references public.acq_contacts (id) on delete cascade,
  target_id uuid references public.acq_targets (id) on delete cascade,
  from_state text,
  to_state text,
  actor text not null default 'human',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint acq_stage_events_actor_check check (actor in ('human', 'ai')),
  constraint acq_stage_events_one_lead check (contact_id is not null or target_id is not null)
);

create index if not exists acq_stage_events_business_idx
  on public.acq_stage_events (business_id, created_at desc);

alter table public.acq_stage_events enable row level security;
revoke all on public.acq_stage_events from public, anon;
grant select on public.acq_stage_events to authenticated;
grant select, insert, update, delete on public.acq_stage_events to service_role;

drop policy if exists acq_stage_events_read on public.acq_stage_events;
create policy acq_stage_events_read on public.acq_stage_events
  for select to authenticated
  using (public.acq_can_read(business_id));

create or replace function public.acq_record_crm_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor text;
begin
  if new.crm_state is not distinct from old.crm_state then
    return new;
  end if;
  if tg_table_name = 'acq_contacts' then
    v_business := new.business_id;
  else
    v_business := new.agent_id;
  end if;
  if coalesce(auth.role(), '') = 'service_role' or auth.uid() is null then
    v_actor := 'ai';
  else
    v_actor := 'human';
  end if;
  insert into public.acq_stage_events (business_id, contact_id, target_id, from_state, to_state, actor, created_by)
  values (
    v_business,
    case when tg_table_name = 'acq_contacts' then new.id else null end,
    case when tg_table_name = 'acq_targets' then new.id else null end,
    old.crm_state,
    new.crm_state,
    v_actor,
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists acq_contacts_stage_event on public.acq_contacts;
create trigger acq_contacts_stage_event
  after update of crm_state on public.acq_contacts
  for each row execute function public.acq_record_crm_stage();

drop trigger if exists acq_targets_stage_event on public.acq_targets;
create trigger acq_targets_stage_event
  after update of crm_state on public.acq_targets
  for each row execute function public.acq_record_crm_stage();

revoke all on function public.acq_record_crm_stage() from public, anon, authenticated;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['acq_contacts', 'acq_targets', 'acq_stage_events']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
exception when others then
  raise notice 'opportunity tables were not added to supabase_realtime';
end $$;
