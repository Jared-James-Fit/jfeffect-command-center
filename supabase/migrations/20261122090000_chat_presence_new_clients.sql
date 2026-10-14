-- "Live in chat" never worked for clients whose status is "New Client" (most
-- clients with app access): the private chat-presence channel only let in
-- status = 'Active', so their side was refused and neither person ever saw
-- the other live. Same rule as the rest of the app instead: any client with
-- app access (not archived, not deactivated, portal access on).
CREATE OR REPLACE FUNCTION public.can_access_chat_presence(_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_prefix text;
  v_id_text text;
  v_client_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _topic IS NULL THEN RETURN false; END IF;
  v_prefix := split_part(_topic, ':', 1);
  IF v_prefix <> 'chat-presence' THEN RETURN false; END IF;
  v_id_text := split_part(_topic, ':', 2);
  IF v_id_text = '' THEN RETURN false; END IF;
  BEGIN
    v_client_id := v_id_text::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  -- Admins always allowed
  IF public.has_role(v_uid, 'admin'::app_role) THEN RETURN true; END IF;

  -- Assigned coach
  IF public.is_assigned_coach(v_client_id) THEN RETURN true; END IF;

  -- The client themselves, while they have app access (any status but archived/deactivated)
  IF EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = v_client_id
       AND c.user_id = v_uid
       AND coalesce(c.archived, false) = false
       AND c.archived_at IS NULL
       AND coalesce(c.status, '') NOT IN ('Archived', 'Deactivated')
       AND coalesce(c.portal_access_disabled, false) = false
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$function$;
