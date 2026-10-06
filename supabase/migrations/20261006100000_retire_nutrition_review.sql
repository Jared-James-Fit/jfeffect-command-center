-- Retire the monthly "Nutrition Review" (it duplicated the Weekly Check-In).
--
-- Kept on purpose: every COMPLETED Nutrition Review (answers, AI recap, the
-- client's "complete" message) and the form record itself, so history stays
-- readable. Only unanswered requests are unsent. Safe to re-run.

-- 1. Stop scheduling. Both the SQL cron functions and the app read
--    coalesce(override.enabled, definition.enabled), so turn off the
--    definition AND any per-client override that could turn it back on.
update public.coach_task_definitions
   set enabled = false, updated_at = now()
 where task_type = 'nutrition_review';

update public.client_task_overrides
   set enabled = false
 where task_type = 'nutrition_review'
   and enabled is distinct from false;

-- 2. Close any open occurrences so nothing shows on Home / Action Centre.
update public.client_task_occurrences o
   set status = 'skipped',
       updated_at = now(),
       payload_ref = coalesce(o.payload_ref, '{}'::jsonb)
         || jsonb_build_object('skip_reason', 'nutrition_review_retired')
 where o.task_type = 'nutrition_review'
   and o.status not in ('completed', 'skipped');

-- 3. Archive the form (same effect as archiveForm()). Not deleted: submissions
--    reference it and deleting would cascade into completed history.
update public.nf_forms
   set archived = true, active = false
 where id = '0cbd5e2c-ed47-48ea-93fd-20c341013444';

-- 4. Unsend unanswered requests from client chats. Same silent-delete as the
--    admin tool: the message is removed outright (no "deleted" placeholder for
--    the client) and a copy goes to message_deletions for admins / the coach.
do $$
declare
  doomed uuid[];
  affected uuid[];
begin
  select coalesce(array_agg(c.request_message_id), '{}'),
         coalesce(array_agg(distinct c.client_id), '{}')
    into doomed, affected
    from public.messenger_checkins c
   where c.task_type = 'nutrition_review'
     and c.submitted_at is null
     and c.status in ('pending', 'superseded')
     and c.request_message_id is not null;

  insert into public.message_deletions
    (message_id, chat, client_id, sender_id, sender_role, body, attachments, original_created_at, deleted_by)
  select m.id, 'dm', m.client_id, m.sender_id, m.sender_role, m.body, m.attachments, m.created_at, null
    from public.messages m
   where m.id = any(doomed);

  delete from public.messages where id = any(doomed);

  -- Unanswered check-in rows hold no answers; drop them so they stop counting
  -- as "waiting on client" in the inbox.
  delete from public.messenger_checkins
   where task_type = 'nutrition_review'
     and submitted_at is null
     and status in ('pending', 'superseded');

  -- Inbox ordering follows what's actually left in the thread.
  update public.conversation_state cs
     set last_message_at = coalesce(
           (select max(m.created_at) from public.messages m
             where m.client_id = cs.client_id and not m.is_internal_note),
           cs.last_message_at),
         updated_at = now()
   where cs.client_id = any(affected);
end;
$$;
