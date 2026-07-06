
-- Prevent members/clients from escalating privileges via self-update.
-- Approach: add BEFORE UPDATE triggers that block changes to sensitive
-- columns unless the caller is an admin (or service_role bypasses RLS anyway).

CREATE OR REPLACE FUNCTION public.prevent_app_member_sensitive_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins can change anything
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- For self-updates, disallow changes to sensitive/access-control fields
  IF NEW.user_id = auth.uid() THEN
    IF NEW.manual_access_override      IS DISTINCT FROM OLD.manual_access_override
    OR NEW.manual_access_disabled      IS DISTINCT FROM OLD.manual_access_disabled
    OR NEW.subscription_status         IS DISTINCT FROM OLD.subscription_status
    OR NEW.stripe_customer_id          IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id      IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.cross_account_locked        IS DISTINCT FROM OLD.cross_account_locked
    OR NEW.access_starts_at            IS DISTINCT FROM OLD.access_starts_at
    OR NEW.access_ends_at              IS DISTINCT FROM OLD.access_ends_at
    OR NEW.trial_ends_at               IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.current_period_end          IS DISTINCT FROM OLD.current_period_end
    OR NEW.current_period_start        IS DISTINCT FROM OLD.current_period_start
    OR NEW.membership_tier             IS DISTINCT FROM OLD.membership_tier
    OR NEW.access_level                IS DISTINCT FROM OLD.access_level
    OR NEW.user_id                     IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'Not allowed to modify access-control or billing fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_app_member_sensitive_self_update ON public.app_members;
CREATE TRIGGER trg_prevent_app_member_sensitive_self_update
BEFORE UPDATE ON public.app_members
FOR EACH ROW
EXECUTE FUNCTION public.prevent_app_member_sensitive_self_update();


CREATE OR REPLACE FUNCTION public.prevent_client_sensitive_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins can change anything
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Assigned coach updates go through their own policy; allow them
  IF OLD.assigned_coach_id IS NOT NULL AND OLD.assigned_coach_id = public.current_coach_id() THEN
    RETURN NEW;
  END IF;

  -- Self-update path: block sensitive columns
  IF NEW.user_id = auth.uid() THEN
    IF NEW.payment_status           IS DISTINCT FROM OLD.payment_status
    OR NEW.agreement_signed         IS DISTINCT FROM OLD.agreement_signed
    OR NEW.assigned_coach_id        IS DISTINCT FROM OLD.assigned_coach_id
    OR NEW.compliance_status        IS DISTINCT FROM OLD.compliance_status
    OR NEW.portal_access_disabled   IS DISTINCT FROM OLD.portal_access_disabled
    OR NEW.stripe_customer_id       IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.user_id                  IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'Not allowed to modify billing, compliance, or coaching-assignment fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_sensitive_self_update ON public.clients;
CREATE TRIGGER trg_prevent_client_sensitive_self_update
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.prevent_client_sensitive_self_update();
