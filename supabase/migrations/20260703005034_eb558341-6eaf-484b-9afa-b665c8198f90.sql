
CREATE OR REPLACE FUNCTION public.restrict_client_purchase_record_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean := false;
  is_coach boolean := false;
BEGIN
  -- Admins and assigned coaches may update any column.
  BEGIN
    is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  EXCEPTION WHEN OTHERS THEN
    is_admin := false;
  END;

  BEGIN
    is_coach := public.is_assigned_coach(NEW.client_id);
  EXCEPTION WHEN OTHERS THEN
    is_coach := false;
  END;

  IF is_admin OR is_coach THEN
    RETURN NEW;
  END IF;

  -- Client-initiated update: allow only terms-acceptance fields to change.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.amount_paid_cents IS DISTINCT FROM OLD.amount_paid_cents
     OR NEW.sessions_purchased IS DISTINCT FROM OLD.sessions_purchased
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id
     OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'Clients may only accept terms; other purchase fields are read-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_records_restrict_client_updates ON public.purchase_records;
CREATE TRIGGER purchase_records_restrict_client_updates
BEFORE UPDATE ON public.purchase_records
FOR EACH ROW
EXECUTE FUNCTION public.restrict_client_purchase_record_updates();
