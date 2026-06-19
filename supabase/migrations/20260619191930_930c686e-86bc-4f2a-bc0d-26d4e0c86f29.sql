-- Block client self-edits of sensitive fields on public.clients via a trigger.
-- RLS still lets a client update their own row, but the trigger rejects writes
-- to billing, agreement, access and CRM columns unless the caller is an admin
-- (or assigned coach, or service_role / system context where auth.uid() is NULL).

CREATE OR REPLACE FUNCTION public.prevent_client_self_privileged_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Service role / system context: no auth.uid(). Allow.
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins: allow.
  IF has_role(uid, 'admin') THEN
    RETURN NEW;
  END IF;

  -- Assigned coach for this client: allow.
  IF NEW.assigned_coach_id IS NOT NULL
     AND NEW.assigned_coach_id = current_coach_id() THEN
    RETURN NEW;
  END IF;
  IF OLD.assigned_coach_id IS NOT NULL
     AND OLD.assigned_coach_id = current_coach_id() THEN
    RETURN NEW;
  END IF;

  -- Otherwise: only the row owner (the client) should be reaching this point
  -- under existing RLS. Block changes to sensitive columns.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.assigned_coach_id IS DISTINCT FROM OLD.assigned_coach_id
     OR NEW.agreement_signed IS DISTINCT FROM OLD.agreement_signed
     OR NEW.agreement_status IS DISTINCT FROM OLD.agreement_status
     OR NEW.agreement_signed_date IS DISTINCT FROM OLD.agreement_signed_date
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.billing_source IS DISTINCT FROM OLD.billing_source
     OR NEW.account_status IS DISTINCT FROM OLD.account_status
     OR NEW.account_created_at IS DISTINCT FROM OLD.account_created_at
     OR NEW.portal_access_disabled IS DISTINCT FROM OLD.portal_access_disabled
     OR NEW.compliance_status IS DISTINCT FROM OLD.compliance_status
     OR NEW.lead_score IS DISTINCT FROM OLD.lead_score
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.archived IS DISTINCT FROM OLD.archived
     OR NEW.sessions_used IS DISTINCT FROM OLD.sessions_used
     OR NEW.sessions_purchased IS DISTINCT FROM OLD.sessions_purchased
     OR NEW.package_tracking_enabled IS DISTINCT FROM OLD.package_tracking_enabled
     OR NEW.call_access_enabled IS DISTINCT FROM OLD.call_access_enabled
     OR NEW.sms_opt_out IS DISTINCT FROM OLD.sms_opt_out
     OR NEW.schedule_locked IS DISTINCT FROM OLD.schedule_locked
     OR NEW.invite_sent_at IS DISTINCT FROM OLD.invite_sent_at
     OR NEW.invite_expires_at IS DISTINCT FROM OLD.invite_expires_at
     OR NEW.password_reset_sent_at IS DISTINCT FROM OLD.password_reset_sent_at
  THEN
    RAISE EXCEPTION 'Permission denied: clients cannot modify privileged fields on their own record'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_block_self_privileged_update ON public.clients;
CREATE TRIGGER trg_clients_block_self_privileged_update
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_self_privileged_update();