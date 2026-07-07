-- ============================================================
-- Migration: Void Ashley Santos' duplicate payment_ledger row
-- Root cause: The Phase 1 backfill migration inserted a $1,200
-- manual row on 2026-07-05 (source='manual'). Later, the correct
-- Stripe payment of $1,179.72 was backfilled on 2026-07-06
-- (source='stripe_checkout'). The manual row is a duplicate and
-- must be voided so the billing tab shows only one payment.
-- ============================================================

UPDATE public.payment_ledger
SET
  voided = true,
  void_reason = 'Duplicate manual backfill entry — real Stripe payment of $1,179.72 recorded on 2026-07-06 (source=stripe_checkout)'
WHERE id = '2c0f1d52-8264-4e8f-8072-cb1a45fe5be1'
  AND source = 'manual'
  AND amount_minor = 120000
  AND voided = false;
