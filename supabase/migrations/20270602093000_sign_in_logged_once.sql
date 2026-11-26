-- A sign-in is recorded once, not once per auth event (Nov 26 2026).
--
-- The app calls mark_client_signed_in on INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED and the
-- getSession() restore, so one app open wrote 2-4 identical 'signed_in' rows (4,162 of the
-- 6,986 in the 30 days to Nov 26 were within 2 minutes of the one before). Now a call within
-- 2 minutes of the client's last recorded sign-in does nothing, unless it's the sign-in that
-- turns a coaching Lead into a client, which always runs. Existing rows are kept as they are.

CREATE OR REPLACE FUNCTION public.mark_client_signed_in()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_client_id uuid;
  v_was_lead boolean;
  v_last timestamptz;
  v_claims text;
  v_sub text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT c.id,
         (c.service_tier = 'coaching' AND c.status = 'Lead' AND NOT coalesce(c.archived, false)),
         c.last_signed_in_at
    INTO v_client_id, v_was_lead, v_last
    FROM public.clients c
   WHERE c.user_id = v_uid
   LIMIT 1;
  IF v_client_id IS NULL THEN RETURN; END IF;

  -- Already recorded a moment ago (the same app open): nothing to do.
  IF NOT v_was_lead AND v_last IS NOT NULL AND v_last > now() - interval '2 minutes' THEN
    RETURN;
  END IF;

  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE public.clients
     SET last_signed_in_at = now(),
         last_active_at = now(),
         account_status = CASE
           WHEN account_status IN ('Invite Not Sent', 'Invite Sent', 'Invite Expired', 'Password Reset Sent')
             THEN 'Account Created'
           ELSE account_status END,
         status = CASE WHEN v_was_lead THEN 'Active' ELSE status END,
         lifecycle_stage = CASE WHEN v_was_lead THEN 'active_client' ELSE lifecycle_stage END,
         converted_to_client_at = CASE
           WHEN v_was_lead THEN coalesce(converted_to_client_at, now())
           ELSE converted_to_client_at END
   WHERE id = v_client_id;

  IF v_was_lead THEN
    UPDATE public.coaching_applications
       SET status = 'Approved'
     WHERE client_id = v_client_id
       AND coalesce(status, 'New') IN ('New', 'Needs Review', 'Contacted');
  END IF;

  INSERT INTO public.client_activity_log (client_id, actor_user_id, actor_role, action, details)
  VALUES (
    v_client_id, v_uid, 'client', 'signed_in',
    CASE WHEN v_was_lead THEN jsonb_build_object('became_client', true) ELSE '{}'::jsonb END
  );

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
END;
$function$;
