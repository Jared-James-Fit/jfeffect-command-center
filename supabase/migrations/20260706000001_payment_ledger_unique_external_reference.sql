-- ============================================================
-- Migration: payment_ledger — add UNIQUE constraint on external_reference
--            and add stripe_subscription_id column
-- Purpose:
--   The webhook upserts use onConflict:"external_reference" for idempotency.
--   Without a UNIQUE index this silently falls back to INSERT, creating
--   duplicate rows on Stripe webhook retries.
--   Also adds stripe_subscription_id for subscription renewal tracking.
-- ============================================================

-- Add stripe_subscription_id column if not already present
ALTER TABLE public.payment_ledger
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE INDEX IF NOT EXISTS payment_ledger_stripe_subscription_idx
  ON public.payment_ledger(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Add UNIQUE constraint on external_reference (Stripe session/invoice ID)
-- NULL values are excluded so manual payments with no external_reference
-- can coexist without violating uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS payment_ledger_external_reference_unique
  ON public.payment_ledger(external_reference)
  WHERE external_reference IS NOT NULL;

-- Comment
COMMENT ON COLUMN public.payment_ledger.external_reference IS
  'Stripe checkout session ID (cs_…) or invoice ID (in_…). UNIQUE (non-null) — '
  'used as the conflict target for idempotent webhook upserts.';

COMMENT ON COLUMN public.payment_ledger.stripe_subscription_id IS
  'Stripe subscription ID (sub_…) for recurring payments. Indexed for lookup.';
