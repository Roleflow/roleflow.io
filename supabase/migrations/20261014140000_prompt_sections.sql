-- Stores each Tailortalk section on its own so /admin/ can copy them one by one.
-- Idempotent. Apply after 20261014120000_prompt_generation.sql.
-- A signed-in client cannot overwrite prompt_sections. The edge function uses
-- the service role (auth.uid() is null) and can.

alter table public.onboarding_submissions
  add column if not exists prompt_sections jsonb not null default '{}'::jsonb;

create or replace function public.guard_onboarding_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.last_activity_at = now();
  new.user_id = old.user_id;
  new.created_at = old.created_at;

  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if auth.uid() is distinct from old.user_id then
    raise exception 'not allowed';
  end if;

  if old.status in ('integrated', 'live') then
    raise exception 'This onboarding is locked';
  end if;

  if new.status is null or new.status not in ('not_started', 'in_progress', 'submitted') then
    raise exception 'status not allowed';
  end if;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    new.submitted_at = coalesce(old.submitted_at, now());
  end if;

  if new.status <> 'submitted' then
    new.submitted_at = null;
    new.prompt_text = null;
    new.prompt_sections = '{}'::jsonb;
    new.prompt_generated_at = null;
    new.generation_status = 'idle';
    new.generation_error = null;
    new.email_status = 'idle';
    new.email_error = null;
  else
    new.prompt_text = old.prompt_text;
    new.prompt_sections = old.prompt_sections;
    new.prompt_generated_at = old.prompt_generated_at;
    new.generation_status = old.generation_status;
    new.generation_error = old.generation_error;
    new.email_status = old.email_status;
    new.email_error = old.email_error;
    new.submitted_at = coalesce(old.submitted_at, new.submitted_at, now());
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_onboarding_update() from public, anon, authenticated;
