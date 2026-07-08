-- ============================================================
-- Migration: Fix Stripe charge IDs and receipt URLs for
--            Colten Murray and Vicky Tshibasu
--
-- Root cause: The backfill stored incorrect stripe_payment_intent_id
-- values (pi_* prefix) for charges that were actually direct Stripe
-- payments (py_* or ch_* prefix). The Stripe dashboard URL
-- /payments/pi_3TlBrr... returns "Transaction not found" because
-- the ID is a charge, not a PaymentIntent.
--
-- Fix:
--   1. Store the correct stripe_charge_id for each row
--   2. Clear the wrong stripe_payment_intent_id where it was a charge
--   3. Store the Stripe-hosted receipt URL for each payment
-- ============================================================

-- Colten Murray — $100 CAD — Jun 19 (charge: ch_3Tk7BzPwmHNsdfML2Xus0spc)
UPDATE public.payment_ledger
SET
  stripe_charge_id = 'ch_3Tk7BzPwmHNsdfML2Xus0spc',
  receipt_url = 'https://pay.stripe.com/receipts/payment/CAcQARoXChVhY2N0XzFUWTlKcVB3bUhOc2RmTUwou6S20gYyBmhvmBBTqDosFr6Lpll7K98WVOGnZEJGJV-wFMSwxqEN-WGwBWoB1Z1JwczVvi1zA6psEuc'
WHERE id = '4294591f-206c-4179-9c00-fb4ce758777e'
  AND receipt_url IS NULL;

-- Colten Murray — $1,365 CAD — Jun 22 (charge: py_3TlBrrPwmHNsdfML0vln4M89)
-- Note: py_ prefix = direct Stripe payment (not a PaymentIntent)
UPDATE public.payment_ledger
SET
  stripe_charge_id = 'py_3TlBrrPwmHNsdfML0vln4M89',
  stripe_payment_intent_id = NULL,
  receipt_url = 'https://pay.stripe.com/receipts/payment/CAcQARoXChVhY2N0XzFUWTlKcVB3bUhOc2RmTUwouqS20gYyBqy_b6kqRDosFhwGJhGZ0zlyUqsWOR-O7WFnBvdtb1y0NFAS3aDy4S_OhjExx6T70mfej6Y'
WHERE id = 'f81daf11-9c04-4516-9b58-4918c786034d'
  AND receipt_url IS NULL;

-- Vicky Tshibasu — $136.50 CAD — Jul 3 (charge: py_3TpA6EPwmHNsdfML1X5VosBM)
UPDATE public.payment_ledger
SET
  stripe_charge_id = 'py_3TpA6EPwmHNsdfML1X5VosBM',
  stripe_payment_intent_id = NULL,
  receipt_url = 'https://pay.stripe.com/receipts/invoices/CAcQARoXChVhY2N0XzFUWTlKcVB3bUhOc2RmTUwonaS20gYyBgltsT_sLTosFsEjuVuFMRrqGIvrtOLbYU5gwehabo9QR7G8DZhhVCTQ7o3B_DeJy7f1HpQ?s=ap'
WHERE id = 'bd796283-e495-4f36-8c63-24cd9ed57d0e'
  AND receipt_url IS NULL;
