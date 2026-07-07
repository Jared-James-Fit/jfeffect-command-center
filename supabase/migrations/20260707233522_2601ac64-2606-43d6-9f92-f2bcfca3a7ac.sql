
ALTER TABLE public.payment_ledger ADD COLUMN IF NOT EXISTS hosted_invoice_url text;
ALTER TABLE public.payment_ledger ADD COLUMN IF NOT EXISTS invoice_pdf_url text;

DROP VIEW IF EXISTS public.admin_transactions_v1;

CREATE VIEW public.admin_transactions_v1
WITH (security_invoker = true) AS
SELECT pl.id::text AS id,
     'client'::text AS source,
     pl.transaction_date AS occurred_on,
     pl.received_at AS occurred_at,
     pl.client_id AS subject_id,
     'client'::text AS subject_kind,
     c.full_name AS subject_name,
     c.email AS subject_email,
     pl.purchase_id,
     pr.offer_id,
     COALESCE(pr.offer_name, 'Payment'::text) AS product_name,
     pr.offer_type AS purchase_type,
     pl.amount_minor::numeric / 100.0 AS amount,
     pl.currency,
     pl.txn_type,
     pl.method,
     CASE
         WHEN pl.voided THEN 'Voided'::text
         WHEN pl.txn_type = ANY (ARRAY['refund'::text, 'partial_refund'::text, 'reversal'::text]) THEN 'Refunded'::text
         WHEN pl.txn_type = ANY (ARRAY['payment'::text, 'deposit'::text, 'credit_applied'::text]) THEN 'Paid'::text
         ELSE initcap(pl.txn_type)
     END AS status,
     pl.stripe_customer_id,
     pl.stripe_payment_intent_id,
     pl.stripe_charge_id,
     pl.stripe_invoice_id,
     COALESCE(pl.stripe_checkout_session_id, pr.stripe_checkout_session_id) AS stripe_checkout_session_id,
     COALESCE(pl.stripe_subscription_id, pr.stripe_subscription_id) AS stripe_subscription_id,
     pr.stripe_product_id,
     pr.stripe_price_id,
     pl.receipt_url,
     pl.hosted_invoice_url,
     pl.invoice_pdf_url,
     COALESCE(pl.stripe_mode, pr.stripe_mode) AS stripe_mode,
     pl.internal_note AS admin_notes,
     pl.voided
    FROM public.payment_ledger pl
      LEFT JOIN public.purchase_records pr ON pr.id = pl.purchase_id
      LEFT JOIN public.clients c ON c.id = pl.client_id
 UNION ALL
SELECT mpl.id::text AS id,
     'membership'::text AS source,
     mpl.payment_date::date AS occurred_on,
     mpl.payment_date AS occurred_at,
     mpl.member_id AS subject_id,
     'member'::text AS subject_kind,
     am.full_name AS subject_name,
     am.email AS subject_email,
     NULL::uuid AS purchase_id,
     NULL::uuid AS offer_id,
     COALESCE(mpl.service_product, 'Membership'::text) AS product_name,
     'membership'::text AS purchase_type,
     COALESCE(mpl.amount_cents, 0)::numeric / 100.0 AS amount,
     upper(mpl.currency) AS currency,
     'payment'::text AS txn_type,
     mpl.payment_method AS method,
     initcap(mpl.status) AS status,
     COALESCE(mpl.stripe_customer_id, am.stripe_customer_id) AS stripe_customer_id,
     mpl.stripe_payment_intent_id,
     NULL::text AS stripe_charge_id,
     mpl.stripe_invoice_id,
     mpl.stripe_checkout_session_id,
     COALESCE(mpl.stripe_subscription_id, am.stripe_subscription_id) AS stripe_subscription_id,
     NULL::text AS stripe_product_id,
     am.stripe_price_id,
     mpl.receipt_url,
     NULL::text AS hosted_invoice_url,
     NULL::text AS invoice_pdf_url,
     mpl.stripe_mode,
     mpl.manual_note AS admin_notes,
     false AS voided
    FROM public.member_payment_ledger mpl
      LEFT JOIN public.app_members am ON am.id = mpl.member_id;

GRANT SELECT ON public.admin_transactions_v1 TO authenticated;
GRANT ALL ON public.admin_transactions_v1 TO service_role;

UPDATE public.purchase_records
SET
  amount_paid_cents = 117972,
  amount_outstanding_cents = 0,
  payment_status = 'Paid',
  service_status = 'Active',
  paid_at = '2026-07-06T12:00:00+00:00',
  last_payment_update_source = 'stripe_reconciliation',
  last_payment_update_at = NOW()
WHERE id = 'eca1e938-9be7-457a-9459-66f4165e3667'
  AND client_id = (SELECT id FROM public.clients WHERE email = 'sashley7092013@gmail.com' LIMIT 1);

UPDATE public.payment_ledger
SET
  stripe_charge_id = 'ch_3Tq1RnPwmHNsdfML1SCpH6VT',
  receipt_url = 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUWTlKcVB3bUhOc2RmTUwohZi20gYyBlUUyA1iTzosFmcNLpfbk1grpRE-DEkzGC8Ys3X4rZAcB4uEo7UCVBXERd7cZt9QQFiCx20?s=ap',
  stripe_customer_id = 'cus_UpgknllxmBmgWK'
WHERE id = 'e7a11323-f2f4-4b28-9506-1c3eb041d887'
  AND source = 'stripe_checkout';
