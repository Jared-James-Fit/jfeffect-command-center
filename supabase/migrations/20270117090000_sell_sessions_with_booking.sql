-- Selling a session with its booking.
--
-- The coach books a 1:1 for a client who has nothing to book it on (a drop-in,
-- or someone buying one more) and charges for it in the same tap: a product
-- they already made ("Personal Training — Single Session", a 12-pack) or any
-- price they type. The session is booked straight away, paid or not; the sale
-- is an ordinary one-time sale (Unpaid until Stripe says otherwise) holding
-- its sessions from the start, like a renewal, so the booked session's credit
-- sits on it at once. Paying later never grants twice
-- (grant_sessions_if_paid_in_full counts what's already granted).
--
-- sell_booked_sessions: the sale, its hold, and the sessions it's for. The
-- sessions being sold are moved onto it first (only ones not already on a
-- package); any room left takes the client's oldest sessions past their
-- packages, as a granted package always does (apply_unbilled_sessions). A
-- retry for the same sessions returns the same sale.
--
-- pt_session_sale_id: which sale a session's credit is on (its hold while
-- booked, its use once done), for the session sheet's "Paid / Waiting".

CREATE OR REPLACE FUNCTION public.sell_booked_sessions(
  _client_id uuid,
  _session_ids uuid[],
  _offer_id uuid,
  _offer_name text,
  _sessions integer,
  _price_cents bigint,
  _currency text,
  _stripe_product_id text,
  _stripe_price_id text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_id uuid;
  v_sid uuid;
  v_first record;
  v_res public.session_ledger_events;
  v_use public.session_ledger_events;
  v_moved integer := 0;
  v_ids text[];
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin') OR public.is_assigned_coach_for_client(_client_id)) THEN
    RAISE EXCEPTION 'Only their coach can sell sessions' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(array_length(_session_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Pick the session it''s for';
  END IF;
  IF COALESCE(_sessions, 0) < 1 OR _sessions > 500 THEN
    RAISE EXCEPTION 'A sale needs between 1 and 500 sessions';
  END IF;
  IF COALESCE(_price_cents, 0) < 50 THEN
    RAISE EXCEPTION 'The price has to be at least $0.50';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(_session_ids) AS s(id)
      LEFT JOIN public.pt_sessions p ON p.id = s.id
     WHERE p.id IS NULL OR p.client_id <> _client_id
  ) THEN
    RAISE EXCEPTION 'Those sessions aren''t this client''s';
  END IF;

  v_ids := ARRAY(SELECT x::text FROM unnest(_session_ids) AS x);

  -- Already sold with these sessions (a double tap, a retry): the same sale.
  SELECT id INTO v_id
    FROM public.purchase_records
   WHERE client_id = _client_id
     AND archived_at IS NULL
     AND offer_snapshot->>'source' = 'booking'
     AND (offer_snapshot->'pt_session_ids') ?| v_ids
   ORDER BY created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  SELECT p.session_date, p.location, p.timezone,
         GREATEST(1, (EXTRACT(EPOCH FROM (p.end_time - p.start_time)) / 60)::int) AS minutes
    INTO v_first
    FROM public.pt_sessions p
   WHERE p.id = ANY (_session_ids)
   ORDER BY p.session_date, p.start_time
   LIMIT 1;

  INSERT INTO public.purchase_records (
    client_id, offer_id, offer_name, offer_type, short_description, currency,
    full_payable_amount, amount_due_today, contract_value_cents, payment_structure, payment_frequency,
    number_of_payments, is_recurring, sessions_purchased, package_tracking_enabled, session_fulfillment,
    session_length_minutes, location, timezone, term_start_date,
    payment_status, status, amount_paid, amount_paid_cents, amount_tax_paid_cents,
    amount_refunded_cents, amount_credited_cents, amount_outstanding_cents,
    stripe_product_id, stripe_price_id, purchased_at, assigned_by, assigned_at,
    offer_snapshot, admin_notes, last_payment_update_source, last_payment_update_at
  ) VALUES (
    _client_id, _offer_id, COALESCE(NULLIF(btrim(_offer_name), ''), '1:1 Training'), 'Personal Training',
    _sessions || CASE WHEN _sessions = 1 THEN ' session' ELSE ' sessions' END || ' for $'
      || to_char(_price_cents / 100.0, 'FM999,999,990.00') || ' + tax, sold with the booking.',
    upper(COALESCE(NULLIF(_currency, ''), 'CAD')),
    _price_cents / 100.0, _price_cents / 100.0, _price_cents, 'One-time payment', 'One-time',
    1, false, _sessions, true, 'first_payment',
    v_first.minutes, v_first.location, v_first.timezone, v_first.session_date,
    'Unpaid', 'Active', 0, 0, 0,
    0, 0, _price_cents,
    NULLIF(_stripe_product_id, ''), NULLIF(_stripe_price_id, ''), now(), v_uid, now(),
    jsonb_build_object('source', 'booking', 'pt_session_ids', to_jsonb(v_ids)),
    'Sold with the booking on ' || to_char(v_first.session_date, 'Mon FMDD, YYYY') || '.',
    'booking_sale', now()
  )
  RETURNING id INTO v_id;

  -- The sessions it's for go on it first (only ones no package is paying for).
  FOREACH v_sid IN ARRAY _session_ids LOOP
    EXIT WHEN v_moved >= _sessions;
    v_res := public._pt_outstanding_reservation(v_sid);
    v_use := public._pt_unreversed_use(v_sid);
    IF v_use.id IS NOT NULL AND (v_res.id IS NULL OR v_use.created_at > v_res.created_at) THEN
      IF v_use.purchase_id IS NULL AND public._move_session_event(v_use.id, v_id, 'Sold with this session') THEN
        v_moved := v_moved + 1;
      END IF;
    ELSIF v_res.id IS NOT NULL AND v_res.purchase_id IS NULL THEN
      IF public._move_session_event(v_res.id, v_id, 'Sold with this booking') THEN
        v_moved := v_moved + 1;
      END IF;
    END IF;
  END LOOP;

  -- Its sessions are held from the start; any room left takes the oldest unpaid-for ones.
  INSERT INTO public.session_ledger_events (
    client_id, purchase_id, event_type, session_count, currency, effective_date, source, note, created_by
  ) VALUES (
    _client_id, v_id, 'granted', _sessions, upper(COALESCE(NULLIF(_currency, ''), 'CAD')),
    COALESCE(v_first.session_date, public.pt_local_today('America/Winnipeg')), 'package_grant',
    'Sold with the booking: held from the start, paid by link', v_uid
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sell_booked_sessions(uuid, uuid[], uuid, text, integer, bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_booked_sessions(uuid, uuid[], uuid, text, integer, bigint, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pt_session_sale_id(_pt_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_client uuid;
  v_res public.session_ledger_events;
  v_use public.session_ledger_events;
BEGIN
  SELECT client_id INTO v_client FROM public.pt_sessions WHERE id = _pt_session_id;
  IF v_client IS NULL OR v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (
    public.has_role(v_uid, 'admin')
    OR public.is_assigned_coach_for_client(v_client)
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client AND c.user_id = v_uid)
    OR v_client = public.linked_client_id()
  ) THEN
    RETURN NULL;
  END IF;
  v_res := public._pt_outstanding_reservation(_pt_session_id);
  v_use := public._pt_unreversed_use(_pt_session_id);
  RETURN CASE
    WHEN v_use.id IS NOT NULL AND (v_res.id IS NULL OR v_use.created_at > v_res.created_at) THEN v_use.purchase_id
    ELSE v_res.purchase_id
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.pt_session_sale_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_session_sale_id(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
