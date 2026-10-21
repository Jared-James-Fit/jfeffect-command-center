-- One-off data sync (keyed to three clients; a no-op anywhere else). Runs
-- after 20261222090000 (Colten's package is one sale by then).
--
-- Source: the coach's session tracker Google Sheet, one tab per client, a
-- 1/0 tally per session date. Sessions marked 1 are used:
--   Colten Murray  37 (09-28 is tallied 1 though marked Incomplete; counted)
--   Nicolas Galli  39 (two sessions on 07-26)
--   Marc Asugui    42 (36 before the app, then 10-12..10-20 booked in the app)
-- And the Jun 12, 2026 "Coaching & Friend Loan Agreement" with Nicolas Galli:
-- $3,000 coaching prepayment by e-transfer (6 months, ~72 sessions). The
-- $3,000 personal loan in the same agreement is not business income and is
-- not recorded as a sale.
DO $sync$
DECLARE
  -- Colten
  c_client constant uuid := '3f833044-577a-4bb8-8af5-4812d15dce66';
  c_sale   constant uuid := '52192785-8b10-421b-a556-763982b1f3eb'; -- 6-Month Commitment
  c_grant  constant uuid := '9ade29d8-a7b2-4e7d-9279-5ca3b4d921ab'; -- 72 granted, no sale
  c_dates  constant date[] := array['2026-06-22','2026-06-25','2026-06-26','2026-06-29','2026-07-01','2026-07-03','2026-07-06','2026-07-08','2026-07-15','2026-07-17','2026-07-20','2026-07-24','2026-07-27','2026-07-29','2026-08-12','2026-08-14','2026-08-18','2026-08-21','2026-08-26','2026-08-28','2026-08-31','2026-09-02','2026-09-07','2026-09-09','2026-09-11','2026-09-18','2026-09-21','2026-09-23','2026-09-25','2026-09-28','2026-09-30','2026-10-02','2026-10-05','2026-10-07','2026-10-09','2026-10-14','2026-10-19']::date[];
  -- Nicolas
  n_client constant uuid := '4fa8963e-5afb-44bc-bcaa-2e9a4b8afa3d';
  n_product constant uuid := 'd1f31392-1be3-449c-90c6-40b5407cfb0e'; -- 72 Sessions / 24 Weeks
  n_ref    constant text := 'etransfer:nicolas-galli:2026-06-12';
  n_dates  constant date[] := array['2026-06-19','2026-06-20','2026-06-21','2026-06-26','2026-06-27','2026-06-28','2026-07-04','2026-07-05','2026-07-10','2026-07-11','2026-07-12','2026-07-24','2026-07-25','2026-07-26','2026-07-26','2026-07-31','2026-08-01','2026-08-07','2026-08-08','2026-08-09','2026-08-14','2026-08-16','2026-08-21','2026-08-22','2026-08-23','2026-08-28','2026-08-29','2026-08-30','2026-09-05','2026-09-06','2026-09-12','2026-09-13','2026-09-19','2026-09-26','2026-09-27','2026-10-03','2026-10-04','2026-10-11','2026-10-18']::date[];
  -- Marc: package 1 ($800 + tax, Aug) then package 2 ($640 + tax)
  m_client constant uuid := '89aead4b-da32-4237-9e79-1b29472125aa';
  m_pkg1   constant uuid := '4992ae66-61eb-4795-8d7b-702a11b9bb39';
  m_pkg2   constant uuid := 'a41eb0e8-bc48-4018-ac01-d34a268a90e9';
  m_dates  constant date[] := array['2026-08-10','2026-08-11','2026-08-12','2026-08-14','2026-08-17','2026-08-18','2026-08-19','2026-08-21','2026-08-24','2026-08-25','2026-08-26','2026-08-28','2026-08-31','2026-09-01','2026-09-02','2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-11','2026-09-14','2026-09-15','2026-09-16','2026-09-18','2026-09-21','2026-09-23','2026-09-25','2026-09-27','2026-09-28','2026-09-29','2026-09-30','2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08']::date[];
  m_in_app constant date[] := array['2026-10-12','2026-10-13','2026-10-14','2026-10-16','2026-10-19','2026-10-20']::date[];
  marker constant text := 'Session tracker sheet';
  n_sale uuid;
  i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = c_client) THEN
    RETURN; -- not this database
  END IF;

  ---------------------------------------------------------------- Colten
  IF EXISTS (SELECT 1 FROM public.purchase_records WHERE id = c_sale AND client_id = c_client
               AND offer_name = 'Personal Training — 6-Month Commitment')
     AND NOT EXISTS (SELECT 1 FROM public.session_ledger_events WHERE client_id = c_client AND note LIKE marker || '%') THEN
    -- His 72 were granted without a sale; move them onto the package so the
    -- package (and his portal card) carries the balance.
    INSERT INTO public.session_ledger_events (client_id, purchase_id, event_type, session_count, unit_value_minor, currency, effective_date, expires_at, source, note, related_event_id)
    SELECT c_client, NULL, 'transferred_out', -72, 8750, 'CAD', g.effective_date, g.expires_at, 'admin_adjust',
           marker || ': moved the 72 granted sessions onto the 6-Month Commitment sale', g.id
      FROM public.session_ledger_events g WHERE g.id = c_grant;
    INSERT INTO public.session_ledger_events (client_id, purchase_id, event_type, session_count, unit_value_minor, currency, effective_date, expires_at, source, note, related_event_id)
    SELECT c_client, c_sale, 'transferred_in', 72, 8750, 'CAD', g.effective_date, g.expires_at, 'admin_adjust',
           marker || ': 72 sessions for the 6-Month Commitment ($6,000 + GST)', g.id
      FROM public.session_ledger_events g WHERE g.id = c_grant;
    -- Sessions are on the sale now; 'manual' keeps the paid-in-full trigger
    -- from granting another 72.
    UPDATE public.purchase_records SET session_fulfillment = 'manual', sessions_purchased = 72
     WHERE id = c_sale;
    FOR i IN 1 .. array_length(c_dates, 1) LOOP
      INSERT INTO public.session_ledger_events (client_id, purchase_id, event_type, session_count, unit_value_minor, currency, effective_date, source, note)
      VALUES (c_client, c_sale, 'used', -1, 8750, 'CAD', c_dates[i], 'manual',
              CASE WHEN c_dates[i] = '2026-09-28'
                   THEN marker || ': used (tallied 1, marked Incomplete: had to pick up kid from daycare)'
                   ELSE marker || ': completed' END);
    END LOOP;
  END IF;

  ---------------------------------------------------------------- Nicolas
  IF NOT EXISTS (SELECT 1 FROM public.payment_ledger WHERE external_reference = n_ref) THEN
    INSERT INTO public.purchase_records (
      client_id, offer_id, offer_name, offer_type, currency, contract_value_cents, full_payable_amount,
      payment_status, payment_structure, payment_frequency, purchased_at, assigned_at,
      term_start_date, term_end_date, term_duration_text, service_status, status,
      sessions_purchased, session_fulfillment, timezone, agreement_signed_date,
      short_description, admin_notes)
    VALUES (
      n_client, n_product, 'Personal Training — 6-Month Commitment', 'Personal Training', 'CAD', 285714, 2857.14,
      'Unpaid', 'One-time payment', 'One-time payment', '2026-06-12 12:00-05', '2026-06-12 12:00-05',
      '2026-06-19', '2026-12-18', '6 months', 'Active', 'Active',
      72, 'manual', 'America/Winnipeg', '2026-06-12',
      '6 months of in-person coaching: 3 sessions per week, about 72 sessions, plus program, nutrition guidance and coach access. $3,000 prepaid by e-transfer (GST included).',
      'Coaching & Friend Loan Agreement signed Jun 12, 2026. The same agreement covers a separate $3,000 personal loan from Nicolas to Jared (no interest, flexible repayment). The loan is not business income and is not recorded as a sale.')
    RETURNING id INTO n_sale;

    INSERT INTO public.payment_ledger (client_id, purchase_id, txn_type, method, amount_minor, tax_minor, currency,
      transaction_date, received_at, external_reference, source, internal_note)
    VALUES (n_client, n_sale, 'payment', 'etransfer', 300000, 14286, 'CAD',
      '2026-06-12', '2026-06-12 12:00-05', n_ref, 'manual',
      'Coaching prepayment by e-transfer, per the Coaching & Friend Loan Agreement (Jun 12, 2026). No GST was added, so GST is treated as included (5/105 = $142.86). The $3,000 loan in the same agreement is not recorded.');

    INSERT INTO public.session_ledger_events (client_id, purchase_id, event_type, session_count, unit_value_minor, currency, effective_date, source, note)
    VALUES (n_client, n_sale, 'granted', 72, 4167, 'CAD', '2026-06-12', 'admin_adjust',
            marker || ': 72 sessions, 6-month coaching prepayment (agreement Jun 12, 2026)');
    FOR i IN 1 .. array_length(n_dates, 1) LOOP
      INSERT INTO public.session_ledger_events (client_id, purchase_id, event_type, session_count, unit_value_minor, currency, effective_date, source, note)
      VALUES (n_client, n_sale, 'used', -1, 4167, 'CAD', n_dates[i], 'manual', marker || ': completed');
    END LOOP;

    INSERT INTO public.billing_audit_log (client_id, event_type, previous_value, new_value, reason, metadata)
    VALUES (n_client, 'sale_recorded', NULL,
            jsonb_build_object('purchase_id', n_sale, 'amount_minor', 300000, 'tax_minor', 14286, 'method', 'etransfer', 'sessions', 72),
            'Coaching prepayment from the Jun 12, 2026 agreement was never recorded', jsonb_build_object('source', 'data_cleanup'));
  END IF;

  ---------------------------------------------------------------- Marc
  IF NOT EXISTS (SELECT 1 FROM public.session_ledger_events WHERE client_id = m_client AND note LIKE marker || '%') THEN
    -- Before the app: the first 16 on package 1, the rest on package 2 (it
    -- goes past its 16; that is what he has used beyond what he bought).
    FOR i IN 1 .. array_length(m_dates, 1) LOOP
      INSERT INTO public.session_ledger_events (client_id, purchase_id, event_type, session_count, unit_value_minor, currency, effective_date, source, note)
      VALUES (m_client, CASE WHEN i <= 16 THEN m_pkg1 ELSE m_pkg2 END, 'used', -1,
              CASE WHEN i <= 16 THEN 5250 ELSE 4200 END, 'CAD', m_dates[i], 'manual', marker || ': completed');
    END LOOP;
    -- Booked in the app and done (per the sheet) but never marked: complete
    -- them the normal way, which turns each held session into a used one.
    UPDATE public.pt_sessions SET status = 'Completed'
     WHERE client_id = m_client AND status = 'Scheduled' AND uses_credit
       AND session_date = ANY (m_in_app);
  END IF;
END
$sync$;
