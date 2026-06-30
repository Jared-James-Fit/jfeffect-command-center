
-- 1) Guard trigger: app_members self-update column lock
CREATE OR REPLACE FUNCTION public.guard_app_members_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.manual_access_override IS DISTINCT FROM OLD.manual_access_override
     OR NEW.manual_access_disabled IS DISTINCT FROM OLD.manual_access_disabled
     OR NEW.access_end_date IS DISTINCT FROM OLD.access_end_date
     OR NEW.in_grace IS DISTINCT FROM OLD.in_grace
     OR NEW.cross_account_locked IS DISTINCT FROM OLD.cross_account_locked
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
  THEN
    RAISE EXCEPTION 'Not allowed: only admins can change subscription/access/billing fields on app_members';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_app_members_self_update ON public.app_members;
CREATE TRIGGER guard_app_members_self_update
BEFORE UPDATE ON public.app_members
FOR EACH ROW EXECUTE FUNCTION public.guard_app_members_self_update();

-- 2) Guard trigger: clients self-update column lock
CREATE OR REPLACE FUNCTION public.guard_clients_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  -- Coaches updating assigned clients also bypass this restriction
  IF OLD.assigned_coach_id IS NOT NULL AND OLD.assigned_coach_id = public.current_coach_id() THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.assigned_coach_id IS DISTINCT FROM OLD.assigned_coach_id
     OR NEW.account_status IS DISTINCT FROM OLD.account_status
     OR NEW.billing_source IS DISTINCT FROM OLD.billing_source
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.agreement_signed IS DISTINCT FROM OLD.agreement_signed
     OR NEW.agreement_status IS DISTINCT FROM OLD.agreement_status
     OR NEW.agreement_signed_date IS DISTINCT FROM OLD.agreement_signed_date
     OR NEW.sessions_purchased IS DISTINCT FROM OLD.sessions_purchased
     OR NEW.sessions_used IS DISTINCT FROM OLD.sessions_used
     OR NEW.coach_call_access_enabled IS DISTINCT FROM OLD.coach_call_access_enabled
     OR NEW.portal_access_disabled IS DISTINCT FROM OLD.portal_access_disabled
  THEN
    RAISE EXCEPTION 'Not allowed: only admins can change billing/access/coach assignment fields on clients';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_clients_self_update ON public.clients;
CREATE TRIGGER guard_clients_self_update
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.guard_clients_self_update();

-- 3) Guard trigger: coaches self-update column lock
CREATE OR REPLACE FUNCTION public.guard_coaches_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.archived IS DISTINCT FROM OLD.archived
  THEN
    RAISE EXCEPTION 'Not allowed: only admins can change status/archived on coaches';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_coaches_self_update ON public.coaches;
CREATE TRIGGER guard_coaches_self_update
BEFORE UPDATE ON public.coaches
FOR EACH ROW EXECUTE FUNCTION public.guard_coaches_self_update();

-- 4) Guard trigger: purchase_records client self-update restricted to terms acceptance
CREATE OR REPLACE FUNCTION public.guard_purchase_records_client_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_owner_client BOOLEAN;
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF public.is_assigned_coach(OLD.client_id) THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = OLD.client_id AND c.user_id = auth.uid()
  ) INTO is_owner_client;
  IF NOT is_owner_client THEN
    RETURN NEW; -- some other policy will block / allow; not this trigger's job
  END IF;
  -- Owning client: only allow terms_accepted / terms_accepted_at to change
  IF to_jsonb(NEW) - 'terms_accepted' - 'terms_accepted_at' - 'updated_at'
     IS DISTINCT FROM
     to_jsonb(OLD) - 'terms_accepted' - 'terms_accepted_at' - 'updated_at'
  THEN
    RAISE EXCEPTION 'Not allowed: clients may only update terms acceptance on their purchase records';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_purchase_records_client_update ON public.purchase_records;
CREATE TRIGGER guard_purchase_records_client_update
BEFORE UPDATE ON public.purchase_records
FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_records_client_update();

-- 5) jf_membership_settings: restrict public read to authenticated users
DROP POLICY IF EXISTS "Public read jf settings" ON public.jf_membership_settings;
CREATE POLICY "Authenticated read jf settings"
ON public.jf_membership_settings
FOR SELECT
TO authenticated
USING (true);

-- 6) Revoke anon EXECUTE on internal email queue functions
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM anon, PUBLIC;
