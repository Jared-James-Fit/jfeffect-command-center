-- ============================================================
-- Migration: Backfill missing transactions for Colten Murray,
--            Vicky Tshibasu (Victor), and Ashley Santos
-- Root causes:
--   1. Colten Murray: guest checkout (no Stripe customer ID),
--      no purchase_record_id in session metadata, so webhook
--      resolvePurchase() returned null. Sessions never matched.
--   2. Vicky Tshibasu: second payment used a new Stripe customer
--      ID (cus_UonhvwTCixkNa2) different from the one stored on
--      her client record (cus_UfFUyt9ugrxxOk). syncClientStripe
--      CustomerID only updates when IS NULL, so the new customer
--      was never linked.
--   3. Ashley Santos: purchase_record existed but payment_status
--      was never updated to Paid (webhook couldn't find it via
--      metadata because it ran before our fix was deployed).
-- ============================================================

-- ─── Colten Murray ───────────────────────────────────────────
-- Client: 3f833044-577a-4bb8-8af5-4812d15dce66
-- Session 1: cs_live_b1J2hwtYnOPQVoi03v4Awg — $1365 CAD — Jun 22
-- Session 2: cs_live_b1d90dSTQTNp97OvLRVyub — $100 CAD — Jun 19

-- Create purchase_record for $1365 session (if not exists)
INSERT INTO public.purchase_records (
  client_id, offer_name, payment_status, service_status,
  amount_paid, currency, paid_at, purchased_at,
  stripe_checkout_session_id, stripe_payment_intent_id,
  last_payment_update_source, last_payment_update_at
)
SELECT
  '3f833044-577a-4bb8-8af5-4812d15dce66',
  'Personal Training — 6-Month Commitment (Payment 1 of 2)',
  'Paid', 'Active',
  1365.00, 'CAD',
  '2026-06-22T12:00:00+00:00', '2026-06-22T12:00:00+00:00',
  'cs_live_b1J2hwtYnOPQVoi03v4Awg6VAEk7xOeQdxb6VUTHL8CVBK1hvfq32nFnZx',
  'pi_3TlBrrPwmHNsdfML0vln4M89',
  'migration_backfill', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.purchase_records
  WHERE stripe_checkout_session_id = 'cs_live_b1J2hwtYnOPQVoi03v4Awg6VAEk7xOeQdxb6VUTHL8CVBK1hvfq32nFnZx'
);

-- Create purchase_record for $100 session (if not exists)
INSERT INTO public.purchase_records (
  client_id, offer_name, payment_status, service_status,
  amount_paid, currency, paid_at, purchased_at,
  stripe_checkout_session_id, stripe_payment_intent_id,
  last_payment_update_source, last_payment_update_at
)
SELECT
  '3f833044-577a-4bb8-8af5-4812d15dce66',
  'Personal Training — Deposit',
  'Paid', 'Active',
  100.00, 'CAD',
  '2026-06-19T12:00:00+00:00', '2026-06-19T12:00:00+00:00',
  'cs_live_b1d90dSTQTNp97OvLRVyubq3OKAXhLZXU9weRC13KGeiotQ9Nnf2g0RS7J',
  'pi_3Tk7BzPwmHNsdfML2Xus0spc',
  'migration_backfill', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.purchase_records
  WHERE stripe_checkout_session_id = 'cs_live_b1d90dSTQTNp97OvLRVyubq3OKAXhLZXU9weRC13KGeiotQ9Nnf2g0RS7J'
);

-- Create payment_ledger rows for Colten's sessions
INSERT INTO public.payment_ledger (
  client_id, purchase_id, txn_type, method,
  amount_minor, tax_minor, currency,
  transaction_date, received_at, external_reference,
  stripe_payment_intent_id, source, internal_note
)
SELECT
  '3f833044-577a-4bb8-8af5-4812d15dce66',
  pr.id,
  'payment', 'stripe',
  136500, 0, 'CAD',
  '2026-06-22', '2026-06-22T12:00:00+00:00',
  'cs_live_b1J2hwtYnOPQVoi03v4Awg6VAEk7xOeQdxb6VUTHL8CVBK1hvfq32nFnZx',
  'pi_3TlBrrPwmHNsdfML0vln4M89',
  'stripe_checkout',
  'Migration backfill — Colten Murray $1365 Jun 22'
FROM public.purchase_records pr
WHERE pr.stripe_checkout_session_id = 'cs_live_b1J2hwtYnOPQVoi03v4Awg6VAEk7xOeQdxb6VUTHL8CVBK1hvfq32nFnZx'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_ledger
    WHERE external_reference = 'cs_live_b1J2hwtYnOPQVoi03v4Awg6VAEk7xOeQdxb6VUTHL8CVBK1hvfq32nFnZx'
  );

INSERT INTO public.payment_ledger (
  client_id, purchase_id, txn_type, method,
  amount_minor, tax_minor, currency,
  transaction_date, received_at, external_reference,
  stripe_payment_intent_id, source, internal_note
)
SELECT
  '3f833044-577a-4bb8-8af5-4812d15dce66',
  pr.id,
  'payment', 'stripe',
  10000, 0, 'CAD',
  '2026-06-19', '2026-06-19T12:00:00+00:00',
  'cs_live_b1d90dSTQTNp97OvLRVyubq3OKAXhLZXU9weRC13KGeiotQ9Nnf2g0RS7J',
  'pi_3Tk7BzPwmHNsdfML2Xus0spc',
  'stripe_checkout',
  'Migration backfill — Colten Murray $100 Jun 19'
FROM public.purchase_records pr
WHERE pr.stripe_checkout_session_id = 'cs_live_b1d90dSTQTNp97OvLRVyubq3OKAXhLZXU9weRC13KGeiotQ9Nnf2g0RS7J'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_ledger
    WHERE external_reference = 'cs_live_b1d90dSTQTNp97OvLRVyubq3OKAXhLZXU9weRC13KGeiotQ9Nnf2g0RS7J'
  );

-- ─── Vicky Tshibasu (Victor) ─────────────────────────────────
-- Client: 98ca301f-2aa9-45df-8244-41787f08ec6d
-- Session: cs_live_b1HWTJKmj846GAURaikl3t — $136.50 CAD — Jul 3
-- New Stripe customer: cus_UonhvwTCixkNa2

-- Update client's stripe_customer_id to the new one
UPDATE public.clients
SET stripe_customer_id = 'cus_UonhvwTCixkNa2'
WHERE id = '98ca301f-2aa9-45df-8244-41787f08ec6d';

-- Update existing purchase_record to Paid
UPDATE public.purchase_records
SET
  payment_status = 'Paid',
  service_status = 'Active',
  amount_paid = 136.50,
  currency = 'CAD',
  paid_at = '2026-07-03T12:00:00+00:00',
  stripe_checkout_session_id = 'cs_live_b1HWTJKmj846GAURaikl3tCJfD4sC1c4qi9iYVTQj5VcGiAFxFmcOek0ON',
  stripe_payment_intent_id = 'py_3TpA6EPwmHNsdfML1X5VosBM',
  stripe_customer_id = 'cus_UonhvwTCixkNa2',
  last_payment_update_source = 'migration_backfill',
  last_payment_update_at = NOW()
WHERE id = '4a657e61-70e1-4052-badb-7881f66b8030';

-- Create payment_ledger row for Vicky
INSERT INTO public.payment_ledger (
  client_id, purchase_id, txn_type, method,
  amount_minor, tax_minor, currency,
  transaction_date, received_at, external_reference,
  stripe_payment_intent_id, stripe_customer_id, source, internal_note
)
SELECT
  '98ca301f-2aa9-45df-8244-41787f08ec6d',
  '4a657e61-70e1-4052-badb-7881f66b8030',
  'payment', 'stripe',
  13650, 0, 'CAD',
  '2026-07-03', '2026-07-03T12:00:00+00:00',
  'cs_live_b1HWTJKmj846GAURaikl3tCJfD4sC1c4qi9iYVTQj5VcGiAFxFmcOek0ON',
  'py_3TpA6EPwmHNsdfML1X5VosBM',
  'cus_UonhvwTCixkNa2',
  'stripe_checkout',
  'Migration backfill — Vicky Tshibasu $136.50 Jul 3'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_ledger
  WHERE external_reference = 'cs_live_b1HWTJKmj846GAURaikl3tCJfD4sC1c4qi9iYVTQj5VcGiAFxFmcOek0ON'
);

-- ─── Ashley Santos ───────────────────────────────────────────
-- PR: eca1e938-9be7-457a-9459-66f4165e3667
-- Session: cs_live_b1juSTw1BpnL5sgaaVncZ4 — $1179.72 CAD — Jul 6

UPDATE public.purchase_records
SET
  payment_status = 'Paid',
  service_status = 'Active',
  amount_paid = 1179.72,
  currency = 'CAD',
  paid_at = '2026-07-06T12:00:00+00:00',
  stripe_checkout_session_id = 'cs_live_b1juSTw1BpnL5sgaaVncZ4Ko1j7cvBjw2qPXMlN1Zbn5lv55iEJhe65XQ0',
  stripe_customer_id = 'cus_UpgknllxmBmgWK',
  stripe_payment_intent_id = 'pi_3Tq1VTPwmHNsdfML0Rl9Nkq4',
  last_payment_update_source = 'migration_backfill',
  last_payment_update_at = NOW()
WHERE id = 'eca1e938-9be7-457a-9459-66f4165e3667'
  AND payment_status != 'Paid';

-- Create payment_ledger row for Ashley
INSERT INTO public.payment_ledger (
  client_id, purchase_id, txn_type, method,
  amount_minor, tax_minor, currency,
  transaction_date, received_at, external_reference,
  stripe_payment_intent_id, stripe_customer_id, source, internal_note
)
SELECT
  pr.client_id,
  pr.id,
  'payment', 'stripe',
  117972, 5472, 'CAD',
  '2026-07-06', '2026-07-06T12:00:00+00:00',
  'cs_live_b1juSTw1BpnL5sgaaVncZ4Ko1j7cvBjw2qPXMlN1Zbn5lv55iEJhe65XQ0',
  'pi_3Tq1VTPwmHNsdfML0Rl9Nkq4',
  'cus_UpgknllxmBmgWK',
  'stripe_checkout',
  'Migration backfill — Ashley Santos $1179.72 Jul 6'
FROM public.purchase_records pr
WHERE pr.id = 'eca1e938-9be7-457a-9459-66f4165e3667'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_ledger
    WHERE external_reference = 'cs_live_b1juSTw1BpnL5sgaaVncZ4Ko1j7cvBjw2qPXMlN1Zbn5lv55iEJhe65XQ0'
  );

-- ─── Fix: Also update Colten's existing "Personal Training — Single Session" PR ─
-- That record was created manually as Unpaid. Update it to reflect the deposit.
UPDATE public.purchase_records
SET
  offer_name = 'Personal Training — Single Session',
  payment_status = 'Unpaid',
  last_payment_update_source = 'migration_backfill',
  last_payment_update_at = NOW()
WHERE id = '8f285774-052e-4946-b467-e0888a774668'
  AND client_id = '3f833044-577a-4bb8-8af5-4812d15dce66';
