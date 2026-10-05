-- Fix: Stripe payments silently not recorded since 2026-07-07.
--
-- The webhook (checkout, invoice renewals, refunds) writes ledger rows with
--   upsert(..., { onConflict: "external_reference", ignoreDuplicates: true })
-- i.e. INSERT ... ON CONFLICT (external_reference) DO NOTHING.
-- 20260707003328 made the only unique index on external_reference PARTIAL
-- (WHERE external_reference IS NOT NULL). Postgres cannot use a partial index
-- as an ON CONFLICT target without the matching predicate, so every one of
-- those writes failed with 42P10 and was only logged — renewals, checkout
-- payments and refunds never reached payment_ledger.
--
-- A plain unique index is equivalent for this column (NULLs never conflict)
-- and is a valid ON CONFLICT target, so the existing webhook code works
-- unchanged. Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS payment_ledger_external_reference_key
  ON public.payment_ledger (external_reference);
DROP INDEX IF EXISTS public.payment_ledger_external_reference_unique;
