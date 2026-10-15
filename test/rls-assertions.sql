-- Proves client isolation and admin access after the migration.
-- Run as a superuser against a database where the migration has been applied.

insert into auth.users (id, email, raw_user_meta_data)
select v.id, v.email, v.meta || jsonb_build_object('access_code', s.access_code)
from (
  values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'ava@northstar.example', '{"full_name":"Ava Shah","instagram":"@northstar"}'::jsonb),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'ben@other.example', '{"full_name":"Ben Cole","instagram":"@bencole"}'::jsonb),
    ('33333333-3333-3333-3333-333333333333'::uuid, 'diego@roleflow.io', '{"full_name":"Diego"}'::jsonb)
) as v(id, email, meta)
cross join private.signup_settings s
where s.id = 1
on conflict (id) do nothing;

update public.onboarding_submissions
  set answers = '{"businessName":"Northstar Coaching","clientName":"Ava Shah"}'::jsonb,
      step_index = 1,
      status = 'in_progress'
  where user_id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  n int;
begin
  if not exists (select 1 from public.admins where user_id = '33333333-3333-3333-3333-333333333333') then
    raise exception 'diego@roleflow.io was not added to admins';
  end if;

  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles;
  if n <> 1 then
    raise exception 'client A saw % profiles, expected 1', n;
  end if;
  select count(*) into n from public.onboarding_submissions;
  if n <> 1 then
    raise exception 'client A saw % submissions, expected 1', n;
  end if;
  select count(*) into n from public.admins;
  if n <> 0 then
    raise exception 'client A saw % admin rows, expected 0', n;
  end if;
  select count(*) into n from public.admin_notes;
  if n <> 0 then
    raise exception 'client A saw % notes, expected 0', n;
  end if;
  begin
    update public.onboarding_submissions set status = 'live' where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'client A was allowed to mark the account live';
  exception
    when others then
      if sqlerrm = 'client A was allowed to mark the account live' then
        raise;
      end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  execute 'set local role authenticated';
  select count(*) into n from public.onboarding_submissions where user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 0 then
    raise exception 'client B read client A submission';
  end if;
  begin
    update public.profiles set full_name = 'Stolen' where id = '11111111-1111-1111-1111-111111111111';
    if found then
      raise exception 'client B updated client A profile';
    end if;
  exception
    when others then
      if sqlerrm = 'client B updated client A profile' then
        raise;
      end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles;
  if n < 3 then
    raise exception 'admin saw % profiles, expected at least 3', n;
  end if;
  update public.onboarding_submissions
    set status = 'integrated'
    where user_id = '11111111-1111-1111-1111-111111111111';
  insert into public.admin_notes (client_id, author_id, body)
  values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'Ready for the setter.');
  reset role;

  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  execute 'set local role authenticated';
  begin
    update public.onboarding_submissions
      set answers = '{"businessName":"Changed"}'::jsonb
      where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'client A edited an integrated onboarding';
  exception
    when others then
      if sqlerrm = 'client A edited an integrated onboarding' then
        raise;
      end if;
  end;
  reset role;
end $$;

-- Applications tracker: clients and anon cannot read or write. Admins can.
do $$
declare
  n int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  execute 'set local role authenticated';
  select count(*) into n from public.setter_applications;
  if n <> 0 then
    raise exception 'client A saw % applications, expected 0', n;
  end if;
  begin
    insert into public.setter_applications (offer, owner) values ('Stolen offer', 'Stolen');
    raise exception 'client A inserted an application';
  exception
    when others then
      if sqlerrm = 'client A inserted an application' then
        raise;
      end if;
  end;
  update public.setter_applications set notes = 'stolen' where owner = 'Melisa Estrada';
  if found then
    raise exception 'client A updated an application';
  end if;
  reset role;

  execute 'set local role anon';
  begin
    perform 1 from public.setter_applications;
    raise exception 'anon read applications';
  exception
    when others then
      if sqlerrm = 'anon read applications' then
        raise;
      end if;
      if sqlerrm not like '%permission denied%' then
        raise;
      end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  execute 'set local role authenticated';
  select count(*) into n from public.setter_applications;
  if n <> 13 then
    raise exception 'admin saw % applications, expected 13', n;
  end if;
  select count(*) into n from public.setter_applications
    where owner = 'Melisa Estrada'
      and stage = 'Sent'
      and channel = 'IG DM'
      and instagram = '@melisaestraday'
      and date_sent = date '2026-10-14'
      and video_url = 'https://share.descript.com/view/EQKsq9fa7Jh';
  if n <> 1 then
    raise exception 'Melisa Estrada was not marked sent';
  end if;
  select count(*) into n from public.setter_applications
    where owner = 'Jimmy Evans'
      and stage = 'Not sent'
      and offer = 'Stock trading'
      and instagram = '@stocknavigators'
      and video_url = 'https://share.descript.com/view/ESvdUvydBxh'
      and notes = 'IG @stocknavigators has DMs off; recruiter ian@dmsetting.com';
  if n <> 1 then
    raise exception 'Jimmy Evans was not seeded as not sent';
  end if;
  if exists (
    select 1 from public.setter_applications
    where offer ilike '%atelium%'
      or niche ilike '%atelium%'
      or owner ilike '%schemionek%'
      or owner ilike '%atelium%'
  ) then
    raise exception 'Atelium Academy was seeded';
  end if;
  update public.setter_applications
    set follow_up_date = date '2026-10-20'
    where owner = 'Melisa Estrada';
  if not found then
    raise exception 'admin could not update an application';
  end if;
  reset role;

  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    perform 1 from public.setter_applications;
    raise exception 'logged-out role read applications';
  exception
    when others then
      if sqlerrm = 'logged-out role read applications' then
        raise;
      end if;
  end;
  reset role;
end $$;
