-- Public qualification submissions.
-- Not applied by the pull request. Apply this file on deploy.
--
-- anon and authenticated cannot read the table. They can only call
-- submit_qualification_lead, which inserts one row and returns its id.
-- The qualified flag is computed from the four scores, not from the client.

create table public.qualification_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  instagram text not null,
  answers jsonb not null,
  qualified boolean not null,
  source_page text not null,
  lang text not null,
  constraint qualification_leads_lang check (lang in ('en', 'es')),
  constraint qualification_leads_email check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

alter table public.qualification_leads enable row level security;

revoke all on table public.qualification_leads from public, anon, authenticated;

create or replace function public.submit_qualification_lead(
  p_name text,
  p_email text,
  p_instagram text,
  p_answers jsonb,
  p_source_page text,
  p_lang text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text := left(btrim(coalesce(p_name, '')), 200);
  clean_email text := left(btrim(coalesce(p_email, '')), 320);
  clean_ig text := left(btrim(coalesce(p_instagram, '')), 80);
  clean_page text := left(btrim(coalesce(p_source_page, '')), 300);
  clean_lang text := case when p_lang = 'es' then 'es' else 'en' end;
  is_fit boolean;
begin
  if clean_name = '' then
    raise exception 'invalid name';
  end if;
  if clean_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email';
  end if;
  if clean_ig = '' then
    raise exception 'invalid instagram';
  end if;
  if clean_page = '' then
    raise exception 'invalid source';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'invalid answers';
  end if;
  if length(p_answers::text) > 8000 then
    raise exception 'invalid answers';
  end if;

  is_fit :=
    (p_answers #>> '{dms,score}') = '1'
    and (p_answers #>> '{offer,score}') = '1'
    and (p_answers #>> '{close,score}') = '1'
    and (p_answers #>> '{cash,score}') = '1';

  insert into public.qualification_leads (name, email, instagram, answers, qualified, source_page, lang)
  values (clean_name, clean_email, clean_ig, p_answers, is_fit, clean_page, clean_lang)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.submit_qualification_lead(text, text, text, jsonb, text, text) from public;
grant execute on function public.submit_qualification_lead(text, text, text, jsonb, text, text) to anon, authenticated;
