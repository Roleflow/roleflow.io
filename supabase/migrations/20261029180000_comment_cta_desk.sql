-- NOT APPLIED.
-- Adds comment CTA settings and a held-plan table. It does not remove a table.
-- Do not run this against production from the repo.
-- It does not turn sending on.

alter table public.acq_comment_ctas
  add column if not exists scope text not null default 'any',
  add column if not exists publication_ref text not null default '',
  add column if not exists reply_kind text not null default 'text',
  add column if not exists voice_path text not null default '',
  add column if not exists voice_mime text not null default '';

alter table public.acq_comment_ctas drop constraint if exists acq_comment_ctas_scope_check;
alter table public.acq_comment_ctas
  add constraint acq_comment_ctas_scope_check check (scope in ('any', 'post'));

alter table public.acq_comment_ctas drop constraint if exists acq_comment_ctas_reply_kind_check;
alter table public.acq_comment_ctas
  add constraint acq_comment_ctas_reply_kind_check check (reply_kind in ('text', 'voice'));

create table if not exists public.acq_comment_settings (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  auto_reply boolean not null default false,
  dm_without_keyword boolean not null default false,
  public_replies text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.acq_comment_prepares (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.acq_workspaces (id) on delete cascade,
  cta_id uuid references public.acq_comment_ctas (id) on delete set null,
  comment_id text not null default '',
  commenter_handle text not null default '',
  comment_text text not null default '',
  publication_ref text not null default '',
  public_reply text not null default '',
  dm_plan jsonb not null default '{}'::jsonb,
  status text not null default 'held',
  hold_reason text not null default '',
  send_after timestamptz,
  created_at timestamptz not null default now(),
  constraint acq_comment_prepares_status_check check (status in ('held', 'skipped'))
);

create index if not exists acq_comment_prepares_business_idx
  on public.acq_comment_prepares (business_id, created_at desc);

alter table public.acq_comment_settings enable row level security;
alter table public.acq_comment_prepares enable row level security;
revoke all on public.acq_comment_settings, public.acq_comment_prepares from public, anon;
grant select, insert, update, delete on public.acq_comment_settings, public.acq_comment_prepares to authenticated;
grant select, insert, update, delete on public.acq_comment_settings, public.acq_comment_prepares to service_role;

drop policy if exists acq_comment_settings_read on public.acq_comment_settings;
create policy acq_comment_settings_read on public.acq_comment_settings
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_comment_settings_write on public.acq_comment_settings;
create policy acq_comment_settings_write on public.acq_comment_settings
  for all to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id));

drop policy if exists acq_comment_prepares_read on public.acq_comment_prepares;
create policy acq_comment_prepares_read on public.acq_comment_prepares
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_comment_prepares_write on public.acq_comment_prepares;
create policy acq_comment_prepares_write on public.acq_comment_prepares
  for all to authenticated using (public.acq_can_edit(business_id)) with check (public.acq_can_edit(business_id));
