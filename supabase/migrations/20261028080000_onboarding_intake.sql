-- NOT APPLIED.
-- Onboarding intake for one business.
-- Do not run this against production from the repo. Apply it yourself when ready.
-- It does not drop tables and it does not turn a setter on.
-- The share link stores a hash of the token, not the token.
-- Uploaded files belong in the private onboarding-materials bucket.

create table if not exists public.acq_onboarding (
  business_id uuid primary key,
  offer text not null default '',
  price text not null default '',
  ideal text not null default '',
  booking_link text not null default '',
  criteria text not null default '',
  disqualifiers text not null default '',
  status text not null default '',
  sources jsonb not null default '{}'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint acq_onboarding_status check (status in ('', 'materials', 'drafted', 'tested', 'approved', 'live'))
);

create table if not exists public.acq_onboarding_materials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  kind text not null default 'text',
  name text not null default '',
  body text not null default '',
  storage_path text not null default '',
  created_at timestamptz not null default now(),
  constraint acq_onboarding_materials_kind check (kind in ('text', 'file'))
);

create index if not exists acq_onboarding_materials_business_idx
  on public.acq_onboarding_materials (business_id, created_at desc);

create table if not exists public.acq_onboarding_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists acq_onboarding_links_business_idx
  on public.acq_onboarding_links (business_id, created_at desc);

alter table public.acq_onboarding enable row level security;
alter table public.acq_onboarding_materials enable row level security;
alter table public.acq_onboarding_links enable row level security;

drop policy if exists acq_onboarding_read on public.acq_onboarding;
create policy acq_onboarding_read on public.acq_onboarding
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_onboarding_write on public.acq_onboarding;
create policy acq_onboarding_write on public.acq_onboarding
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_onboarding_materials_read on public.acq_onboarding_materials;
create policy acq_onboarding_materials_read on public.acq_onboarding_materials
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_onboarding_materials_write on public.acq_onboarding_materials;
create policy acq_onboarding_materials_write on public.acq_onboarding_materials
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

drop policy if exists acq_onboarding_links_read on public.acq_onboarding_links;
create policy acq_onboarding_links_read on public.acq_onboarding_links
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_onboarding_links_write on public.acq_onboarding_links;
create policy acq_onboarding_links_write on public.acq_onboarding_links
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

grant select, insert, update, delete on public.acq_onboarding to authenticated;
grant select, insert, update, delete on public.acq_onboarding_materials to authenticated;
grant select, insert, update, delete on public.acq_onboarding_links to authenticated;
grant all on public.acq_onboarding to service_role;
grant all on public.acq_onboarding_materials to service_role;
grant all on public.acq_onboarding_links to service_role;
revoke all on public.acq_onboarding from anon;
revoke all on public.acq_onboarding_materials from anon;
revoke all on public.acq_onboarding_links from anon;

insert into storage.buckets (id, name, public)
values ('onboarding-materials', 'onboarding-materials', false)
on conflict (id) do update set public = false;

-- No browser policy is added for this bucket. The onboarding-link function
-- writes objects with the service role. The browser cannot read them.
