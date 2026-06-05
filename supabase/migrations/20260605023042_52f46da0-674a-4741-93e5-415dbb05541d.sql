
-- 1) Broaden the agreement-block check
CREATE OR REPLACE FUNCTION public.enforce_purchase_agreement_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req boolean;
  before_service boolean;
  has_clear boolean;
  start_active boolean;
  status_active boolean;
BEGIN
  IF COALESCE(NEW.agreement_block_override, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.offer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.requires_agreement, o.agreement_before_service
    INTO req, before_service
    FROM public.offers o WHERE o.id = NEW.offer_id;

  IF NOT COALESCE(req, false) OR NOT COALESCE(before_service, false) THEN
    RETURN NEW;
  END IF;

  status_active := (NEW.status = 'Active') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status);
  start_active  := (NEW.term_start_date IS NOT NULL AND NEW.term_start_date <= CURRENT_DATE)
                   AND (TG_OP = 'INSERT' OR OLD.term_start_date IS DISTINCT FROM NEW.term_start_date);

  IF NOT (status_active OR start_active) THEN
    RETURN NEW;
  END IF;

  -- "Clear" = at least one linked agreement that is signed AND verified,
  -- not in any blocking state, and no signer mismatch.
  SELECT EXISTS (
    SELECT 1 FROM public.agreements a
     WHERE a.purchase_record_id = NEW.id
       AND COALESCE(a.signer_mismatch, false) = false
       AND a.status NOT IN (
         'Not Sent','Sent','Opened','Waiting on Client',
         'Manual Action Needed','Needs Manual Verification','Needs Resend',
         'Expired','Cancelled','Error'
       )
       AND (
         a.status = 'Verified'
         OR a.verification_status IN ('Manually Verified','Auto-Matched')
       )
       AND a.signed_at IS NOT NULL
  ) INTO has_clear;

  IF NOT has_clear THEN
    RAISE EXCEPTION 'Agreement required: purchase % cannot start service. A linked agreement must be signed, verified, free of signer mismatch, and not expired/cancelled/manual-action.', NEW.id
      USING ERRCODE = 'check_violation',
            HINT = 'Verify the linked agreement, resolve mismatches/expiry, or set agreement_block_override=true with a written reason.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_purchase_agreement_block() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_purchase_agreement_block() TO service_role;

-- 2) Strengthen the override stamp trigger:
--    - require a non-empty reason
--    - require admin or assigned coach
--    - write a client_activity_log audit entry on apply or clear
CREATE OR REPLACE FUNCTION public.stamp_agreement_block_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin_v boolean := false;
  is_coach_v boolean := false;
  was boolean := COALESCE(OLD.agreement_block_override, false);
  now_v boolean := COALESCE(NEW.agreement_block_override, false);
BEGIN
  IF TG_OP = 'INSERT' THEN was := false; END IF;

  IF now_v <> was THEN
    -- Permission gate
    IF uid IS NULL THEN
      RAISE EXCEPTION 'Agreement override requires an authenticated admin or assigned coach.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT public.has_role(uid, 'admin'::app_role) INTO is_admin_v;
    IF NOT is_admin_v THEN
      SELECT public.is_assigned_coach(NEW.client_id) INTO is_coach_v;
    END IF;
    IF NOT (is_admin_v OR is_coach_v) THEN
      RAISE EXCEPTION 'Only an admin or assigned coach can change the agreement override.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF now_v THEN
      IF NEW.agreement_block_override_reason IS NULL
         OR length(btrim(NEW.agreement_block_override_reason)) < 5 THEN
        RAISE EXCEPTION 'A written reason (>=5 chars) is required to override the agreement block.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.agreement_block_override_at := COALESCE(NEW.agreement_block_override_at, now());
      NEW.agreement_block_override_by := COALESCE(NEW.agreement_block_override_by, uid);
    END IF;

    -- Audit
    INSERT INTO public.client_activity_log (client_id, actor_user_id, actor_role, action, details)
    VALUES (
      NEW.client_id,
      uid,
      CASE WHEN is_admin_v THEN 'admin' ELSE 'coach' END,
      CASE WHEN now_v THEN 'agreement_block_override_applied' ELSE 'agreement_block_override_cleared' END,
      jsonb_build_object(
        'purchase_record_id', NEW.id,
        'offer_id', NEW.offer_id,
        'reason', NEW.agreement_block_override_reason,
        'previous', was,
        'current', now_v
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_agreement_block_override() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_agreement_block_override() TO service_role;
