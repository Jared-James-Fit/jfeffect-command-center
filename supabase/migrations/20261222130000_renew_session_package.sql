-- A session package renews in its own size. Training past a package means
-- the client is on their next one (Marc: another 16 for $640 + tax), never a
-- per-session tab. renew_session_package copies the package the client was
-- on into a new sale (same name, price, sessions and payment plan, dates
-- following on) and holds its sessions at once, because the client is already
-- training on it; the sle_apply_unbilled trigger then moves the sessions
-- trained or booked past the old package onto it. Paying for it later never
-- grants twice (grant_sessions_if_paid_in_full counts what's already granted).

CREATE OR REPLACE FUNCTION public.renew_session_package(_purchase_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p public.purchase_records;
  v_id uuid;
  v_price bigint;
  v_start date;
  v_end date;
  v_taxed boolean;
  v_desc text;
BEGIN
  IF NOT (SELECT public.has_role((SELECT auth.uid()), 'admin')) THEN
    RAISE EXCEPTION 'Only an admin can renew a package' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.purchase_records WHERE id = _purchase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF COALESCE(p.sessions_purchased, 0) <= 0 THEN
    RAISE EXCEPTION 'Only a session package can be renewed';
  END IF;

  -- The package's whole price, before tax (a plan's is installment x count).
  v_price := COALESCE(
    NULLIF(p.contract_value_cents, 0),
    CASE WHEN COALESCE(p.number_of_payments, 0) > 1 AND COALESCE(p.installment_amount, 0) > 0
         THEN ROUND(p.installment_amount * p.number_of_payments * 100)::bigint END,
    ROUND(COALESCE(p.full_payable_amount, 0) * 100)::bigint
  );
  IF COALESCE(v_price, 0) <= 0 THEN
    RAISE EXCEPTION 'This package has no price to renew at';
  END IF;

  -- It starts the day after the old one ends and runs as long.
  IF p.term_end_date IS NOT NULL THEN
    v_start := p.term_end_date + 1;
    v_end := v_start + COALESCE(p.term_end_date - p.term_start_date, 27);
  END IF;

  v_taxed := COALESCE(p.amount_tax_paid_cents, 0) > 0;
  v_desc := 'Renewal: ' || p.sessions_purchased || ' sessions for $'
    || to_char(v_price / 100.0, 'FM999,999,990.00') || CASE WHEN v_taxed THEN ' + tax' ELSE '' END
    || CASE WHEN COALESCE(p.number_of_payments, 0) > 1
            THEN ', paid in ' || p.number_of_payments || ' payments of $'
                 || to_char(v_price / 100.0 / p.number_of_payments, 'FM999,999,990.00')
                 || CASE WHEN v_taxed THEN ' + tax' ELSE '' END
            ELSE '' END
    || '.';

  INSERT INTO public.purchase_records (
    client_id, offer_id, offer_version, offer_name, offer_type, short_description, full_description,
    currency, full_payable_amount, contract_value_cents, payment_structure, payment_frequency,
    number_of_payments, installment_amount, term_start_date, term_end_date, term_duration_text,
    is_recurring, is_fixed_term_commitment, included_features, excluded_features,
    cancellation_policy, refund_policy, in_person_policy, purchase_disclaimer, location,
    session_length_minutes, sessions_purchased, package_tracking_enabled, session_fulfillment,
    payment_status, status, amount_paid, amount_paid_cents, amount_tax_paid_cents,
    amount_refunded_cents, amount_credited_cents, amount_outstanding_cents,
    purchased_at, assigned_by, assigned_at, timezone, show_value_to_client,
    agreement_block_override, agreement_block_override_reason, admin_notes
  ) VALUES (
    p.client_id, p.offer_id, p.offer_version, p.offer_name, p.offer_type, v_desc, p.full_description,
    COALESCE(p.currency, 'CAD'), v_price / 100.0, v_price, p.payment_structure, p.payment_frequency,
    p.number_of_payments, p.installment_amount, v_start, v_end, p.term_duration_text,
    false, p.is_fixed_term_commitment, p.included_features, p.excluded_features,
    p.cancellation_policy, p.refund_policy, p.in_person_policy, p.purchase_disclaimer, p.location,
    p.session_length_minutes, p.sessions_purchased, true, p.session_fulfillment,
    'Unpaid', 'Active', 0, 0, 0,
    0, 0, v_price,
    now(), (SELECT auth.uid()), now(), p.timezone, p.show_value_to_client,
    COALESCE(p.agreement_block_override, false), p.agreement_block_override_reason,
    'Renewal of the package bought ' || to_char(p.purchased_at, 'Mon FMDD, YYYY')
      || ': the client kept training past its ' || p.sessions_purchased || ' sessions.'
  )
  RETURNING id INTO v_id;

  -- Hold its sessions now; the trigger moves the ones already trained or booked onto it.
  INSERT INTO public.session_ledger_events (
    client_id, purchase_id, event_type, session_count, currency, effective_date, expires_at, source, note, created_by
  ) VALUES (
    p.client_id, v_id, 'granted', p.sessions_purchased, COALESCE(p.currency, 'CAD'),
    COALESCE(v_start, (now() AT TIME ZONE 'America/Winnipeg')::date), NULL, 'package_grant',
    'Renewal: sessions held from the start, paid as it goes', (SELECT auth.uid())
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_session_package(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_session_package(uuid) TO authenticated;
