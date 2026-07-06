-- Add Stripe deep-link fields to purchase_records
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS stripe_mode text;

CREATE INDEX IF NOT EXISTS purchase_records_stripe_customer_idx
  ON public.purchase_records (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_records_stripe_subscription_idx
  ON public.purchase_records (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Add Stripe deep-link fields to payment_ledger
ALTER TABLE public.payment_ledger
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS stripe_mode text;

CREATE INDEX IF NOT EXISTS payment_ledger_stripe_customer_idx
  ON public.payment_ledger (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_ledger_stripe_subscription_idx
  ON public.payment_ledger (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Add Stripe deep-link fields to member_payment_ledger
ALTER TABLE public.member_payment_ledger
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS stripe_mode text;

CREATE INDEX IF NOT EXISTS member_payment_ledger_stripe_customer_idx
  ON public.member_payment_ledger (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS member_payment_ledger_stripe_subscription_idx
  ON public.member_payment_ledger (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Best-effort backfill of stripe_mode from ID prefixes (test IDs start with sk_test/pi_ etc; live otherwise)
-- We can't tell live vs test from pi_* alone; leave NULL when unknown and the UI will fall back to 'live'.

-- Unified admin transactions view (client ledger + membership ledger)
CREATE OR REPLACE VIEW public.admin_transactions_v1
WITH (security_invoker = true) AS
SELECT
  pl.id::text                                AS id,
  'client'::text                             AS source,
  pl.transaction_date                        AS occurred_on,
  pl.received_at                             AS occurred_at,
  pl.client_id                               AS subject_id,
  'client'::text                             AS subject_kind,
  c.full_name                                AS subject_name,
  c.email                                    AS subject_email,
  pl.purchase_id                             AS purchase_id,
  pr.offer_id                                AS offer_id,
  COALESCE(pr.offer_name, 'Payment')         AS product_name,
  pr.offer_type                              AS purchase_type,
  (pl.amount_minor::numeric / 100.0)         AS amount,
  pl.currency                                AS currency,
  pl.txn_type                                AS txn_type,
  pl.method                                  AS method,
  CASE
    WHEN pl.voided THEN 'Voided'
    WHEN pl.txn_type IN ('refund','partial_refund','reversal') THEN 'Refunded'
    WHEN pl.txn_type IN ('payment','deposit','credit_applied') THEN 'Paid'
    ELSE initcap(pl.txn_type)
  END                                        AS status,
  pl.stripe_customer_id                      AS stripe_customer_id,
  pl.stripe_payment_intent_id                AS stripe_payment_intent_id,
  pl.stripe_charge_id                        AS stripe_charge_id,
  pl.stripe_invoice_id                       AS stripe_invoice_id,
  COALESCE(pl.stripe_checkout_session_id, pr.stripe_checkout_session_id) AS stripe_checkout_session_id,
  COALESCE(pl.stripe_subscription_id, pr.stripe_subscription_id)         AS stripe_subscription_id,
  pr.stripe_product_id                       AS stripe_product_id,
  pr.stripe_price_id                         AS stripe_price_id,
  pl.receipt_url                             AS receipt_url,
  COALESCE(pl.stripe_mode, pr.stripe_mode)   AS stripe_mode,
  pl.internal_note                           AS admin_notes,
  pl.voided                                  AS voided
FROM public.payment_ledger pl
LEFT JOIN public.purchase_records pr ON pr.id = pl.purchase_id
LEFT JOIN public.clients c ON c.id = pl.client_id

UNION ALL

SELECT
  mpl.id::text                               AS id,
  'membership'::text                         AS source,
  mpl.payment_date::date                     AS occurred_on,
  mpl.payment_date                           AS occurred_at,
  mpl.member_id                              AS subject_id,
  'member'::text                             AS subject_kind,
  am.full_name                               AS subject_name,
  am.email                                   AS subject_email,
  NULL::uuid                                 AS purchase_id,
  NULL::uuid                                 AS offer_id,
  COALESCE(mpl.service_product, 'Membership') AS product_name,
  'membership'::text                         AS purchase_type,
  (COALESCE(mpl.amount_cents,0)::numeric / 100.0) AS amount,
  UPPER(mpl.currency)                        AS currency,
  'payment'::text                            AS txn_type,
  mpl.payment_method                         AS method,
  initcap(mpl.status)                        AS status,
  COALESCE(mpl.stripe_customer_id, am.stripe_customer_id) AS stripe_customer_id,
  mpl.stripe_payment_intent_id               AS stripe_payment_intent_id,
  NULL::text                                 AS stripe_charge_id,
  mpl.stripe_invoice_id                      AS stripe_invoice_id,
  mpl.stripe_checkout_session_id             AS stripe_checkout_session_id,
  COALESCE(mpl.stripe_subscription_id, am.stripe_subscription_id) AS stripe_subscription_id,
  NULL::text                                 AS stripe_product_id,
  am.stripe_price_id                         AS stripe_price_id,
  mpl.receipt_url                            AS receipt_url,
  mpl.stripe_mode                            AS stripe_mode,
  mpl.manual_note                            AS admin_notes,
  false                                      AS voided
FROM public.member_payment_ledger mpl
LEFT JOIN public.app_members am ON am.id = mpl.member_id;

GRANT SELECT ON public.admin_transactions_v1 TO authenticated;
GRANT SELECT ON public.admin_transactions_v1 TO service_role;

COMMENT ON VIEW public.admin_transactions_v1 IS
  'Unified read-only stream of every payment/refund across client purchase ledger and membership ledger. security_invoker=true means RLS on base tables applies to the caller.';