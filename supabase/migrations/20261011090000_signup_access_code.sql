-- Sign-up access code.
--
-- The code is stored only in private.signup_settings. That schema is not in the
-- API allow-list, and the table is not granted to anon or authenticated.
--
-- Change the code later (SQL editor, as the database owner):
--   update private.signup_settings set access_code = 'NewCode' where id = 1;
--
-- Every new auth.users row must include raw_user_meta_data.access_code equal to
-- the stored value (case-sensitive). This trigger rejects anything else, then
-- removes access_code so it is not kept on the user. Re-running this file does
-- not overwrite a code you already changed.
--
-- Adding a user from the Auth dashboard also goes through this trigger. Put the
-- current code in that user's metadata or the insert is rejected.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.signup_settings (
  id integer primary key,
  access_code text not null,
  constraint signup_settings_one_row check (id = 1)
);

insert into private.signup_settings (id, access_code)
values (1, 'Roleflow2026')
on conflict (id) do nothing;

revoke all on table private.signup_settings from public, anon, authenticated;

create or replace function private.enforce_signup_access_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected text;
  provided text;
begin
  select access_code into expected
  from private.signup_settings
  where id = 1;

  provided := coalesce(new.raw_user_meta_data, '{}'::jsonb)->>'access_code';

  if provided is distinct from expected then
    raise exception 'Invalid access code';
  end if;

  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'access_code';
  return new;
end;
$$;

revoke execute on function private.enforce_signup_access_code() from public, anon, authenticated;

drop trigger if exists enforce_signup_access_code on auth.users;
create trigger enforce_signup_access_code
  before insert on auth.users
  for each row
  execute function private.enforce_signup_access_code();
