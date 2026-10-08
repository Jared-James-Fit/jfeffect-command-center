-- Remove every trace of the retired "Nutrition Review" from client chats and
-- form requests. Only Weekly Check-In and Nutrition Update Request remain.
--
-- Chat messages are silently removed (no "deleted" placeholder for clients),
-- each logged in message_deletions so nothing is unrecoverable. The underlying
-- answers (messenger_checkins / nf_submissions that were actually submitted)
-- are NOT deleted: they just no longer appear in any chat. Safe to re-run.

do $$
declare
  retired_form constant uuid := '0cbd5e2c-ed47-48ea-93fd-20c341013444';
  doomed uuid[];
  affected uuid[];
begin
  -- 1. Every chat message that carries a Nutrition Review: the check-in request
  --    card, the "complete" submission message, and any form_request for the
  --    old Nutrition Review form.
  select coalesce(array_agg(m.id), '{}'), coalesce(array_agg(distinct m.client_id), '{}')
    into doomed, affected
    from public.messages m
   where jsonb_typeof(m.attachments) = 'array'
     and exists (
       select 1
         from jsonb_array_elements(m.attachments) a
        where (a->>'kind' in ('checkin_request', 'checkin_submission')
               and a->>'checkin_task_type' = 'nutrition_review')
           or (a->>'kind' = 'form_request' and a->>'form_id' = retired_form::text)
     );

  insert into public.message_deletions
    (message_id, chat, client_id, sender_id, sender_role, body, attachments, original_created_at, deleted_by)
  select m.id, 'dm', m.client_id, m.sender_id, m.sender_role, m.body, m.attachments, m.created_at, null
    from public.messages m
   where m.id = any(doomed);

  delete from public.messages where id = any(doomed);

  -- 2. Unanswered check-in rows hold no answers; drop them so nothing counts
  --    as "waiting on client". Submitted ones stay as data.
  delete from public.messenger_checkins
   where task_type = 'nutrition_review'
     and submitted_at is null;

  -- 3. Old Nutrition Review form: drop assignments and unfinished drafts so it
  --    can't resurface in a client's Check-ins list. Submitted answers stay.
  delete from public.nf_assignments where form_id = retired_form;
  delete from public.nf_submissions where form_id = retired_form and submitted_at is null;
  update public.nf_forms set archived = true, active = false where id = retired_form;

  -- 4. Make sure nothing schedules it again.
  update public.coach_task_definitions set enabled = false, updated_at = now()
   where task_type = 'nutrition_review';
  update public.client_task_overrides set enabled = false
   where task_type = 'nutrition_review' and enabled is distinct from false;
  update public.client_task_occurrences o
     set status = 'skipped', updated_at = now(),
         payload_ref = coalesce(o.payload_ref, '{}'::jsonb) || jsonb_build_object('skip_reason', 'nutrition_review_retired')
   where o.task_type = 'nutrition_review' and o.status not in ('completed', 'skipped');

  -- 5. Inbox ordering follows what's actually left in each thread.
  update public.conversation_state cs
     set last_message_at = coalesce(
           (select max(m.created_at) from public.messages m
             where m.client_id = cs.client_id and not m.is_internal_note),
           cs.last_message_at),
         updated_at = now()
   where cs.client_id = any(affected);
end;
$$;
