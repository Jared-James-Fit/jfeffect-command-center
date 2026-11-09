-- A coaching lead becomes a client the first time they sign in, and every
-- first sign-in is recorded.
--
-- 1) Devin applied (a coaching `Lead`), the coach texted him a setup link, he
--    signed in on Nov 6 and has trained since, yet his record still said Lead:
--    nothing ever moved it. Every job that means "a current client" checks
--    status IN ('Active', 'New Client'), so as a Lead he was left out of the
--    coach chat's live status, group chats, form sends and check-ins. A
--    coaching-tier Lead can only have a login from the coach's own setup link
--    (handle_new_user links invited logins only; a free sign-up turns the Lead
--    self-serve instead), so the first sign-in is when they've become a
--    client: status 'Active', lifecycle 'active_client', converted now, and
--    their application closes as Approved ("Signed up" on Leads).
--
-- 2) mark_client_signed_in ran as the client, and the clients guards
--    (clients_block_self_privileged_updates, guard_clients_self_update,
--    prevent_client_self_privileged_update) refuse a client changing
--    account_status or status on their own row. So the first sign-in after an
--    emailed invite or reset ('Invite Sent' / 'Password Reset Sent' →
--    'Account Created') raised, and the whole update failed: no
--    last_signed_in_at, the setup link never knew they'd signed in. What this
--    function writes is decided here, never by the caller, so it runs as the
--    server for that write (the same way _member_free_join does) and puts the
--    person's claims back after.

CREATE OR REPLACE FUNCTION public.mark_client_signed_in()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client_id uuid;
  v_was_lead boolean;
  v_claims text;
  v_sub text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT c.id,
         (c.service_tier = 'coaching' AND c.status = 'Lead' AND NOT coalesce(c.archived, false))
    INTO v_client_id, v_was_lead
    FROM public.clients c
   WHERE c.user_id = v_uid
   LIMIT 1;
  IF v_client_id IS NULL THEN RETURN; END IF;

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
$$;

GRANT EXECUTE ON FUNCTION public.mark_client_signed_in() TO authenticated;

-- Leads who have already signed in (Devin) are clients now; their applications close.
WITH promoted AS (
  UPDATE public.clients
     SET status = 'Active',
         lifecycle_stage = 'active_client',
         converted_to_client_at = coalesce(converted_to_client_at, last_signed_in_at, now())
   WHERE service_tier = 'coaching'
     AND status = 'Lead'
     AND last_signed_in_at IS NOT NULL
     AND NOT coalesce(archived, false)
  RETURNING id
)
UPDATE public.coaching_applications a
   SET status = 'Approved'
  FROM promoted p
 WHERE a.client_id = p.id
   AND coalesce(a.status, 'New') IN ('New', 'Needs Review', 'Contacted');
