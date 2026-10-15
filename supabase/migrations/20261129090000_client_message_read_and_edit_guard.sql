-- Clients' "read" stamps on coach messages stopped saving (Oct 2026): the guard
-- on messages compared NEW.transcript_text, a column messages doesn't have, so
-- every client UPDATE errored ("record new has no field transcript_text").
-- markRead still moved conversation_state, so the Messages tab badge cleared
-- but the coach's "Read" receipt and the inbox's unread dot on Coach never did.
--
-- The guard now names the columns a client MAY change instead of the ones they
-- may not (a dropped or added column can't break it again), and lets the sender
-- edit or delete their own message, which the chat has offered all along but
-- the old guard refused:
--   * any message in their thread: read_by_client_at only
--   * their own message: also body, edited_at, and deleting it for everyone
--     (deleted_at, with the words and attachments cleared); never undeleted
-- Staff, coaches and the server are unchanged.

CREATE OR REPLACE FUNCTION public.prevent_client_self_privileged_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  owning_user uuid;
  free text[] := ARRAY['read_by_client_at', 'updated_at'];
  own boolean;
BEGIN
  -- Service role / system context: no auth.uid(). Allow.
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF has_role(uid, 'admin') THEN
    RETURN NEW;
  END IF;
  IF is_assigned_coach(NEW.client_id) OR is_assigned_coach(OLD.client_id) THEN
    RETURN NEW;
  END IF;

  SELECT c.user_id INTO owning_user FROM public.clients c WHERE c.id = OLD.client_id;
  IF owning_user IS NULL OR owning_user <> uid THEN
    RETURN NEW;
  END IF;

  own := OLD.sender_role = 'client' AND OLD.sender_id = uid AND OLD.deleted_at IS NULL;
  IF own THEN
    free := free || ARRAY['body', 'edited_at', 'deleted_at', 'attachments'];
  END IF;

  IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free) THEN
    RAISE EXCEPTION 'Permission denied: clients can only mark messages read, or edit and delete their own'
      USING ERRCODE = '42501';
  END IF;

  -- Attachments only go when the message is deleted for everyone.
  IF NEW.attachments IS DISTINCT FROM OLD.attachments
     AND NOT (NEW.deleted_at IS NOT NULL AND (NEW.attachments IS NULL OR NEW.attachments = '[]'::jsonb)) THEN
    RAISE EXCEPTION 'Permission denied: attachments can only be removed by deleting the message'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_client_self_privileged_message_update() FROM PUBLIC, anon, authenticated;

-- The second guard had the same flaw (NEW.thread_id, also not a column) and
-- refused any body change from a non-staff writer, so it also blocked a
-- client's edit/delete of their own message. Same rule as above.
CREATE OR REPLACE FUNCTION public.protect_messages_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_role IS DISTINCT FROM OLD.sender_role
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.is_internal_note IS DISTINCT FROM OLD.is_internal_note
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.body IS DISTINCT FROM OLD.body
         AND NOT (OLD.sender_role = 'client' AND OLD.sender_id = auth.uid() AND OLD.deleted_at IS NULL))
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted messages columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Repair: coach messages a client already read (their conversation read marker
-- is past them) but whose stamp was lost. Stamped with that read time.
UPDATE public.messages m
SET read_by_client_at = cs.client_last_read_at
FROM public.conversation_state cs
WHERE cs.client_id = m.client_id
  AND m.sender_role <> 'client'
  AND m.is_internal_note = false
  AND m.read_by_client_at IS NULL
  AND cs.client_last_read_at IS NOT NULL
  AND m.created_at <= cs.client_last_read_at;
