-- Applications tracker for DM setter outreach.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- It is idempotent. Running it again updates the policies and does not
-- overwrite a row Diego has already edited: the seed inserts an external id
-- only when that id is not stored yet.
--
-- Who is an admin: a row in public.admins whose user_id is the signed-in
-- auth user. The accounts migration inserts diego@roleflow.io. If that
-- account was created after the accounts migration, run:
--   insert into public.admins (user_id)
--   select id from auth.users where lower(email) = 'diego@roleflow.io'
--   on conflict (user_id) do nothing;
--
-- anon has no privileges. authenticated can select, insert, update, and
-- delete only when public.is_admin() is true. Logged-out visitors and
-- clients therefore cannot read this table through the API.
--
-- Atelium Academy (Melissa Schemionek) is omitted on purpose. Diego tracks
-- pure DM setter roles, and that lead was not in the source list.
-- Jimmy Evans was not in the source list. His stock-trading row is included
-- below as not sent.

create table if not exists public.setter_applications (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  offer text not null default '',
  niche text not null default '',
  owner text not null default '',
  instagram text not null default '',
  email text not null default '',
  channel text not null default 'IG DM',
  ticket text not null default '',
  setter_ote text not null default '',
  source_url text not null default '',
  date_sent date,
  video_url text not null default '',
  stage text not null default 'Not sent',
  follow_up_date date,
  notes text not null default '',
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists setter_applications_external_id_key
  on public.setter_applications (external_id);

create index if not exists setter_applications_stage_idx
  on public.setter_applications (stage, follow_up_date);

alter table public.setter_applications
  drop constraint if exists setter_applications_channel_check;
alter table public.setter_applications
  add constraint setter_applications_channel_check
  check (channel in ('IG DM', 'Email', 'Other'));

alter table public.setter_applications
  drop constraint if exists setter_applications_stage_check;
alter table public.setter_applications
  add constraint setter_applications_stage_check
  check (stage in ('Not sent', 'Sent', 'Replied', 'Call booked', 'Hired', 'No response', 'Rejected'));

create or replace function public.touch_setter_application()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists setter_applications_touch on public.setter_applications;
create trigger setter_applications_touch
  before update on public.setter_applications
  for each row execute function public.touch_setter_application();

alter table public.setter_applications enable row level security;

revoke all on table public.setter_applications from public, anon, authenticated;
grant select, insert, update, delete on table public.setter_applications to authenticated;

revoke all on function public.touch_setter_application() from public, anon, authenticated;

drop policy if exists setter_applications_select on public.setter_applications;
create policy setter_applications_select on public.setter_applications
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists setter_applications_insert on public.setter_applications;
create policy setter_applications_insert on public.setter_applications
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists setter_applications_update on public.setter_applications;
create policy setter_applications_update on public.setter_applications
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists setter_applications_delete on public.setter_applications;
create policy setter_applications_delete on public.setter_applications
  for delete to authenticated
  using ((select public.is_admin()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.setter_applications to service_role';
  end if;
end $$;

insert into public.setter_applications (
  external_id, offer, niche, owner, instagram, email, channel, ticket, setter_ote,
  source_url, date_sent, video_url, stage, follow_up_date, notes, sort_order
)
select
  v.external_id,
  v.offer,
  v.niche,
  v.owner,
  v.instagram,
  v.email,
  v.channel,
  v.ticket,
  v.setter_ote,
  v.source_url,
  v.date_sent::date,
  v.video_url,
  v.stage,
  v.follow_up_date::date,
  v.notes,
  v.sort_order::integer
from (values
  ('mens-health-fitness-oddy-dadswell', 'Men''s Health & Fitness (busy professionals/execs, £3k packages)', 'Fitness', 'Dom Oddy / James Dadswell', '@dominicoddy', 'jamesdadswell@icloud.com', 'IG DM', '$2k-$5k (GBP 3k packages)', '$2k-$5k/mo + $500 base', '', null, '', 'Not sent', null, 'Also IG: @jamesdadswell (sales/setter manager, VERIFIED via Skool profile)
Source: DM Setter job board (Diego''s screenshots)
Revenue: $30k-$50k
Requirements: 3-6mo exp; US/CA, AUS/ASIA, EU/UK hours; full/part-time; ideally set on fitness offers; hard work, follow-ups, high-level ICP
Priority: Medium', 1),
  ('ugc-mentorship-melisa-estrada', 'UGC Content / High-Ticket Mentorship', 'UGC / creator mentorship', 'Melisa Estrada', '@melisaestraday', '', 'IG DM', '$3k-$5k', '$1k-$3k/mo (Setter + DM Setter)', '', '2026-10-14', 'https://share.descript.com/view/EQKsq9fa7Jh', 'Sent', null, 'Sent via IG DM to @melisaestraday on 2026-10-14.
Source: DM Setter job board (Diego''s screenshots)
Requirements: 3-6mo exp; US/CA hours; full-time; female only; coachable
Priority: Low', 2),
  ('ig-theme-pages-johnny-dugle', 'IG Theme Pages', 'IG theme pages / biz-op', 'Johnny Dugle (recruiter Ian Granai)', '@johnnybuildspages', 'ian@dmsetting.com', 'IG DM', '$5k', '$1k-$5k/mo', '', null, '', 'Not sent', null, 'Source: DM Setter job board (Diego''s screenshots)
Revenue: $20k
Requirements: US/CA hours; full-time; long-term growth mindset
Priority: Low', 3),
  ('wolf-fitness-tony-mcaleavey', 'Fitness Coaching for busy dads/entrepreneurs', 'Fitness', 'Tony McAleavey (recruiter Ian Granai)', '@tonymcaleavey', 'ian@dmsetting.com', 'IG DM', '$4k', '$3k-$5k/mo', '', null, '', 'Not sent', null, 'Also IG: @wolffitness__ (brand, UNVERIFIED)
Source: DM Setter job board (Diego''s screenshots)
Revenue: $100k
Requirements: 3-6mo exp; US/CA hours; full-time; bold, must challenge leads
Priority: High', 4),
  ('mobility-coaching-jake-blundell', 'Mobility & Flexibility 1-1 Coaching', 'Fitness / mobility', 'Jake Blundell / Mo Rashid (manager)', '@elastaboy', 'morashidd247@gmail.com', 'IG DM', '$3k-$10k', '$2k-$4k/mo', '', null, '', 'Not sent', null, 'Also IG: @morashidddd (setter manager, from screenshot)
Source: DM Setter job board (Diego''s screenshots)
Revenue: $300k
Requirements: 6-12mo exp preferred not essential; full-time; EST hours; sales-trained
Priority: High', 5),
  ('personal-branding-matt-gray', 'Personal Branding & Biz Coaching for founders', 'Founder / personal branding', 'Matt Gray (recruiter Ian Granai)', '@matthgray', 'ian@dmsetting.com', 'IG DM', '$8k-$130k', '$8k-$12k/mo', '', null, '', 'Not sent', null, 'Source: DM Setter job board (Diego''s screenshots)
Revenue: $350k
Requirements: 6-12mo exp; US/CA hours; full-time; B2B; proven A-player only
Priority: High', 6),
  ('womens-weight-loss-thomas-cobley', 'Health & Fitness (helping women lose weight)', 'Fitness / weight loss', 'Thomas Cobley / Abram', '@thomascobley', 't@thomascobley.com', 'IG DM', '$6k-$12k', '$2k-$6k/mo', '', null, '', 'Not sent', null, 'Also IG: @abram.ande (partner, TRUNCATED)
Source: DM Setter job board (Diego''s screenshots)
Revenue: $300k-$600k
Requirements: 6-12mo high-ticket setter exp; US/CA hours; full-time; fitness DM setting
Priority: High', 7),
  ('dating-coaching-placer-700k', 'Dating coaching (influencer 700K+ followers; $4K/$10K/$25K offers)', 'Dating coaching', 'NOT FOUND (posted by recruiter Luke, Placer - @LukeAtPlacer on X)', '', '', 'IG DM', '$4k / $10k / $25k', '$5k-$7k/mo OTE, 5% commission', 'https://x.com/LukeAtPlacer/status/2109853914011140154', null, '', 'Not sent', null, 'Source: X @LukeAtPlacer
DM ''SETTER'' to @LukeAtPlacer on X
Revenue: $150k+ (stated)
Requirements: Inbound DM setting; US-based; remote
Priority: High', 8),
  ('the-creed-fitness-tim-waller', 'Premium online fitness coaching for high-performing professionals (The Creed)', 'Fitness', 'Tim Waller (poster)', '', '', 'IG DM', '$3.5k-$5k', 'High commissions + bonuses (amount NOT FOUND)', 'https://www3.skool.com/sales-community-for-closers-1459/hiring-high-ticket-dm-setter-fitness-coaching', null, '', 'Not sent', null, 'Source: Skool Sales Community for Closers
email redacted in indexed copy
Requirements: Full-time DM setter; 50+ warm inbound leads/day; IG DMs + WhatsApp; high-ticket setting experience
Unconfirmed: post date and IG handle
Priority: High', 9),
  ('guitar-education-kyle-farman-client', 'Music and guitar education programs (private client of recruiter Kyle Farman)', 'Music education', 'NOT FOUND (private client; recruiter Kyle Farman, @Kyle_Farman on X)', '', '', 'Other', '$3,200-$12k', '$1,500 base + 5% commission; OTE ~$4k-$6k/mo', 'https://x.com/Kyle_Farman/status/2108082050024804673', null, '', 'Not sent', null, 'Source: X @Kyle_Farman
message ''inbound setter'' to @Kyle_Farman on X
Requirements: Inbound setting; remote
Unconfirmed: IG DM channel not stated; owner name
Priority: Medium', 10),
  ('fitness-rave-ready-jasermohamed07', 'Fitness coaching offer (owner unnamed; posted by jasermohamed07)', 'Fitness', 'Likely Rave Ready / Will Mojo (named in a matching Placer post by @ElijahW73377226 on X, 2026-10-07 06:34 CEST: https://x.com/ElijahW73377226/status/2107691065323188497) - UNCONFIRMED same role; poster @jasermohamed07', '', '', 'IG DM', '', '5% commission; $2k-$5k/mo OTE uncapped', 'https://x.com/jasermohamed07/status/2107876828534997184', null, '', 'Not sent', null, 'Source: X @jasermohamed07
DM @jasermohamed07 on X
Requirements: Instagram DMs; 40+ hrs/week; prior B2B DM setting or high-ticket closing
Unconfirmed: ticket price, inbound leads, and owner match
Priority: Low', 11),
  ('uk-property-education-ig-dm-onlinejobs', 'UK premium property education (GBP 997 course + GBP 15k 1-on-1 mentorship; 1M+ organic IG followers)', 'Property / real estate education', 'NOT FOUND (employer name hidden behind OnlineJobs.ph login; same employer ID 771379 on both posts)', '', '', 'IG DM', 'GBP 997 course (~$1.3k) + GBP 15,000 1-on-1 mentorship', '$500/mo base + 7.5% commission (GBP 74.78 per course / GBP 1,125 per mentorship); earlier post: $400 base + 7.5%', 'https://www.onlinejobs.ph/jobseekers/job/high-ticket-insta-dm-closer-1749548', null, '', 'Not sent', null, 'Source: OnlineJobs.ph
apply via OnlineJobs.ph, needs jobseeker login
Requirements: Titled ''Instagram DM Closer'': answer inbound DMs fast, qualify on goals/budget/real-estate experience, close the GBP 997 course in chat or book a strategy call, pre-qualify high-net-worth leads for the GBP 15k mentorship; proven closing of GBP 1k+ offers by text/voice notes; flawless written English; UK GMT hours; 38 hrs/wk; daily tracker. Second post: https://www.onlinejobs.ph/jobseekers/job/instagram-dm-closer-1748901
Priority: Medium', 12),
  ('stock-trading-jimmy-evans', 'Stock trading', 'Stock trading', 'Jimmy Evans', '@stocknavigators', 'ian@dmsetting.com', 'Other', '', '', '', null, 'https://share.descript.com/view/ESvdUvydBxh', 'Not sent', null, 'IG @stocknavigators has DMs off; recruiter ian@dmsetting.com', 13)
) as v(external_id, offer, niche, owner, instagram, email, channel, ticket, setter_ote, source_url, date_sent, video_url, stage, follow_up_date, notes, sort_order)
where not exists (
  select 1 from public.setter_applications existing
  where existing.external_id = v.external_id
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'setter_applications'
    ) then
      execute 'alter publication supabase_realtime add table public.setter_applications';
    end if;
  end if;
exception when others then
  raise notice 'setter_applications was not added to supabase_realtime: %', sqlerrm;
end $$;
