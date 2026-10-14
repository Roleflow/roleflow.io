-- TailorTalk agent registry. Apply after 20261014160000_tailortalk_crm.sql.
-- Idempotent. Does not call TailorTalk and does not insert tokens or prompts.
--
-- An external admin job upserts rows with public.tailortalk_upsert_agent.
-- That function is the write path for execute_sql (postgres, no JWT) and for
-- the service role. anon and authenticated cannot execute it.
-- The access token is written only to private.tailortalk_agent_secrets.
-- Re-running with a null token, null sections, or a null version keeps the
-- stored value. A new prompt_version_id inserts one history row.

insert into private.tailortalk_settings (key, value)
values ('org_id', 'ntrtnxfad')
on conflict (key) do nothing;

alter table public.tailortalk_agents
  add column if not exists tailortalk_agent_id text,
  add column if not exists agent_name text,
  add column if not exists prompt_sections jsonb not null default '[]'::jsonb,
  add column if not exists prompt_updated_at timestamptz,
  add column if not exists prompt_version_id text,
  add column if not exists channels jsonb not null default '[]'::jsonb,
  add column if not exists tailortalk_created_at timestamptz,
  add column if not exists archived boolean not null default false;

update public.tailortalk_agents
set agent_name = label
where agent_name is null;

create unique index if not exists tailortalk_agents_tt_id
  on public.tailortalk_agents (tailortalk_agent_id);

alter table private.tailortalk_agent_secrets
  add column if not exists access_token text;
alter table private.tailortalk_agent_secrets
  alter column token_encrypted drop not null;

create table if not exists public.tailortalk_prompt_versions (
  agent_id uuid not null references public.tailortalk_agents (id) on delete cascade,
  version_id text not null,
  deployed_at timestamptz,
  sections jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (agent_id, version_id)
);

alter table public.tailortalk_prompt_versions enable row level security;

drop policy if exists tailortalk_prompt_versions_select on public.tailortalk_prompt_versions;
create policy tailortalk_prompt_versions_select on public.tailortalk_prompt_versions
  for select to authenticated
  using (public.is_admin());

revoke all on table public.tailortalk_prompt_versions from public, anon, authenticated;
grant select on table public.tailortalk_prompt_versions to authenticated;
grant select, insert, update, delete on table public.tailortalk_prompt_versions to service_role;

-- Same argument list as the first migration so create or replace updates it.
-- The text argument is the plaintext agent token. It is stored in the private
-- schema and is not returned to the browser.
create or replace function public.tailortalk_put_secret(p_agent_id uuid, p_token_encrypted text)
returns void
language plpgsql
security definer
set search_path = public, private
as $fn$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'forbidden';
  end if;
  if p_agent_id is null or p_token_encrypted is null or length(btrim(p_token_encrypted)) = 0 then
    raise exception 'missing secret';
  end if;
  insert into private.tailortalk_agent_secrets (agent_id, access_token)
  values (p_agent_id, p_token_encrypted)
  on conflict (agent_id) do update
    set access_token = excluded.access_token,
        updated_at = now();
end;
$fn$;

create or replace function public.tailortalk_read_secret(p_agent_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  stored text;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'forbidden';
  end if;
  select coalesce(access_token, token_encrypted) into stored
  from private.tailortalk_agent_secrets
  where agent_id = p_agent_id;
  return stored;
end;
$fn$;

create or replace function public.tailortalk_upsert_agent(
  p_tailortalk_agent_id text,
  p_agent_name text,
  p_sections jsonb,
  p_prompt_version_id text,
  p_prompt_updated_at timestamptz,
  p_channels jsonb,
  p_created_at timestamptz,
  p_access_token text,
  p_archived boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  agent_uuid uuid;
  previous_version text;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'forbidden';
  end if;
  if p_tailortalk_agent_id is null or length(btrim(p_tailortalk_agent_id)) = 0 then
    raise exception 'tailortalk_agent_id is required';
  end if;
  if p_agent_name is null or length(btrim(p_agent_name)) = 0 then
    raise exception 'agent_name is required';
  end if;
  if p_sections is not null and jsonb_typeof(p_sections) <> 'array' then
    raise exception 'sections must be a json array of {node, instruction}';
  end if;
  if p_channels is not null and jsonb_typeof(p_channels) <> 'array' then
    raise exception 'channels must be a json array';
  end if;

  select id, prompt_version_id into agent_uuid, previous_version
  from public.tailortalk_agents
  where tailortalk_agent_id = btrim(p_tailortalk_agent_id);

  if agent_uuid is null then
    insert into public.tailortalk_agents (
      tailortalk_agent_id, agent_name, label, prompt_sections, prompt_updated_at,
      prompt_version_id, channels, tailortalk_created_at, archived
    ) values (
      btrim(p_tailortalk_agent_id),
      btrim(p_agent_name),
      btrim(p_agent_name),
      coalesce(p_sections, '[]'::jsonb),
      p_prompt_updated_at,
      nullif(btrim(coalesce(p_prompt_version_id, '')), ''),
      coalesce(p_channels, '[]'::jsonb),
      p_created_at,
      coalesce(p_archived, false)
    )
    returning id into agent_uuid;
  else
    update public.tailortalk_agents
    set agent_name = btrim(p_agent_name),
        label = btrim(p_agent_name),
        prompt_sections = coalesce(p_sections, prompt_sections),
        prompt_updated_at = case
          when p_prompt_version_id is null then prompt_updated_at
          else p_prompt_updated_at
        end,
        prompt_version_id = case
          when p_prompt_version_id is null then prompt_version_id
          else nullif(btrim(p_prompt_version_id), '')
        end,
        channels = coalesce(p_channels, channels),
        tailortalk_created_at = coalesce(p_created_at, tailortalk_created_at),
        archived = coalesce(p_archived, false),
        updated_at = now()
    where id = agent_uuid;
  end if;

  if p_access_token is not null and length(btrim(p_access_token)) > 0 then
    perform public.tailortalk_put_secret(agent_uuid, btrim(p_access_token));
  end if;

  if p_prompt_version_id is not null
     and length(btrim(p_prompt_version_id)) > 0
     and btrim(p_prompt_version_id) is distinct from previous_version then
    insert into public.tailortalk_prompt_versions (agent_id, version_id, deployed_at, sections)
    values (
      agent_uuid,
      btrim(p_prompt_version_id),
      p_prompt_updated_at,
      coalesce(p_sections, '[]'::jsonb)
    )
    on conflict (agent_id, version_id) do update
      set deployed_at = excluded.deployed_at,
          sections = excluded.sections;
  end if;

  return agent_uuid;
end;
$fn$;

revoke all on function public.tailortalk_put_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.tailortalk_read_secret(uuid) from public, anon, authenticated;
revoke all on function public.tailortalk_upsert_agent(text, text, jsonb, text, timestamptz, jsonb, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.tailortalk_put_secret(uuid, text) to service_role;
grant execute on function public.tailortalk_read_secret(uuid) to service_role;
grant execute on function public.tailortalk_upsert_agent(text, text, jsonb, text, timestamptz, jsonb, timestamptz, text, boolean) to service_role;
