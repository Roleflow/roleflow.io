-- Additive station and workforce-role values for the AI Workforce office.
-- Not applied. The office renders Outreach and Target Comments idle without
-- these values. Do not run this file against the live database from the app.

alter table public.hq_tasks drop constraint if exists hq_tasks_station_check;
alter table public.hq_tasks
  add constraint hq_tasks_station_check check (
    station is null or station in (
      'research', 'writers_room', 'film_studio', 'edit_bay',
      'shipping_dock', 'client_floor', 'chief_of_staff',
      'mail_room', 'sales_desk', 'back_office',
      'leads_in', 'qualify', 'book_call', 'follow_up', 'report', 'overseer',
      'outreach', 'target_comments'
    )
  );

alter table public.business_workforce drop constraint if exists business_workforce_role_check;
alter table public.business_workforce
  add constraint business_workforce_role_check check (
    role in ('outreach', 'follow_up', 'setting', 'target_comments')
  );
