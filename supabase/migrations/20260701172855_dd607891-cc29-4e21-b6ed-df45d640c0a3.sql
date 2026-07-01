
-- Helper: detect if the current session should bypass self-service column locks
CREATE OR REPLACE FUNCTION public.is_privileged_writer()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
BEGIN
  -- Service role / no JWT (background jobs, migrations)
  IF jwt_role = 'service_role' OR uid IS NULL THEN
    RETURN true;
  END IF;
  IF public.has_role(uid, 'admin'::app_role) THEN RETURN true; END IF;
  IF public.has_role(uid, 'coach'::app_role) THEN RETURN true; END IF;
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_privileged_writer() TO authenticated, service_role;

-- =========================================================================
-- app_members: block self-updates to billing/access columns
-- =========================================================================
CREATE OR REPLACE FUNCTION public.protect_app_members_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  -- Non-privileged (the member themselves) cannot touch these:
  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.manual_access_override IS DISTINCT FROM OLD.manual_access_override
     OR NEW.access_end_date IS DISTINCT FROM OLD.access_end_date
     OR NEW.access_start_date IS DISTINCT FROM OLD.access_start_date
     OR NEW.trial_end_date IS DISTINCT FROM OLD.trial_end_date
     OR NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted app_members columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_app_members_self_update ON public.app_members;
CREATE TRIGGER trg_protect_app_members_self_update
  BEFORE UPDATE ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_app_members_self_update();

-- =========================================================================
-- clients: block self-updates to coach/billing/compliance columns
-- =========================================================================
CREATE OR REPLACE FUNCTION public.protect_clients_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_coach_id IS DISTINCT FROM OLD.assigned_coach_id
     OR NEW.compliance_status IS DISTINCT FROM OLD.compliance_status
     OR NEW.agreement_signed IS DISTINCT FROM OLD.agreement_signed
     OR NEW.billing_source IS DISTINCT FROM OLD.billing_source
     OR NEW.billing_source_locked IS DISTINCT FROM OLD.billing_source_locked
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.lead_score IS DISTINCT FROM OLD.lead_score
     OR NEW.coach_notes IS DISTINCT FROM OLD.coach_notes
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted clients columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_clients_self_update ON public.clients;
CREATE TRIGGER trg_protect_clients_self_update
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.protect_clients_self_update();

-- =========================================================================
-- purchase_records: allow only terms acceptance from clients
-- =========================================================================
CREATE OR REPLACE FUNCTION public.protect_purchase_records_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.service_status IS DISTINCT FROM OLD.service_status
     OR NEW.contract_value_cents IS DISTINCT FROM OLD.contract_value_cents
     OR NEW.sessions_purchased IS DISTINCT FROM OLD.sessions_purchased
     OR NEW.sessions_used IS DISTINCT FROM OLD.sessions_used
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted purchase_records columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_purchase_records_self_update ON public.purchase_records;
CREATE TRIGGER trg_protect_purchase_records_self_update
  BEFORE UPDATE ON public.purchase_records
  FOR EACH ROW EXECUTE FUNCTION public.protect_purchase_records_self_update();

-- =========================================================================
-- messages: clients only mark as read
-- =========================================================================
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

  IF NEW.body IS DISTINCT FROM OLD.body
     OR NEW.sender_role IS DISTINCT FROM OLD.sender_role
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.is_internal_note IS DISTINCT FROM OLD.is_internal_note
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted messages columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_messages_client_update ON public.messages;
CREATE TRIGGER trg_protect_messages_client_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.protect_messages_client_update();

-- =========================================================================
-- fillout_submissions: clients cannot rewrite answers after submit
-- =========================================================================
CREATE OR REPLACE FUNCTION public.protect_fillout_submissions_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.response_json IS DISTINCT FROM OLD.response_json
     OR NEW.raw_payload IS DISTINCT FROM OLD.raw_payload
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
     OR NEW.form_id IS DISTINCT FROM OLD.form_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
  THEN
    RAISE EXCEPTION 'Not permitted to update restricted fillout_submissions columns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_fillout_submissions_self_update ON public.fillout_submissions;
CREATE TRIGGER trg_protect_fillout_submissions_self_update
  BEFORE UPDATE ON public.fillout_submissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_fillout_submissions_self_update();
