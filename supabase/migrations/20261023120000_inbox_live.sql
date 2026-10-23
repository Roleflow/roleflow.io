-- Unread counts for the inbox. A paused chat is stored and not auto-answered.
-- Does not send anything.

alter table public.acq_contacts
  add column if not exists unread_count integer not null default 0;

create or replace function public.acq_gateway_store_inbound(
  p_business uuid,
  p_sender text,
  p_username text,
  p_conversation text,
  p_external text,
  p_body text,
  p_at timestamptz,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text;
  v_handle text;
  v_contact uuid;
  v_conversation uuid;
  v_thread uuid;
  v_state text;
  v_message uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  v_sender := nullif(left(coalesce(p_sender, ''), 80), '');
  if v_sender is null then
    return jsonb_build_object('ok', false);
  end if;
  v_handle := nullif(lower(regexp_replace(coalesce(p_username, ''), '^@+', '')), '');
  v_state := case when p_kind = 'comment' then 'comment_to_dm' else 'qualification' end;
  insert into public.acq_contacts (business_id, external_id, name, ig_handle, source_detail, last_message_at)
  values (p_business, v_sender, coalesce(v_handle, ''), v_handle, 'instagram', p_at)
  on conflict (business_id, external_id) do update
    set ig_handle = coalesce(excluded.ig_handle, public.acq_contacts.ig_handle),
        last_message_at = excluded.last_message_at,
        updated_at = now()
  returning id into v_contact;
  select id into v_conversation from public.acq_conversations where contact_id = v_contact;
  if v_conversation is null then
    insert into public.acq_conversations (business_id, contact_id, external_id, status)
    values (p_business, v_contact, left(coalesce(nullif(p_conversation, ''), v_sender), 200), 'warm')
    returning id into v_conversation;
  else
    update public.acq_conversations
      set external_id = coalesce(nullif(p_conversation, ''), external_id),
          updated_at = now()
      where id = v_conversation;
  end if;
  insert into public.acq_messages (business_id, conversation_id, external_id, role, body, sent_at)
  values (
    p_business,
    v_conversation,
    left(p_external, 200),
    case when p_kind = 'sent' then 'assistant' else 'user' end,
    left(coalesce(p_body, ''), 4000),
    p_at
  )
  on conflict (conversation_id, external_id) do nothing
  returning id into v_message;
  if v_message is not null then
    update public.acq_contacts
      set message_count = message_count + 1,
          unread_count = case
            when p_kind = 'sent' then unread_count
            else unread_count + 1
          end,
          updated_at = now()
      where id = v_contact;
  end if;
  insert into public.ig_threads (business_id, igsid, username, state, last_user_message_at)
  values (p_business, v_sender, v_handle, v_state, p_at)
  on conflict (business_id, igsid) do update
    set username = coalesce(excluded.username, public.ig_threads.username),
        last_user_message_at = case
          when p_kind = 'sent' then public.ig_threads.last_user_message_at
          else excluded.last_user_message_at
        end,
        followup_count = case when p_kind = 'sent' then public.ig_threads.followup_count else 0 end,
        updated_at = now()
  returning id into v_thread;
  insert into public.ig_messages (business_id, thread_id, direction, body, meta_mid, kind)
  values (
    p_business,
    v_thread,
    case when p_kind = 'sent' then 'out' else 'in' end,
    left(coalesce(p_body, ''), 4000),
    nullif(left(p_external, 200), ''),
    case when p_kind = 'comment' then 'comment' else 'text' end
  )
  on conflict (meta_mid) do nothing;
  return jsonb_build_object('ok', true, 'conversation_id', v_conversation, 'thread_id', v_thread, 'contact_id', v_contact);
end;
$$;

revoke all on function public.acq_gateway_store_inbound(uuid, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.acq_gateway_store_inbound(uuid, text, text, text, text, text, timestamptz, text) to service_role;
