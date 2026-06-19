-- Restrict client-side UPDATE on messages to the read_by_client_at column only.
-- Implemented as a BEFORE UPDATE trigger so admin/coach updates (same authenticated
-- role, different RLS policy) continue to work.

CREATE OR REPLACE FUNCTION public.prevent_client_self_privileged_message_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  owning_user uuid;
BEGIN
  -- Service role / system context: no auth.uid(). Allow.
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins: allow.
  IF has_role(uid, 'admin') THEN
    RETURN NEW;
  END IF;

  -- Assigned coach for this message's client: allow.
  IF is_assigned_coach(NEW.client_id) OR is_assigned_coach(OLD.client_id) THEN
    RETURN NEW;
  END IF;

  -- Resolve owning client user_id.
  SELECT c.user_id INTO owning_user FROM public.clients c WHERE c.id = OLD.client_id;

  IF owning_user IS NOT NULL AND owning_user = uid THEN
    -- Client editing their own message row: only allow read_by_client_at to change.
    IF NEW.is_internal_note     IS DISTINCT FROM OLD.is_internal_note
       OR NEW.priority          IS DISTINCT FROM OLD.priority
       OR NEW.delivery_status   IS DISTINCT FROM OLD.delivery_status
       OR NEW.sender_role       IS DISTINCT FROM OLD.sender_role
       OR NEW.sender_id         IS DISTINCT FROM OLD.sender_id
       OR NEW.message_type      IS DISTINCT FROM OLD.message_type
       OR NEW.body              IS DISTINCT FROM OLD.body
       OR NEW.client_id         IS DISTINCT FROM OLD.client_id
       OR NEW.read_by_admin_at  IS DISTINCT FROM OLD.read_by_admin_at
       OR NEW.transcript_status IS DISTINCT FROM OLD.transcript_status
       OR NEW.transcript_text   IS DISTINCT FROM OLD.transcript_text
       OR NEW.attachments       IS DISTINCT FROM OLD.attachments
       OR NEW.created_at        IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Permission denied: clients can only mark their own message as read'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_block_client_self_privileged_update ON public.messages;
CREATE TRIGGER trg_messages_block_client_self_privileged_update
BEFORE UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_self_privileged_message_update();