-- Mail Room, Sales Desk, and Back Office stations.
-- Matches the live migration hq_station_revenue_back_office (version 20261018133520).
-- Adds mail_room, sales_desk, and back_office to the hq_tasks and hq_agents
-- station checks and to hq_agent_dispatch.
-- Setter stations (leads_in, qualify, book_call, follow_up, report, overseer)
-- arrive in the next migration. A second apply keeps any of those already allowed.

do $m$
declare
  v_table text;
  v_def text;
  v_list text;
  v_extra text;
  v_stations text[];
  v_extras text[] := array['leads_in', 'qualify', 'book_call', 'follow_up', 'report', 'overseer'];
begin
  foreach v_table in array array['hq_tasks', 'hq_agents']
  loop
    select pg_get_constraintdef(c.oid)
      into v_def
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = v_table
      and c.conname = v_table || '_station_check';

    v_stations := array[
      'research', 'writers_room', 'film_studio', 'edit_bay',
      'shipping_dock', 'client_floor', 'chief_of_staff',
      'mail_room', 'sales_desk', 'back_office'
    ];
    foreach v_extra in array v_extras
    loop
      if v_def is not null and position(quote_literal(v_extra) in v_def) > 0 then
        v_stations := v_stations || v_extra;
      end if;
    end loop;

    select string_agg(quote_literal(s), ', ' order by ord)
      into v_list
    from unnest(v_stations) with ordinality as u(s, ord);

    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_station_check');
    execute format(
      'alter table public.%I add constraint %I check (station is null or station in (%s))',
      v_table,
      v_table || '_station_check',
      v_list
    );
  end loop;
end
$m$;

do $m$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.hq_agent_dispatch(text,text,jsonb)'::regprocedure)
    into v_def;

  -- Current live already lists these three, along with the setter stations.
  if position('mail_room' in v_def) > 0
     and position('sales_desk' in v_def) > 0
     and position('back_office' in v_def) > 0
     and position('Station must be' in v_def) > 0
     and position('back_office' in substring(v_def from position('Station must be' in v_def))) > 0 then
    return;
  end if;

  v_new := v_def;
  -- Form stored on the live database when this migration first ran.
  v_new := replace(
    v_new,
    $s$'shipping_dock', 'client_floor', 'chief_of_staff' )$s$,
    $s$'shipping_dock', 'client_floor', 'chief_of_staff', 'mail_room', 'sales_desk', 'back_office' )$s$
  );
  -- Form created by 20261018130000_hq_task_station.sql on a fresh replay.
  v_new := replace(
    v_new,
    $s$        'shipping_dock', 'client_floor', 'chief_of_staff'
      ) then$s$,
    $s$        'shipping_dock', 'client_floor', 'chief_of_staff',
        'mail_room', 'sales_desk', 'back_office'
      ) then$s$
  );
  v_new := replace(
    v_new,
    $s$'Station must be research, writers_room, film_studio, edit_bay, shipping_dock, client_floor, or chief_of_staff.'$s$,
    $s$'Station must be research, writers_room, film_studio, edit_bay, shipping_dock, client_floor, chief_of_staff, mail_room, sales_desk, or back_office.'$s$
  );

  if v_new = v_def or position('back_office' in v_new) = 0 then
    raise exception 'dispatch station list not found';
  end if;
  execute v_new;
end
$m$;
