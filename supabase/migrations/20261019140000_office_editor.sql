-- Office editor (phase 2). Not applied.
-- Backend reviews this file. Security gates RLS, grants, and the
-- hq_activity trigger before anyone applies it by hand. The app stays in
-- phase 1 read-only mode until these tables exist.
--
-- Additive only. Does not change hq_tasks_station_check, existing policies,
-- or the private schema. No seed rows: an office with no row keeps the
-- code default.
--
-- A revision row can be deleted only when a foreign-key cascade is already
-- inside another trigger (pg_trigger_depth() > 1) and its office_configs
-- parent is gone. No session setting opens that path.
--
-- Payload caps, enforced by office_validate_payload: 262144 bytes of text,
-- at most 100 stations (the overseer is separate), at most 400 edges.
-- metric is the station data_source. It must match ^[a-z0-9_]{1,40}$, and
-- none is stored on the station row as null. The revision snapshot keeps
-- only known keys.
-- actor_uid stores auth.uid() with no foreign key, beside the nullable
-- profile columns created_by and updated_by.

create table if not exists public.office_configs (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  business_id uuid null references public.tailortalk_agents(id) on delete cascade,
  version integer not null default 1,
  current_revision_id uuid null,
  updated_by uuid null references public.profiles(id),
  actor_uid uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_configs_scope_check check (scope in ('hq', 'business')),
  constraint office_configs_scope_business_check check (
    (scope = 'hq' and business_id is null)
    or (scope = 'business' and business_id is not null)
  )
);

create unique index if not exists office_configs_business_key
  on public.office_configs (business_id)
  where scope = 'business';

create unique index if not exists office_configs_hq_key
  on public.office_configs (scope)
  where scope = 'hq';

create table if not exists public.office_stations (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.office_configs(id) on delete cascade,
  key text not null,
  label text not null,
  role text null,
  hq_agent_id uuid null references public.hq_agents(id) on delete set null,
  description text not null default '',
  sort_order integer not null,
  position jsonb null,
  data_source text null,
  constraint office_stations_data_source_check check (data_source is null or data_source ~ '^[a-z0-9_]{1,40}$'),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_stations_key_check check (key ~ '^[a-z0-9_]{1,40}$'),
  constraint office_stations_label_check check (char_length(btrim(label)) between 1 and 60),
  constraint office_stations_role_check check (role is null or char_length(btrim(role)) <= 80),
  constraint office_stations_description_check check (char_length(description) <= 2000),
  constraint office_stations_config_key unique (config_id, key)
);

create table if not exists public.office_edges (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.office_configs(id) on delete cascade,
  from_station_id uuid not null references public.office_stations(id) on delete cascade,
  to_station_id uuid not null references public.office_stations(id) on delete cascade,
  kind text not null,
  label text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint office_edges_distinct_check check (from_station_id <> to_station_id),
  constraint office_edges_kind_check check (kind in ('sends', 'hands_off', 'reads')),
  constraint office_edges_label_check check (label is null or char_length(btrim(label)) <= 60),
  constraint office_edges_route_key unique (config_id, from_station_id, to_station_id, kind)
);

create table if not exists public.office_config_revisions (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.office_configs(id) on delete cascade,
  revision_no integer not null,
  snapshot jsonb not null,
  summary text not null default '',
  restored_from uuid null references public.office_config_revisions(id),
  created_by uuid null references public.profiles(id),
  actor_uid uuid null,
  created_at timestamptz not null default now(),
  constraint office_revisions_summary_check check (char_length(summary) <= 280),
  constraint office_revisions_number_key unique (config_id, revision_no)
);

alter table public.office_configs
  drop constraint if exists office_configs_current_revision_fkey;

alter table public.office_configs
  add constraint office_configs_current_revision_fkey
  foreign key (current_revision_id)
  references public.office_config_revisions(id)
  on delete set null;

alter table public.hq_tasks
  add column if not exists station_id uuid null references public.office_stations(id) on delete set null;

create index if not exists hq_tasks_station_idx on public.hq_tasks (station_id);
create index if not exists office_configs_business_idx on public.office_configs (business_id);
create index if not exists office_stations_agent_idx on public.office_stations (hq_agent_id);
create index if not exists office_edges_from_idx on public.office_edges (from_station_id);
create index if not exists office_edges_to_idx on public.office_edges (to_station_id);
create index if not exists office_revisions_restored_idx on public.office_config_revisions (restored_from);

create or replace function public.office_revisions_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE'
     and pg_trigger_depth() > 1
     and not exists (select 1 from public.office_configs where id = old.config_id) then
    return old;
  end if;
  raise exception 'office revisions are append-only';
end;
$fn$;

drop trigger if exists office_revisions_no_change on public.office_config_revisions;
create trigger office_revisions_no_change
  before update or delete on public.office_config_revisions
  for each row execute function public.office_revisions_append_only();

create or replace function public.office_revisions_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_owner uuid;
begin
  if new.created_by is not null and (
    new.created_by is distinct from auth.uid()
    or not exists (select 1 from public.profiles where id = auth.uid())
  ) then
    raise exception 'forged revision author';
  end if;
  if new.restored_from is not null then
    select config_id into v_owner
    from public.office_config_revisions
    where id = new.restored_from;
    if v_owner is null or v_owner is distinct from new.config_id then
      raise exception 'restored_from must belong to this office';
    end if;
  end if;
  new.actor_uid := auth.uid();
  return new;
end;
$fn$;

drop trigger if exists office_revisions_guard on public.office_config_revisions;
create trigger office_revisions_guard
  before insert on public.office_config_revisions
  for each row execute function public.office_revisions_guard();

create or replace function public.office_configs_record_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.actor_uid := auth.uid();
  return new;
end;
$fn$;

drop trigger if exists office_configs_record_actor on public.office_configs;
create trigger office_configs_record_actor
  before insert or update on public.office_configs
  for each row execute function public.office_configs_record_actor();

create or replace function public.office_edge_same_config()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_from uuid;
  v_to uuid;
begin
  select config_id into v_from from public.office_stations where id = new.from_station_id;
  select config_id into v_to from public.office_stations where id = new.to_station_id;
  if v_from is null or v_to is null or v_from <> v_to or v_from <> new.config_id then
    raise exception 'edges must point at stations in the same office';
  end if;
  return new;
end;
$fn$;

drop trigger if exists office_edges_same_config on public.office_edges;
create trigger office_edges_same_config
  before insert or update on public.office_edges
  for each row execute function public.office_edge_same_config();

create or replace function public.office_validate_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_overseer jsonb;
  v_brain_node jsonb;
  v_brain text;
  v_stations jsonb := '[]'::jsonb;
  v_edges jsonb := '[]'::jsonb;
  v_node jsonb;
  v_clean jsonb;
  v_keys text[] := '{}';
  v_key text;
  v_from text;
  v_to text;
  v_kind text;
  v_seen text[] := '{}';
  v_pair text;
  v_i integer;
  v_j integer;
  v_label text;
  v_desc text;
  v_color text;
  v_metric text;
  v_wrole text;
  v_agent text;
  v_agent_role text;
  v_tasks jsonb;
  v_task text;
  v_path text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'config must be an object';
  end if;
  if octet_length(p_payload::text) > 262144 then
    raise exception 'config is too large';
  end if;
  if p_payload->'stations' is null or jsonb_typeof(p_payload->'stations') <> 'array' or jsonb_array_length(p_payload->'stations') < 1 then
    raise exception 'stations must be a non-empty list';
  end if;
  if jsonb_array_length(p_payload->'stations') > 100 then
    raise exception 'too many stations';
  end if;
  if p_payload->'edges' is null or jsonb_typeof(p_payload->'edges') <> 'array' then
    raise exception 'edges must be a list';
  end if;
  if jsonb_array_length(p_payload->'edges') > 400 then
    raise exception 'too many edges';
  end if;
  v_overseer := p_payload->'overseer';
  v_brain_node := p_payload->'brandBrain';
  if v_brain_node is null or jsonb_typeof(v_brain_node) <> 'object' then
    raise exception 'brandBrain must be an object';
  end if;
  for v_i in 0 .. jsonb_array_length(p_payload->'stations') loop
    if v_i = 0 then
      v_node := v_overseer;
      v_path := 'overseer';
      if v_node is null or jsonb_typeof(v_node) <> 'object' or btrim(coalesce(v_node->>'id', '')) = '' then
        raise exception 'at least one overseer station';
      end if;
    else
      v_node := p_payload->'stations'->(v_i - 1);
      v_path := 'station';
      if v_node is null or jsonb_typeof(v_node) <> 'object' then
        raise exception 'station must be an object';
      end if;
    end if;
    v_key := btrim(coalesce(v_node->>'id', ''));
    if v_key !~ '^[a-z0-9_]{1,40}$' then
      raise exception '% id must be a lowercase key', v_path;
    end if;
    if v_key = any (v_keys) then
      raise exception 'duplicate station key %', v_key;
    end if;
    v_label := btrim(coalesce(v_node->>'role', ''));
    if char_length(v_label) not between 1 and 60 then
      raise exception '% label must be 1-60 characters', v_path;
    end if;
    v_desc := btrim(coalesce(v_node->>'description', ''));
    if v_desc = '' or char_length(v_desc) > 2000 then
      raise exception '% description is required', v_path;
    end if;
    v_agent_role := btrim(coalesce(v_node->>'agentRole', ''));
    if char_length(v_agent_role) > 80 then
      raise exception 'role is too long';
    end if;
    v_wrole := btrim(coalesce(v_node->>'workforceRole', ''));
    if char_length(v_wrole) > 80 then
      raise exception 'workforce role is too long';
    end if;
    v_color := nullif(btrim(coalesce(v_node->>'color', '')), '');
    if v_color is null then
      v_color := '#ff4d8d';
    elsif v_color !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'color must be #rrggbb';
    end if;
    v_metric := nullif(btrim(coalesce(v_node->>'metric', '')), '');
    if v_metric is null then
      v_metric := 'none';
    elsif v_metric !~ '^[a-z0-9_]{1,40}$' then
      raise exception 'data_source must be a lowercase key';
    end if;
    v_agent := nullif(btrim(coalesce(v_node->>'hqAgentId', '')), '');
    if v_agent is not null and v_agent !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'hqAgentId must be a uuid';
    end if;
    v_tasks := '[]'::jsonb;
    if v_node->'taskStations' is null or jsonb_typeof(v_node->'taskStations') = 'null' then
      v_tasks := '[]'::jsonb;
    elsif jsonb_typeof(v_node->'taskStations') <> 'array' then
      raise exception 'taskStations must be a list';
    elsif jsonb_array_length(v_node->'taskStations') > 40 then
      raise exception 'too many task stations';
    else
      for v_j in 0 .. jsonb_array_length(v_node->'taskStations') - 1 loop
        v_task := btrim(coalesce(v_node->'taskStations'->>v_j, ''));
        if v_task !~ '^[a-z0-9_]{1,40}$' then
          raise exception 'task station must be a lowercase key';
        end if;
        v_tasks := v_tasks || jsonb_build_array(v_task);
      end loop;
    end if;
    v_keys := array_append(v_keys, v_key);
    v_clean := jsonb_build_object(
      'id', v_key,
      'role', v_label,
      'description', v_desc,
      'color', v_color,
      'taskStations', v_tasks,
      'workforceRole', v_wrole,
      'metric', v_metric,
      'hqAgentId', case when v_agent is null then 'null'::jsonb else to_jsonb(v_agent) end,
      'agentRole', v_agent_role
    );
    if v_i = 0 then
      v_overseer := v_clean;
    else
      v_stations := v_stations || jsonb_build_array(v_clean);
    end if;
  end loop;
  v_node := v_brain_node;
  v_key := btrim(coalesce(v_node->>'id', ''));
  if v_key !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'brandBrain id must be a lowercase key';
  end if;
  if v_key = any (v_keys) then
    raise exception 'duplicate station key %', v_key;
  end if;
  v_brain := v_key;
  v_label := btrim(coalesce(v_node->>'role', ''));
  if char_length(v_label) not between 1 and 60 then
    raise exception 'brandBrain label must be 1-60 characters';
  end if;
  v_desc := btrim(coalesce(v_node->>'description', ''));
  if v_desc = '' or char_length(v_desc) > 2000 then
    raise exception 'brandBrain description is required';
  end if;
  v_agent_role := btrim(coalesce(v_node->>'agentRole', ''));
  if char_length(v_agent_role) > 80 then
    raise exception 'role is too long';
  end if;
  v_wrole := btrim(coalesce(v_node->>'workforceRole', ''));
  if char_length(v_wrole) > 80 then
    raise exception 'workforce role is too long';
  end if;
  v_color := nullif(btrim(coalesce(v_node->>'color', '')), '');
  if v_color is null then
    v_color := '#ff4d8d';
  elsif v_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'color must be #rrggbb';
  end if;
  v_metric := nullif(btrim(coalesce(v_node->>'metric', '')), '');
  if v_metric is null then
    v_metric := 'none';
  elsif v_metric !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'data_source must be a lowercase key';
  end if;
  v_agent := nullif(btrim(coalesce(v_node->>'hqAgentId', '')), '');
  if v_agent is not null and v_agent !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'hqAgentId must be a uuid';
  end if;
  v_tasks := '[]'::jsonb;
  if v_node->'taskStations' is null or jsonb_typeof(v_node->'taskStations') = 'null' then
    v_tasks := '[]'::jsonb;
  elsif jsonb_typeof(v_node->'taskStations') <> 'array' then
    raise exception 'taskStations must be a list';
  elsif jsonb_array_length(v_node->'taskStations') > 40 then
    raise exception 'too many task stations';
  else
    for v_j in 0 .. jsonb_array_length(v_node->'taskStations') - 1 loop
      v_task := btrim(coalesce(v_node->'taskStations'->>v_j, ''));
      if v_task !~ '^[a-z0-9_]{1,40}$' then
        raise exception 'task station must be a lowercase key';
      end if;
      v_tasks := v_tasks || jsonb_build_array(v_task);
    end loop;
  end if;
  v_keys := array_append(v_keys, v_brain);
  v_brain_node := jsonb_build_object(
    'id', v_brain,
    'role', v_label,
    'description', v_desc,
    'color', v_color,
    'taskStations', v_tasks,
    'workforceRole', v_wrole,
    'metric', v_metric,
    'hqAgentId', case when v_agent is null then 'null'::jsonb else to_jsonb(v_agent) end,
    'agentRole', v_agent_role
  );
  for v_i in 0 .. jsonb_array_length(p_payload->'edges') - 1 loop
    v_node := p_payload->'edges'->v_i;
    if v_node is null or jsonb_typeof(v_node) <> 'object' then
      raise exception 'edge must be an object';
    end if;
    v_from := btrim(coalesce(v_node->>'from', ''));
    v_to := btrim(coalesce(v_node->>'to', ''));
    if v_from = '' or v_to = '' or v_from = v_to then
      raise exception 'an edge cannot point at itself';
    end if;
    if v_from = v_brain or v_to = v_brain or not (v_from = any (v_keys)) or not (v_to = any (v_keys)) then
      raise exception 'edges must point at stations in the payload';
    end if;
    v_kind := case btrim(coalesce(v_node->>'kind', ''))
      when 'assign' then 'assign'
      when 'sends' then 'assign'
      when 'handoff' then 'handoff'
      when 'hands_off' then 'handoff'
      when 'read' then 'read'
      when 'reads' then 'read'
      else ''
    end;
    if v_kind = '' then
      raise exception 'edge kind is not allowed';
    end if;
    v_label := btrim(coalesce(v_node->>'label', ''));
    if char_length(v_label) not between 1 and 60 then
      raise exception 'edge label must be 1-60 characters';
    end if;
    v_pair := v_from || '>' || v_to;
    if v_pair = any (v_seen) then
      raise exception 'duplicate edge';
    end if;
    v_seen := array_append(v_seen, v_pair);
    v_edges := v_edges || jsonb_build_array(jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'kind', v_kind,
      'label', v_label
    ));
  end loop;
  return jsonb_build_object(
    'id', coalesce(nullif(btrim(coalesce(p_payload->>'id', '')), ''), 'default'),
    'overseer', v_overseer,
    'brandBrain', v_brain_node,
    'stations', v_stations,
    'edges', v_edges
  );
end;
$fn$;

create or replace function public.save_office_config(
  p_config_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_summary text,
  p_restored_from uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_version integer;
  v_user uuid;
  v_summary text;
  v_revision uuid;
  v_no integer;
  v_doc jsonb;
  v_station jsonb;
  v_edge jsonb;
  v_keys text[] := '{}';
  v_key text;
  v_kind text;
  v_from uuid;
  v_to uuid;
  v_sort integer := 0;
  v_agent uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select version into v_version
  from public.office_configs
  where id = p_config_id
  for update;
  if v_version is null then
    raise exception 'office not found';
  end if;
  if v_version <> p_expected_version then
    raise exception 'version conflict: someone else saved first';
  end if;
  if p_restored_from is not null and not exists (
    select 1 from public.office_config_revisions
    where id = p_restored_from and config_id = p_config_id
  ) then
    raise exception 'restored_from must belong to this office';
  end if;
  v_doc := public.office_validate_payload(p_payload);
  v_user := auth.uid();
  if not exists (select 1 from public.profiles where id = v_user) then
    v_user := null;
  end if;
  v_summary := left(btrim(coalesce(p_summary, '')), 280);

  v_keys := array_append(v_keys, btrim(v_doc#>>'{overseer,id}'));
  for v_station in select value from jsonb_array_elements(v_doc->'stations')
  loop
    v_keys := array_append(v_keys, btrim(v_station->>'id'));
  end loop;

  v_key := btrim(v_doc#>>'{overseer,id}');
  v_agent := nullif(btrim(coalesce(v_doc#>>'{overseer,hqAgentId}', '')), '')::uuid;
  insert into public.office_stations (
    config_id, key, label, role, hq_agent_id, description, sort_order, data_source, archived_at, updated_at
  )
  values (
    p_config_id,
    v_key,
    btrim(v_doc#>>'{overseer,role}'),
    nullif(btrim(coalesce(v_doc#>>'{overseer,agentRole}', '')), ''),
    v_agent,
    v_doc#>>'{overseer,description}',
    0,
    nullif(v_doc#>>'{overseer,metric}', 'none'),
    null,
    now()
  )
  on conflict (config_id, key) do update
    set label = excluded.label,
        role = excluded.role,
        hq_agent_id = excluded.hq_agent_id,
        description = excluded.description,
        sort_order = excluded.sort_order,
        data_source = excluded.data_source,
        archived_at = null,
        updated_at = now();

  v_sort := 0;
  for v_station in select value from jsonb_array_elements(v_doc->'stations')
  loop
    v_sort := v_sort + 1;
    v_agent := nullif(btrim(coalesce(v_station->>'hqAgentId', '')), '')::uuid;
    insert into public.office_stations (
      config_id, key, label, role, hq_agent_id, description, sort_order, data_source, archived_at, updated_at
    )
    values (
      p_config_id,
      btrim(v_station->>'id'),
      btrim(v_station->>'role'),
      nullif(btrim(coalesce(v_station->>'agentRole', '')), ''),
      v_agent,
      v_station->>'description',
      v_sort,
      nullif(v_station->>'metric', 'none'),
      null,
      now()
    )
    on conflict (config_id, key) do update
      set label = excluded.label,
          role = excluded.role,
          hq_agent_id = excluded.hq_agent_id,
          description = excluded.description,
          sort_order = excluded.sort_order,
          data_source = excluded.data_source,
          archived_at = null,
          updated_at = now();
  end loop;

  update public.office_stations
  set archived_at = now(),
      updated_at = now()
  where config_id = p_config_id
    and archived_at is null
    and not (key = any (v_keys));

  delete from public.office_edges where config_id = p_config_id;

  v_sort := 0;
  for v_edge in select value from jsonb_array_elements(v_doc->'edges')
  loop
    v_kind := case btrim(v_edge->>'kind')
      when 'assign' then 'sends'
      when 'sends' then 'sends'
      when 'handoff' then 'hands_off'
      when 'hands_off' then 'hands_off'
      else 'reads'
    end;
    select id into v_from
    from public.office_stations
    where config_id = p_config_id and key = btrim(v_edge->>'from') and archived_at is null;
    select id into v_to
    from public.office_stations
    where config_id = p_config_id and key = btrim(v_edge->>'to') and archived_at is null;
    insert into public.office_edges (config_id, from_station_id, to_station_id, kind, label, sort_order)
    values (p_config_id, v_from, v_to, v_kind, btrim(v_edge->>'label'), v_sort);
    v_sort := v_sort + 1;
  end loop;

  select coalesce(max(revision_no), 0) + 1 into v_no
  from public.office_config_revisions
  where config_id = p_config_id;

  insert into public.office_config_revisions (
    config_id, revision_no, snapshot, summary, restored_from, created_by, actor_uid
  )
  values (p_config_id, v_no, v_doc, v_summary, p_restored_from, v_user, auth.uid())
  returning id into v_revision;

  update public.office_configs
  set version = version + 1,
      current_revision_id = v_revision,
      updated_by = v_user,
      actor_uid = auth.uid(),
      updated_at = now()
  where id = p_config_id
  returning version into v_version;

  return v_version;
end;
$fn$;

create or replace function public.create_office_config(
  p_scope text,
  p_business_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_scope text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;
  v_scope := btrim(coalesce(p_scope, ''));
  if v_scope not in ('hq', 'business') then
    raise exception 'scope must be hq or business';
  end if;
  if v_scope = 'hq' and p_business_id is not null then
    raise exception 'the HQ office has no business';
  end if;
  if v_scope = 'business' and p_business_id is null then
    raise exception 'business_id is required';
  end if;
  perform public.office_validate_payload(p_payload);
  begin
    insert into public.office_configs (scope, business_id, version)
    values (v_scope, p_business_id, 0)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'office already exists';
  end;
  perform public.save_office_config(v_id, 0, p_payload, 'Created the office', null);
  return v_id;
end;
$fn$;

create or replace function public.restore_office_revision(
  p_revision_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_config uuid;
  v_snapshot jsonb;
  v_no integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select config_id, snapshot, revision_no
  into v_config, v_snapshot, v_no
  from public.office_config_revisions
  where id = p_revision_id;
  if v_config is null then
    raise exception 'revision not found';
  end if;
  return public.save_office_config(
    v_config,
    p_expected_version,
    v_snapshot,
    'Restored revision ' || v_no::text,
    p_revision_id
  );
end;
$fn$;

-- Security: this is the only definer function in this file. hq_activity has
-- no insert policy, so a station move would not be logged without it.
-- Reject this trigger if activity must stay application-written.
create or replace function public.hq_log_station_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  actor text := public.hq_actor();
  v_from text;
  v_to text;
begin
  if tg_op <> 'UPDATE' or new.station_id is not distinct from old.station_id then
    return new;
  end if;
  if current_setting('hq.skip_log', true) = 'on' then
    return new;
  end if;
  v_from := coalesce(nullif(old.station, ''), '');
  v_to := coalesce(nullif(new.station, ''), '');
  if v_from = '' and old.station_id is not null then
    select key into v_from from public.office_stations where id = old.station_id;
  end if;
  if v_to = '' and new.station_id is not null then
    select key into v_to from public.office_stations where id = new.station_id;
  end if;
  insert into public.hq_activity (agent_id, task_id, actor, action, detail)
  values (
    new.agent_id,
    new.id,
    actor,
    'task.moved',
    'moved from ' || coalesce(v_from, '') || ' to ' || coalesce(v_to, '')
  );
  return new;
end;
$fn$;

drop trigger if exists hq_tasks_station_move on public.hq_tasks;
create trigger hq_tasks_station_move
  after update on public.hq_tasks
  for each row execute function public.hq_log_station_move();

alter table public.office_configs enable row level security;
alter table public.office_stations enable row level security;
alter table public.office_edges enable row level security;
alter table public.office_config_revisions enable row level security;

revoke all on public.office_configs from public, anon, authenticated;
revoke all on public.office_stations from public, anon, authenticated;
revoke all on public.office_edges from public, anon, authenticated;
revoke all on public.office_config_revisions from public, anon, authenticated;

grant select, insert, update on public.office_configs to authenticated;
grant select, insert, update on public.office_stations to authenticated;
grant select, insert, update, delete on public.office_edges to authenticated;
grant select, insert on public.office_config_revisions to authenticated;

drop policy if exists office_configs_select on public.office_configs;
drop policy if exists office_configs_insert on public.office_configs;
drop policy if exists office_configs_update on public.office_configs;
create policy office_configs_select on public.office_configs
  for select to authenticated using (public.is_admin());
create policy office_configs_insert on public.office_configs
  for insert to authenticated with check (public.is_admin());
create policy office_configs_update on public.office_configs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists office_stations_select on public.office_stations;
drop policy if exists office_stations_insert on public.office_stations;
drop policy if exists office_stations_update on public.office_stations;
create policy office_stations_select on public.office_stations
  for select to authenticated using (public.is_admin());
create policy office_stations_insert on public.office_stations
  for insert to authenticated with check (public.is_admin());
create policy office_stations_update on public.office_stations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists office_edges_select on public.office_edges;
drop policy if exists office_edges_insert on public.office_edges;
drop policy if exists office_edges_update on public.office_edges;
drop policy if exists office_edges_delete on public.office_edges;
create policy office_edges_select on public.office_edges
  for select to authenticated using (public.is_admin());
create policy office_edges_insert on public.office_edges
  for insert to authenticated with check (public.is_admin());
create policy office_edges_update on public.office_edges
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy office_edges_delete on public.office_edges
  for delete to authenticated using (public.is_admin());

drop policy if exists office_revisions_select on public.office_config_revisions;
drop policy if exists office_revisions_insert on public.office_config_revisions;
create policy office_revisions_select on public.office_config_revisions
  for select to authenticated using (public.is_admin());
create policy office_revisions_insert on public.office_config_revisions
  for insert to authenticated with check (public.is_admin());

revoke all on function public.office_validate_payload(jsonb) from public, anon, service_role;
revoke all on function public.save_office_config(uuid, integer, jsonb, text, uuid) from public, anon, service_role;
revoke all on function public.create_office_config(text, uuid, jsonb) from public, anon, service_role;
revoke all on function public.restore_office_revision(uuid, integer) from public, anon, service_role;
revoke all on function public.office_revisions_append_only() from public, anon, authenticated, service_role;
revoke all on function public.office_revisions_guard() from public, anon, authenticated, service_role;
revoke all on function public.office_configs_record_actor() from public, anon, authenticated, service_role;
revoke all on function public.office_edge_same_config() from public, anon, authenticated, service_role;
revoke all on function public.hq_log_station_move() from public, anon, authenticated, service_role;

grant execute on function public.office_validate_payload(jsonb) to authenticated;
grant execute on function public.save_office_config(uuid, integer, jsonb, text, uuid) to authenticated;
grant execute on function public.create_office_config(text, uuid, jsonb) to authenticated;
grant execute on function public.restore_office_revision(uuid, integer) to authenticated;

do $pub$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['office_configs', 'office_stations', 'office_edges']
    loop
      execute format('alter table public.%I replica identity full', t);
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$pub$;
