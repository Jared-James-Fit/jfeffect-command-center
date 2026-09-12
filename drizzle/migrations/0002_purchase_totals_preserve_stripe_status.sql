-- Ledger recompute must not clobber Stripe-owned payment status.
-- 1. Subscription-backed purchases: the Stripe webhook owns payment_status
--    (Active Subscription / Overdue / Paused / Cancelled). The ledger only
--    maintains money totals for them.
-- 2. Terminal states (Cancelled, Refunded) are never regressed by a recompute.
-- 3. Purchases with no ledger rows at all keep their existing status, so a
--    legitimate manual "Mark Paid" is not reset to Unpaid.
CREATE OR REPLACE FUNCTION public.recompute_purchase_totals(_purchase_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paid bigint;
  v_refunded bigint;
  v_credited bigint;
  v_credited_rows int;
  v_rows int;
  v_contract bigint;
  v_status text;
  v_net bigint;
  v_existing text;
  v_sub_id text;
  v_stripe_owned boolean;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN txn_type IN ('payment','deposit') AND NOT voided THEN amount_minor ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN txn_type IN ('refund','partial_refund') AND NOT voided THEN amount_minor ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN txn_type = 'credit_applied' AND NOT voided THEN amount_minor ELSE 0 END), 0),
         COUNT(*)
    INTO v_paid, v_refunded, v_credited, v_rows
  FROM public.payment_ledger
  WHERE purchase_id = _purchase_id;

  SELECT COALESCE(
           NULLIF(contract_value_cents, 0),
           ROUND(COALESCE(full_payable_amount, 0)::numeric * 100)::bigint,
           0
         ),
         payment_status,
         stripe_subscription_id
    INTO v_contract, v_existing, v_sub_id
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

  -- Stripe-owned status: recurring purchases, terminal states, or no ledger rows.
  v_stripe_owned :=
    v_sub_id IS NOT NULL
    OR COALESCE(v_existing, '') IN ('Cancelled', 'Refunded')
    OR v_rows = 0;

  IF v_stripe_owned THEN
    v_status := COALESCE(v_existing, v_status);
  END IF;

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
        WHEN v_status <> 'Paid' AND NOT v_stripe_owned THEN NULL
        ELSE paid_at
      END,
      last_payment_update_source = CASE WHEN v_stripe_owned THEN COALESCE(last_payment_update_source, 'ledger') ELSE 'ledger' END,
      last_payment_update_at = now(),
      updated_at = now()
  WHERE id = _purchase_id;
END;
$function$;

-- Stripe objects we could not confidently match to a JF Effect sale.
-- Flagged for admin reconciliation instead of being guessed.
CREATE TABLE IF NOT EXISTS public.stripe_unlinked_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  reason text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_invoice_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount_minor bigint,
  currency text,
  customer_email text,
  candidate_purchase_ids uuid[] DEFAULT '{}',
  resolved_at timestamptz,
  resolved_purchase_id uuid,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.stripe_unlinked_events TO authenticated;
GRANT ALL ON public.stripe_unlinked_events TO service_role;

ALTER TABLE public.stripe_unlinked_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read unlinked stripe events"
ON public.stripe_unlinked_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS stripe_unlinked_events_open_idx
  ON public.stripe_unlinked_events (created_at DESC)
  WHERE resolved_at IS NULL;