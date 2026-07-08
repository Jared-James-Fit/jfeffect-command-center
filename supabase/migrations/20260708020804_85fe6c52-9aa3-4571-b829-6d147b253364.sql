-- Defensive uniqueness for Stripe identifiers on non-voided ledger rows.
-- Existing unique index on external_reference stays as-is.
-- We already audited: 0 duplicates on any of these columns.

CREATE UNIQUE INDEX IF NOT EXISTS payment_ledger_stripe_pi_unique_active
  ON public.payment_ledger(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND voided = false;

CREATE UNIQUE INDEX IF NOT EXISTS payment_ledger_stripe_charge_unique_active
  ON public.payment_ledger(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL AND voided = false;

CREATE UNIQUE INDEX IF NOT EXISTS payment_ledger_stripe_invoice_unique_active
  ON public.payment_ledger(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL AND voided = false;

COMMENT ON INDEX public.payment_ledger_stripe_pi_unique_active IS
  'Defense-in-depth: prevent duplicate ledger rows for the same Stripe PaymentIntent among active (non-voided) rows.';
COMMENT ON INDEX public.payment_ledger_stripe_charge_unique_active IS
  'Defense-in-depth: prevent duplicate ledger rows for the same Stripe Charge among active (non-voided) rows.';
COMMENT ON INDEX public.payment_ledger_stripe_invoice_unique_active IS
  'Defense-in-depth: prevent duplicate ledger rows for the same Stripe Invoice among active (non-voided) rows.';