-- What's left on a sale, compared like for like.
--
-- Prices (contract_value_cents / full_payable_amount) are stored before tax;
-- payments in payment_ledger include GST. The balance was price minus the
-- gross payments, so every taxed installment plan read the tax as money paid
-- toward the price (Marc: 2 of 4 × $160 + GST showed $304 left instead of
-- $320 + GST).
--
-- purchase_records.amount_tax_paid_cents keeps the GST inside
-- amount_paid_cents (net of refunds), so the app shows
-- price - (paid - tax). A sale paid at least its price still counts as
-- settled (older sales stored a tax-included price).
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS amount_tax_paid_cents bigint NOT NULL DEFAULT 0;

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
  v_tax bigint;
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
         COALESCE(SUM(CASE WHEN txn_type IN ('payment','deposit') AND NOT voided THEN COALESCE(tax_minor, 0) ELSE 0 END), 0),
         COUNT(*)
    INTO v_paid, v_refunded, v_credited, v_tax, v_rows
  FROM public.payment_ledger
  WHERE purchase_id = _purchase_id;

  -- The tax still held: refunds give back their share of it.
  v_tax := CASE WHEN v_paid > 0
                THEN ROUND(v_tax::numeric * GREATEST(v_paid - v_refunded, 0) / v_paid)::bigint
                ELSE 0 END;

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
    WHEN v_contract = 0 AND v_net > 0 THEN 'Paid'
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
      amount_tax_paid_cents = v_tax,
      amount_outstanding_cents = CASE
        WHEN v_contract > 0 AND v_net >= v_contract THEN 0
        ELSE GREATEST(v_contract - (v_net - v_tax), 0)
      END,
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

-- Backfill the two figures only (statuses untouched). On the Oct 21, 2026
-- data this changes Marc Asugui's two packages and nothing else.
WITH t AS (
  SELECT p.id,
         COALESCE(NULLIF(p.contract_value_cents, 0), ROUND(COALESCE(p.full_payable_amount, 0)::numeric * 100)::bigint, 0) AS contract,
         COALESCE(SUM(l.amount_minor) FILTER (WHERE l.txn_type IN ('payment','deposit') AND NOT l.voided), 0) AS paid,
         COALESCE(SUM(l.amount_minor) FILTER (WHERE l.txn_type IN ('refund','partial_refund') AND NOT l.voided), 0) AS refunded,
         COALESCE(SUM(l.amount_minor) FILTER (WHERE l.txn_type = 'credit_applied' AND NOT l.voided), 0) AS credited,
         COALESCE(SUM(COALESCE(l.tax_minor, 0)) FILTER (WHERE l.txn_type IN ('payment','deposit') AND NOT l.voided), 0) AS tax
    FROM public.purchase_records p
    JOIN public.payment_ledger l ON l.purchase_id = p.id
   GROUP BY p.id
), n AS (
  SELECT id, contract, paid + credited - refunded AS net,
         CASE WHEN paid > 0 THEN ROUND(tax::numeric * GREATEST(paid - refunded, 0) / paid)::bigint ELSE 0 END AS tax_eff
    FROM t
)
UPDATE public.purchase_records p
   SET amount_tax_paid_cents = n.tax_eff,
       amount_outstanding_cents = CASE WHEN n.contract > 0 AND n.net >= n.contract THEN 0
                                       ELSE GREATEST(n.contract - (n.net - n.tax_eff), 0) END
  FROM n
 WHERE p.id = n.id
   AND (p.amount_tax_paid_cents IS DISTINCT FROM n.tax_eff
        OR p.amount_outstanding_cents IS DISTINCT FROM
           CASE WHEN n.contract > 0 AND n.net >= n.contract THEN 0
                ELSE GREATEST(n.contract - (n.net - n.tax_eff), 0) END);

-- Marc Asugui's first package: $800 + GST for 16 sessions (4 a week), paid in
-- 3 payments ($210 Aug 22 and $210 Sep 5 on the subscription, then $420 on
-- Sep 13 by its own checkout). It was split into a "Cancelled" subscription
-- showing $380 owing and a separate "16 Sessions (Final Payment)" sale.
DO $marc$
DECLARE
  v_client constant uuid := '89aead4b-da32-4237-9e79-1b29472125aa';
  v_pkg1   constant uuid := '4992ae66-61eb-4795-8d7b-702a11b9bb39';
  v_final  constant uuid := 'ae073ccf-a714-41c1-9dae-b4c631d276dd';
  f public.purchase_records;
BEGIN
  SELECT * INTO f FROM public.purchase_records WHERE id = v_final AND client_id = v_client;
  IF NOT FOUND OR f.archived_at IS NOT NULL THEN
    RETURN; -- not this database, or already done
  END IF;

  UPDATE public.payment_ledger SET purchase_id = v_pkg1
   WHERE purchase_id = v_final AND client_id = v_client;

  UPDATE public.purchase_records
     SET payment_status = 'Paid',
         service_status = 'Active',
         is_recurring = false,
         next_billing_date = NULL,
         cancel_at_period_end = false,
         paid_at = '2026-09-13 12:00-05',
         term_start_date = '2026-08-10',
         term_end_date = '2026-09-06',
         term_duration_text = '4 weeks',
         short_description = '$800 + GST for 16 sessions (4 a week), paid in 3 payments: $210 on Aug 22, $210 on Sep 5, $420 on Sep 13.',
         admin_notes = concat_ws(E'\n', admin_notes,
           'Oct 21, 2026: the Sep 13 $420 final payment moved here from "16 Sessions (Final Payment)". Paid in full in 3 payments; the subscription was cancelled after payment 2 because the rest was paid at once.')
   WHERE id = v_pkg1 AND client_id = v_client;

  UPDATE public.purchase_records
     SET payment_status = 'Voided',
         archived_at = now(),
         payment_reminders_paused = true,
         admin_notes = concat_ws(E'\n', admin_notes,
           'Oct 21, 2026: merged into "Personal Training — 16 Sessions / 4 Weeks" (' || v_pkg1 || '). Its $420 payment moved there.')
   WHERE id = v_final AND client_id = v_client;
  UPDATE public.payment_share_links SET revoked = true WHERE purchase_record_id = v_final;

  PERFORM public.recompute_purchase_totals(v_pkg1);
  PERFORM public.recompute_purchase_totals(v_final);

  INSERT INTO public.billing_audit_log (client_id, event_type, previous_value, new_value, reason, metadata)
  VALUES (v_client, 'sale_merged',
          jsonb_build_object('purchase_id', v_final, 'offer_name', f.offer_name, 'pkg1_status', 'Cancelled'),
          jsonb_build_object('purchase_id', v_pkg1, 'payment_status', 'Paid', 'contract_value_cents', 80000),
          'Package 1 was paid in full in 3 payments but split into a cancelled subscription and a separate final-payment sale',
          jsonb_build_object('source', 'data_cleanup'));
END
$marc$;
