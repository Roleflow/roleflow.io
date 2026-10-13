-- Access-code trigger checks. Run after both account migrations, as a superuser.

do $$
declare
  code text;
  stored jsonb;
  can_execute boolean;
begin
  select access_code into code from private.signup_settings where id = 1;
  if code is null or btrim(code) = '' then
    raise exception 'signup access code is missing';
  end if;

  select has_function_privilege('authenticated', 'private.enforce_signup_access_code()', 'execute')
    into can_execute;
  if can_execute then
    raise exception 'authenticated can execute the access-code trigger function';
  end if;

  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'no-code@example.com', '{"full_name":"No Code"}');
    raise exception 'signup without a code was allowed';
  exception
    when others then
      if sqlerrm = 'signup without a code was allowed' then
        raise;
      end if;
      if sqlerrm is distinct from 'Invalid access code' then
        raise exception 'unexpected no-code error: %', sqlerrm;
      end if;
  end;

  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'bad-code@example.com',
      jsonb_build_object('access_code', code || 'x')
    );
    raise exception 'wrong code was allowed';
  exception
    when others then
      if sqlerrm = 'wrong code was allowed' then
        raise;
      end if;
      if sqlerrm is distinct from 'Invalid access code' then
        raise exception 'unexpected wrong-code error: %', sqlerrm;
      end if;
  end;

  if code is distinct from lower(code) then
    begin
      insert into auth.users (id, email, raw_user_meta_data)
      values (
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'lower-code@example.com',
        jsonb_build_object('access_code', lower(code))
      );
      raise exception 'lowercase code was allowed';
    exception
      when others then
        if sqlerrm = 'lowercase code was allowed' then
          raise;
        end if;
        if sqlerrm is distinct from 'Invalid access code' then
          raise exception 'unexpected case error: %', sqlerrm;
        end if;
    end;
  end if;

  insert into auth.users (id, email, raw_user_meta_data)
  values (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'good-code@example.com',
    jsonb_build_object('full_name', 'Good Client', 'instagram', '@good', 'access_code', code)
  );

  select raw_user_meta_data into stored
  from auth.users
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  if stored ? 'access_code' then
    raise exception 'access_code was stored on the user';
  end if;
  if stored->>'full_name' is distinct from 'Good Client' then
    raise exception 'full_name was not kept';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      and full_name = 'Good Client'
      and instagram = '@good'
  ) then
    raise exception 'profile was not created from the stripped metadata';
  end if;
end $$;
