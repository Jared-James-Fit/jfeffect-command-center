
-- Helper: authorize a user for a chat-presence topic of the form 'chat-presence:{client_uuid}'
CREATE OR REPLACE FUNCTION public.can_access_chat_presence(_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_id_text text;
  v_client_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _topic IS NULL THEN
    RETURN false;
  END IF;
  v_prefix := split_part(_topic, ':', 1);
  IF v_prefix <> 'chat-presence' THEN
    RETURN false;
  END IF;
  v_id_text := split_part(_topic, ':', 2);
  IF v_id_text = '' THEN
    RETURN false;
  END IF;
  BEGIN
    v_client_id := v_id_text::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Admins always allowed
  IF public.has_role(v_uid, 'admin'::app_role) THEN
    RETURN true;
  END IF;

  -- Assigned coach
  IF public.is_assigned_coach(v_client_id) THEN
    RETURN true;
  END IF;

  -- The client themselves (must be an active, non-archived client)
  IF EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = v_client_id
      AND user_id = v_uid
      AND archived = false
      AND status = 'Active'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_chat_presence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_chat_presence(text) TO authenticated;

-- Enable RLS on realtime.messages (idempotent) and add private-channel policies
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat presence read" ON realtime.messages;
DROP POLICY IF EXISTS "chat presence write" ON realtime.messages;

-- Read = subscribe to a topic (presence sync, broadcast receive)
CREATE POLICY "chat presence read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE 'chat-presence:%')
  AND public.can_access_chat_presence(realtime.topic())
);

-- Write = send presence/broadcast events on the topic
CREATE POLICY "chat presence write"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (realtime.topic() LIKE 'chat-presence:%')
  AND public.can_access_chat_presence(realtime.topic())
);
