-- Proves client isolation and admin access after the migration.
-- Run as a superuser against a database where the migration has been applied.

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'ava@northstar.example', '{"full_name":"Ava Shah","instagram":"@northstar"}'),
  ('22222222-2222-2222-2222-222222222222', 'ben@other.example', '{"full_name":"Ben Cole","instagram":"@bencole"}'),
  ('33333333-3333-3333-3333-333333333333', 'diego@roleflow.io', '{"full_name":"Diego"}')
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
