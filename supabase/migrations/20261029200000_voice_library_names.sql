-- NOT APPLIED.
-- Names and assignments for voice notes. It does not remove a table or a recording.
-- Do not run this against production from the repo.
-- It does not turn sending on.

alter table public.acq_voice_library
  add column if not exists assignment_kind text not null default 'none',
  add column if not exists step_name text not null default '',
  add column if not exists lead_handle text not null default '',
  add column if not exists duration_ms integer,
  add column if not exists deleted_at timestamptz;

alter table public.acq_voice_library drop constraint if exists acq_voice_assignment_check;
alter table public.acq_voice_library
  add constraint acq_voice_assignment_check check (assignment_kind in ('none', 'step', 'person'));

alter table public.acq_voice_library drop constraint if exists acq_voice_slot_check;
alter table public.acq_voice_library
  add constraint acq_voice_slot_check check (
    slot in (
      'outreach_opener', 'gap_building', 'recovery_followup_1', 'recovery_followup_2',
      'recovery_value', 'booking_confirmation', 'pre_call_value', 'pre_call', 'reminder',
      'comment', 'library'
    )
  );

alter table public.acq_comment_ctas
  add column if not exists voice_note_id uuid references public.acq_voice_library (id) on delete set null;
