-- Stripe sync hardening (Nov 26 2026), from an audit of the webhook and the daily sync.
--
-- 1. Refunds reach the ledger. A refund row carries the original payment's payment intent,
--    charge and event, and the unique indexes on those had no txn_type filter, so every refund
--    insert hit a unique violation that was logged and swallowed: the sale read "Refunded" while
--    the ledger, the books and Billing still counted the money. (No refund had happened yet:
--    production holds 38 ledger rows, all payments.) The indexes now hold payments only; a
--    refund is unique by its own Stripe refund id (external_reference), as before.
-- 2. The webhook's dedupe claim is a lease, not a tombstone. A worker cut off mid-handler left
--    its claim, so Stripe's retry read as a duplicate and the event was lost. A claim now says
--    'processing' until the handler finishes ('done'); a 'processing' claim older than 10
--    minutes can be taken again by the retry. Existing rows are 'done'.
SET lock_timeout = '5s';

DROP INDEX IF EXISTS public.payment_ledger_stripe_pi_unique_active;
CREATE UNIQUE INDEX payment_ledger_stripe_pi_unique_active ON public.payment_ledger (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND voided = false AND txn_type = 'payment';

DROP INDEX IF EXISTS public.payment_ledger_stripe_charge_unique_active;
CREATE UNIQUE INDEX payment_ledger_stripe_charge_unique_active ON public.payment_ledger (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL AND voided = false AND txn_type = 'payment';

DROP INDEX IF EXISTS public.payment_ledger_stripe_invoice_unique_active;
CREATE UNIQUE INDEX payment_ledger_stripe_invoice_unique_active ON public.payment_ledger (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL AND voided = false AND txn_type = 'payment';

-- One charge.refunded event can carry several refunds: each is its own row with that event id.
DROP INDEX IF EXISTS public.payment_ledger_stripe_event_unique;
CREATE UNIQUE INDEX payment_ledger_stripe_event_unique ON public.payment_ledger (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL AND txn_type = 'payment';

ALTER TABLE public.processed_stripe_events ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done';
ALTER TABLE public.processed_stripe_events ADD COLUMN IF NOT EXISTS claimed_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processed_stripe_events_status_check') THEN
    ALTER TABLE public.processed_stripe_events
      ADD CONSTRAINT processed_stripe_events_status_check CHECK (status IN ('processing', 'done'));
  END IF;
END $$;

/**
 * Take an event's claim back from a worker that was cut off: only a 'processing' claim older
 * than 10 minutes, and only once (the row is re-stamped in the same statement). Server only.
 */
CREATE OR REPLACE FUNCTION public.stripe_event_reclaim(_event_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.processed_stripe_events
     SET claimed_at = now()
   WHERE event_id = _event_id AND status = 'processing' AND claimed_at < now() - interval '10 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.stripe_event_reclaim(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_event_reclaim(text) TO service_role;
