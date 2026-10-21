-- 1) A sale with no price stored (older Stripe backfills) that has money in
--    was marked "Partially Paid" forever, while its outstanding balance was
--    already $0. What was paid is the sale: mark it Paid, so the status agrees
--    with amount_outstanding_cents.
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

-- 2) Colten Murray's sales (one client; every statement is keyed to his rows,
--    so this is a no-op anywhere else).
--
--    What happened, from the ledger and the 72-session grant note
--    ("$6,000 + 5% GST = $6,300 total", start June 22):
--    - Jun 19  $100 deposit, Stripe card (no price stored, so it read "Free")
--    - Jun 22  $1,365 = $1,300 + GST, Stripe ("Payment 1 of 2", no price stored)
--    - Jul 31  $4,935 = $4,700 + GST, e-transfer ("Payment 2 of 2")
--    - Jun 24  a $100 single session assigned 2 days into the package, never
--              paid, never reminded
--
--    After: one "6-Month Commitment" sale ($6,000 + GST, both payments, Jun 22
--    to Dec 6 = 24 weeks) on the 72 Sessions / 24 Weeks product, the deposit
--    as a paid $100 sale, and the stray single session archived (restorable).
DO $colten$
DECLARE
  v_client constant uuid := '3f833044-577a-4bb8-8af5-4812d15dce66';
  v_keep   constant uuid := '52192785-8b10-421b-a556-763982b1f3eb'; -- Payment 2 of 2
  v_merged constant uuid := '77eb7899-9ec6-472b-b17e-896099a284e4'; -- Payment 1 of 2
  v_dep    constant uuid := '8f627b39-00d9-4e67-a6c8-6fdd1f64cfc1'; -- Deposit
  v_single constant uuid := '8f285774-052e-4946-b467-e0888a774668'; -- Single Session
  v_product constant uuid := 'd1f31392-1be3-449c-90c6-40b5407cfb0e'; -- 72 Sessions / 24 Weeks
  m public.purchase_records;
BEGIN
  SELECT * INTO m FROM public.purchase_records WHERE id = v_merged AND client_id = v_client;
  IF NOT FOUND OR m.archived_at IS NOT NULL THEN
    RETURN; -- not this database, or already done
  END IF;

  -- The June 22 payment moves onto the package sale. Its checkout session is
  -- in external_reference; fill the Stripe columns it was missing.
  UPDATE public.payment_ledger
     SET purchase_id = v_keep,
         stripe_mode = COALESCE(stripe_mode, 'live'),
         stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, external_reference)
   WHERE purchase_id = v_merged AND client_id = v_client;

  -- The package: one sale, priced like the product (before GST).
  UPDATE public.purchase_records
     SET offer_name = 'Personal Training — 6-Month Commitment',
         offer_id = v_product,
         offer_type = 'Personal Training',
         contract_value_cents = 600000,
         full_payable_amount = 6000,
         short_description = '6-month personal training commitment: 72 sessions over 24 weeks (3 per week). $6,000 + 5% GST = $6,300, paid in 2 payments.',
         purchased_at = m.purchased_at,
         term_start_date = '2026-06-22',
         term_end_date = '2026-12-06',
         term_duration_text = '24 weeks',
         stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, m.stripe_checkout_session_id),
         stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, m.stripe_payment_intent_id),
         admin_notes = concat_ws(E'\n', admin_notes,
           'Oct 21, 2026: merged "Payment 1 of 2" into this sale. One 6-month package, $6,000 + GST = $6,300: $1,365 on Jun 22 (Stripe) and $4,935 on Jul 31 (e-transfer).')
   WHERE id = v_keep AND client_id = v_client;

  -- The old "Payment 1 of 2" row: its payment and Stripe ids now live on the
  -- package, so it is a duplicate. Kept (archived) for the record.
  UPDATE public.purchase_records
     SET stripe_checkout_session_id = NULL,
         stripe_payment_intent_id = NULL,
         payment_status = 'Voided',
         payment_reminders_paused = true,
         archived_at = now(),
         admin_notes = concat_ws(E'\n', admin_notes,
           'Oct 21, 2026: merged into "Personal Training — 6-Month Commitment" (' || v_keep || '). Its $1,365 payment moved there.')
   WHERE id = v_merged AND client_id = v_client;

  -- The deposit was stored without a price.
  UPDATE public.purchase_records
     SET contract_value_cents = 10000,
         full_payable_amount = 100,
         offer_type = COALESCE(offer_type, 'Personal Training')
   WHERE id = v_dep AND client_id = v_client;

  -- The unpaid single session.
  UPDATE public.purchase_records
     SET archived_at = now(),
         payment_reminders_paused = true,
         admin_notes = concat_ws(E'\n', admin_notes,
           'Oct 21, 2026: archived. Never paid and no payment on file; assigned 2 days after the 6-month package started. Restore this sale if he does owe the session.')
   WHERE id = v_single AND client_id = v_client AND amount_paid_cents = 0;
  UPDATE public.payment_share_links SET revoked = true WHERE purchase_record_id IN (v_single, v_merged);

  PERFORM public.recompute_purchase_totals(v_keep);
  PERFORM public.recompute_purchase_totals(v_merged);
  PERFORM public.recompute_purchase_totals(v_dep);

  INSERT INTO public.billing_audit_log (client_id, event_type, previous_value, new_value, reason, metadata)
  VALUES
    (v_client, 'sale_merged', jsonb_build_object('purchase_id', v_merged, 'offer_name', m.offer_name),
     jsonb_build_object('purchase_id', v_keep, 'offer_name', 'Personal Training — 6-Month Commitment', 'contract_value_cents', 600000),
     'One 6-month package was recorded as two sales', jsonb_build_object('source', 'data_cleanup')),
    (v_client, 'sale_price_set', jsonb_build_object('purchase_id', v_dep, 'contract_value_cents', null),
     jsonb_build_object('purchase_id', v_dep, 'contract_value_cents', 10000),
     'Deposit had no price stored and showed as Free', jsonb_build_object('source', 'data_cleanup')),
    (v_client, 'sale_archived', jsonb_build_object('purchase_id', v_single, 'payment_status', 'Unpaid'),
     jsonb_build_object('purchase_id', v_single, 'archived', true),
     'Unpaid single session from Jun 24 with no payment on file', jsonb_build_object('source', 'data_cleanup'));
END
$colten$;
