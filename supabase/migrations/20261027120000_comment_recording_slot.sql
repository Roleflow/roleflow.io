-- NOT APPLIED.
-- The owner applies this file. It does not run against production from the
-- pull request. It does not remove any table. It does not register a webhook.
-- Apply after 20261026160000_prompt_versions_and_comment_voice.sql.
--
-- Adds the comment recording slot and one when-to-send row per business.
-- Existing comment-voice rules stay. Their intent text is copied into the
-- new row only when that row is still empty.

alter table public.acq_voice_library drop constraint if exists acq_voice_slot_check;
alter table public.acq_voice_library
  add constraint acq_voice_slot_check check (
    slot in (
      'outreach_opener', 'gap_building', 'recovery_followup_1', 'recovery_followup_2',
      'recovery_value', 'booking_confirmation', 'pre_call_value', 'pre_call', 'reminder',
      'comment'
    )
  );

create table if not exists public.acq_comment_slots (
  business_id uuid primary key references public.acq_workspaces (id) on delete cascade,
  when_to_send text not null default '',
  voice_note_id uuid references public.acq_voice_library (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint acq_comment_slot_when check (char_length(when_to_send) <= 1000)
);

alter table public.acq_comment_slots enable row level security;

drop policy if exists acq_comment_slots_read on public.acq_comment_slots;
create policy acq_comment_slots_read on public.acq_comment_slots
  for select to authenticated using (public.acq_can_read(business_id));
drop policy if exists acq_comment_slots_write on public.acq_comment_slots;
create policy acq_comment_slots_write on public.acq_comment_slots
  for all to authenticated
  using (public.acq_can_edit(business_id))
  with check (public.acq_can_edit(business_id));

grant select, insert, update, delete on public.acq_comment_slots to authenticated;
grant all on public.acq_comment_slots to service_role;
revoke all on public.acq_comment_slots from anon;

insert into public.acq_comment_slots (business_id, when_to_send, voice_note_id)
select
  grouped.business_id,
  left(grouped.when_to_send, 1000),
  notes.id
from (
  select
    rules.business_id,
    string_agg(
      case
        when length(btrim(rules.intent)) > 0 then btrim(rules.intent)
        when cardinality(rules.keywords) > 0 then 'When a comment includes ' || array_to_string(rules.keywords, ', ')
        else ''
      end,
      E'\n' order by rules.position
    ) as when_to_send,
    (
      select picked.clip_id
      from public.acq_comment_voice_rules as picked
      where picked.business_id = rules.business_id
        and picked.clip_id is not null
      order by picked.position
      limit 1
    ) as clip_id
  from public.acq_comment_voice_rules as rules
  group by rules.business_id
) as grouped
left join public.acq_voice_library as notes on notes.id = grouped.clip_id
on conflict (business_id) do update
  set when_to_send = excluded.when_to_send,
      voice_note_id = coalesce(public.acq_comment_slots.voice_note_id, excluded.voice_note_id),
      updated_at = now()
  where public.acq_comment_slots.when_to_send = '';

create or replace function public.acq_bot_voice(p_agent uuid, p_slot text, p_niche text default null, p_variant text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized.');
  end if;
  if p_slot not in (
    'outreach_opener', 'gap_building', 'recovery_followup_1', 'recovery_followup_2',
    'recovery_value', 'booking_confirmation', 'pre_call_value', 'pre_call', 'reminder',
    'comment'
  ) then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Unknown voice slot.');
  end if;
  if not exists (select 1 from public.acq_settings where agent_id = p_agent) then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Acquisition is not set up for this business.');
  end if;
  v_note := public.acq_pick_voice_note(p_agent, p_slot, p_niche, p_variant);
  return jsonb_build_object('ok', true, 'slot', p_slot, 'voice_note', v_note);
end;
$$;

revoke all on function public.acq_bot_voice(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.acq_bot_voice(uuid, text, text, text) to service_role;
