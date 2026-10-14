-- Prompt generation status for the generate-setter-prompt edge function.
-- Idempotent. Apply in the Supabase SQL editor after the accounts migration.
-- The function uses the service role, so auth.uid() is null and the guard
-- lets it write prompt_text. A signed-in client cannot overwrite the prompt,
-- the generation columns, or the email columns.

alter table public.onboarding_submissions
  add column if not exists generation_status text not null default 'idle',
  add column if not exists generation_error text,
  add column if not exists email_status text not null default 'idle',
  add column if not exists email_error text,
  add column if not exists prompt_generated_at timestamptz;

alter table public.onboarding_submissions
  drop constraint if exists onboarding_submissions_generation_status_check;
alter table public.onboarding_submissions
  add constraint onboarding_submissions_generation_status_check
  check (generation_status in ('idle', 'pending', 'ready', 'failed'));

alter table public.onboarding_submissions
  drop constraint if exists onboarding_submissions_email_status_check;
alter table public.onboarding_submissions
  add constraint onboarding_submissions_email_status_check
  check (email_status in ('idle', 'pending', 'sent', 'failed'));

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
    new.prompt_generated_at = null;
    new.generation_status = 'idle';
    new.generation_error = null;
    new.email_status = 'idle';
    new.email_error = null;
  else
    new.prompt_text = old.prompt_text;
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
