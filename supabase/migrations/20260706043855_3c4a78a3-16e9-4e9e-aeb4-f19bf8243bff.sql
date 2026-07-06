-- 1) Fix stale trigger referencing removed columns.
CREATE OR REPLACE FUNCTION public.restrict_client_purchase_record_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean := false;
  is_coach boolean := false;
BEGIN
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

  -- Admins, assigned coaches, and internal (SECURITY DEFINER / service role
  -- with no auth.uid()) callers may update any column. Triggers that run
  -- inside the DB — like recompute_purchase_totals — have no auth.uid() and
  -- must not be blocked by this restriction.
  IF is_admin OR is_coach OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.amount_paid_cents IS DISTINCT FROM OLD.amount_paid_cents
     OR NEW.sessions_purchased IS DISTINCT FROM OLD.sessions_purchased
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.stripe_product_id IS DISTINCT FROM OLD.stripe_product_id
     OR NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id
     OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    RAISE EXCEPTION 'Clients may only accept terms; other purchase fields are read-only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Fix recompute: fall back to full_payable_amount * 100, set paid_at.
CREATE OR REPLACE FUNCTION public.recompute_purchase_totals(_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid bigint;
  v_refunded bigint;
  v_credited bigint;
  v_contract bigint;
  v_status text;
  v_net bigint;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN txn_type IN ('payment','deposit') AND NOT voided THEN amount_minor ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN txn_type IN ('refund','partial_refund') AND NOT voided THEN amount_minor ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN txn_type = 'credit_applied' AND NOT voided THEN amount_minor ELSE 0 END), 0)
    INTO v_paid, v_refunded, v_credited
  FROM public.payment_ledger
  WHERE purchase_id = _purchase_id;

  SELECT COALESCE(
           NULLIF(contract_value_cents, 0),
           ROUND(COALESCE(full_payable_amount, 0)::numeric * 100)::bigint,
           0
         )
    INTO v_contract
  FROM public.purchase_records
  WHERE id = _purchase_id;

  v_contract := COALESCE(v_contract, 0);
  v_net := v_paid + v_credited - v_refunded;

  v_status := CASE
    WHEN v_net >= v_contract AND v_contract > 0 THEN 'Paid'
    WHEN v_net > 0 THEN 'Partially Paid'
    WHEN v_refunded > 0 THEN 'Refunded'
    ELSE 'Unpaid'
  END;

  UPDATE public.purchase_records
  SET amount_paid_cents = v_paid,
      amount_refunded_cents = v_refunded,
      amount_credited_cents = v_credited,
      amount_outstanding_cents = GREATEST(v_contract - v_net, 0),
      amount_paid = ROUND(v_paid::numeric / 100.0, 2),
      payment_status = v_status,
      paid_at = CASE
        WHEN v_status = 'Paid' AND paid_at IS NULL THEN (
          SELECT MAX(COALESCE(transaction_date::timestamptz, received_at, created_at))
          FROM public.payment_ledger
          WHERE purchase_id = _purchase_id
            AND NOT voided
            AND txn_type IN ('payment','deposit')
        )
        WHEN v_status <> 'Paid' THEN NULL
        ELSE paid_at
      END,
      last_payment_update_source = 'ledger',
      last_payment_update_at = now(),
      updated_at = now()
  WHERE id = _purchase_id;
END;
$$;

-- 3) Backfill contract_value_cents from full_payable_amount where missing.
UPDATE public.purchase_records
SET contract_value_cents = ROUND(full_payable_amount::numeric * 100)::bigint
WHERE (contract_value_cents IS NULL OR contract_value_cents = 0)
  AND full_payable_amount IS NOT NULL
  AND full_payable_amount > 0;

-- 4) Re-run recompute on every purchase.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.purchase_records LOOP
    PERFORM public.recompute_purchase_totals(r.id);
  END LOOP;
END $$;