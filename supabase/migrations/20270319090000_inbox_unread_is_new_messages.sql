-- The coach's Messages badge and the blue dot on a chat mean one thing: a new
-- message from the client you haven't read (Instagram's).
--
-- `unread` used to be "any inbound activity since you last looked": a weekly
-- check-in or Nutrition Update sent in (nf_submissions), a check-in card in
-- the chat, a lift upload. Those have their own places (the Weekly check-ins,
-- Nutrition updates and Forms filters, the line under a client's name), so
-- counting them again on the Messages tab only made the number say less.
--
-- A new message is anything the client sent in the chat after your read
-- marker (words, photos, videos, set videos, workout notes, session requests,
-- a post they shared) except the check-in form card, and never an internal
-- note or a message they unsent. Mark as unread still counts. The columns and
-- their types are unchanged, so every build keeps working.
--
-- And a chat can't hide a new message: one that arrives in an archived chat
-- brings it back to the Inbox (archived is for chats that are done, and a
-- client writing again means it isn't).

CREATE OR REPLACE FUNCTION public.message_is_new_for_staff(_m public.messages)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _m.sender_role = 'client'
     AND NOT coalesce(_m.is_internal_note, false)
     AND _m.deleted_at IS NULL
     AND coalesce(_m.delivery_status, 'sent') IN ('sent', 'sending')
     AND NOT ('checkin_submission' = ANY (public.message_attachment_kinds(_m.attachments)))
$$;
REVOKE ALL ON FUNCTION public.message_is_new_for_staff(public.messages) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_inbox_state()
RETURNS TABLE(client_id uuid, workflow_status text, workflow_reason text, workflow_status_updated_at timestamptz,
              workflow_updated_by_name text, last_inbound_at timestamptz, last_inbound_kind text,
              my_last_read_at timestamptz, unread boolean, unread_count int, archived boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); is_admin boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  is_admin := public.has_role(me, 'admin');
  IF NOT is_admin AND NOT public.has_role(me, 'coach') THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH cs AS (
    SELECT s.*, coalesce(r.last_read_at, s.admin_last_read_at) AS read_at, coalesce(r.manual_unread, false) AS manual
      FROM public.conversation_state s
      LEFT JOIN public.conversation_staff_reads r ON r.client_id = s.client_id AND r.user_id = me
     WHERE is_admin OR public.is_assigned_coach(s.client_id)
  )
  SELECT cs.client_id, cs.workflow_status, cs.workflow_reason, cs.workflow_status_updated_at,
         (SELECT coalesce(nullif(btrim(coalesce(p.full_name, '')), ''), 'Coach') FROM public.coaches p WHERE p.user_id = cs.workflow_status_updated_by LIMIT 1),
         cs.last_inbound_at, cs.last_inbound_kind, cs.read_at,
         cs.manual OR n.new_messages > 0,
         CASE WHEN n.new_messages > 0 THEN n.new_messages WHEN cs.manual THEN 1 ELSE 0 END,
         cs.status = 'archived'
    FROM cs
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS new_messages
        FROM public.messages m
       WHERE m.client_id = cs.client_id
         AND m.created_at > coalesce(cs.read_at, '-infinity'::timestamptz)
         AND public.message_is_new_for_staff(m)
    ) n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.staff_inbox_state() TO authenticated;

-- A new message reopens an archived chat.
CREATE OR REPLACE FUNCTION public.tg_messages_reopen_archived_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.message_is_new_for_staff(NEW) THEN
    UPDATE public.conversation_state
       SET status = 'open', updated_at = now()
     WHERE client_id = NEW.client_id AND status = 'archived';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_messages_reopen_archived_chat() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_messages_reopen_archived_chat ON public.messages;
CREATE TRIGGER trg_messages_reopen_archived_chat AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.tg_messages_reopen_archived_chat();
