-- Every session package gets a permanent identity: its number within the
-- client's account and the package it renewed.
--
--  * purchase_records.package_number: 1, 2, 3… per client, in the order the
--    packages run (term start, then when bought). Given once, never changed:
--    a new package takes the next number (package_number_assign), so a
--    package keeps its number whatever is sold or archived around it.
--  * purchase_records.renewed_from_id: the package a renewal followed on
--    from. renew_session_package sets it; existing renewals are linked from
--    the record they already carry ("Renewal of the package bought Oct 22,
--    2026"), never guessed.
--
-- Only these two new columns are written. No money, status, session or date
-- changes. Rollback: DROP the trigger, the index and the two columns, and
-- re-run renew_session_package from 20270314100000_billing_safeguards.sql.

ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS package_number integer,
  ADD COLUMN IF NOT EXISTS renewed_from_id uuid REFERENCES public.purchase_records(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.purchase_records.package_number IS
  'A session package''s number within its client''s account (1, 2, 3…), given once in running order and never changed.';
COMMENT ON COLUMN public.purchase_records.renewed_from_id IS
  'The package this renewal followed on from (renew_session_package).';

-- Number every existing session package in the order it runs.
WITH ordered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY client_id
           ORDER BY COALESCE(term_start_date, (purchased_at AT TIME ZONE 'UTC')::date, (created_at AT TIME ZONE 'UTC')::date),
                    purchased_at NULLS LAST, created_at, id
         ) AS n
    FROM public.purchase_records
   WHERE COALESCE(sessions_purchased, 0) > 0
)
UPDATE public.purchase_records p
   SET package_number = o.n
  FROM ordered o
 WHERE p.id = o.id
   AND p.package_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_records_client_package_number
  ON public.purchase_records (client_id, package_number)
  WHERE package_number IS NOT NULL;

-- Link existing renewals to the package their own record names
-- ("Renewal of the package bought Mon DD, YYYY", written by
-- renew_session_package with to_char(purchased_at)); only when exactly one
-- of the client's packages was bought that day.
WITH named AS (
  SELECT r.id,
         r.client_id,
         to_date(substring(r.admin_notes FROM 'Renewal of the package bought ([A-Z][a-z]{2} [0-9]{1,2}, [0-9]{4})'), 'Mon DD, YYYY') AS bought_on
    FROM public.purchase_records r
   WHERE r.renewed_from_id IS NULL
     AND COALESCE(r.sessions_purchased, 0) > 0
     AND r.admin_notes LIKE 'Renewal of the package bought %'
), matched AS (
  SELECT n.id, min(x.id::text)::uuid AS from_id, count(*) AS hits
    FROM named n
    JOIN public.purchase_records x
      ON x.client_id = n.client_id
     AND x.id <> n.id
     AND COALESCE(x.sessions_purchased, 0) > 0
     AND (x.purchased_at AT TIME ZONE 'UTC')::date = n.bought_on
   GROUP BY n.id
)
UPDATE public.purchase_records p
   SET renewed_from_id = m.from_id
  FROM matched m
 WHERE p.id = m.id
   AND m.hits = 1;

-- A new session package takes the client's next number, once.
CREATE OR REPLACE FUNCTION public.package_number_assign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.package_number IS NOT NULL OR COALESCE(NEW.sessions_purchased, 0) <= 0 OR NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- One at a time per client, so two sales at once never share a number.
  PERFORM pg_advisory_xact_lock(hashtext('package_number:' || NEW.client_id::text));
  SELECT COALESCE(max(package_number), 0) + 1
    INTO NEW.package_number
    FROM public.purchase_records
   WHERE client_id = NEW.client_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS purchase_records_package_number ON public.purchase_records;
CREATE TRIGGER purchase_records_package_number
  BEFORE INSERT OR UPDATE OF sessions_purchased ON public.purchase_records
  FOR EACH ROW EXECUTE FUNCTION public.package_number_assign();

-- Renewing links the new package to the one it follows (the client's latest),
-- everything else as in 20270314100000_billing_safeguards.sql.
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
  v_last_end date;
  v_prev uuid;
  v_taxed boolean;
  v_desc text;
  v_untouched text;
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

  -- One untouched package at a time: nothing trained, booked or paid on it.
  SELECT COALESCE(x.offer_name, 'a package') INTO v_untouched
    FROM public.purchase_records x
    LEFT JOIN public._session_balance_rows(p.client_id) b ON b.purchase_id = x.id
   WHERE x.client_id = p.client_id
     AND x.archived_at IS NULL
     AND COALESCE(x.sessions_purchased, 0) > 0
     AND COALESCE(x.amount_paid_cents, 0) = 0
     AND COALESCE(x.payment_status, '') IN ('', 'Unpaid', 'Pending', 'Pending Payment', 'Payment Link Sent')
     AND COALESCE(b.used, 0) = 0
     AND COALESCE(b.reserved, 0) = 0
   LIMIT 1;
  IF v_untouched IS NOT NULL THEN
    RAISE EXCEPTION 'This client already has an untouched package (%): nothing trained, booked or paid on it yet. Book onto it before renewing again.', v_untouched
      USING ERRCODE = 'P0001';
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

  -- The package it follows on from: the client's latest.
  SELECT x.id INTO v_prev
    FROM public.purchase_records x
   WHERE x.client_id = p.client_id
     AND x.archived_at IS NULL
     AND COALESCE(x.sessions_purchased, 0) > 0
   ORDER BY COALESCE(x.term_start_date, (x.purchased_at AT TIME ZONE 'UTC')::date) DESC NULLS LAST,
            x.purchased_at DESC NULLS LAST, x.created_at DESC
   LIMIT 1;
  SELECT max(x.term_end_date) INTO v_last_end
    FROM public.purchase_records x
   WHERE x.client_id = p.client_id
     AND x.archived_at IS NULL
     AND COALESCE(x.sessions_purchased, 0) > 0;

  -- It starts the day after the latest package ends and runs as long as the one it copies.
  IF COALESCE(v_last_end, p.term_end_date) IS NOT NULL THEN
    v_start := GREATEST(p.term_end_date, v_last_end) + 1;
    v_end := v_start + COALESCE(p.term_end_date - p.term_start_date, 27);
  END IF;

  -- Priced before tax whenever the business charges it (or this client has ever paid tax).
  v_taxed := public.business_charges_tax()
    OR EXISTS (SELECT 1 FROM public.purchase_records x
                WHERE x.client_id = p.client_id AND COALESCE(x.amount_tax_paid_cents, 0) > 0);
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
    agreement_block_override, agreement_block_override_reason, admin_notes, renewed_from_id
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
      || ': the client kept training past its ' || p.sessions_purchased || ' sessions.',
    v_prev
  )
  RETURNING id INTO v_id;

  -- Hold its sessions now; the trigger moves the ones already trained or booked onto it.
  INSERT INTO public.session_ledger_events (
    client_id, purchase_id, event_type, session_count, currency, effective_date, expires_at, source, note, created_by
  ) VALUES (
    p.client_id, v_id, 'granted', p.sessions_purchased, COALESCE(p.currency, 'CAD'),
    COALESCE(v_start, public.pt_local_today('America/Winnipeg')), NULL, 'package_grant',
    'Renewal: sessions held from the start, paid as it goes', (SELECT auth.uid())
  );

  RETURN v_id;
END;
$function$;
