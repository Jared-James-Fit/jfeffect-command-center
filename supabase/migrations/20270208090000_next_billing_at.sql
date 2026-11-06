-- When a Stripe subscription charges, to the minute.
--
-- `purchase_records.next_billing_date` is a calendar day, so the coach could
-- only tell a client "Nov 6" when their card would be charged. Stripe renews
-- at the exact time of day the subscription started (a checkout at 6:47 PM
-- renews at 6:47 PM) and charges the card about an hour after that, so a
-- client looking for the charge that morning thought it had failed.
--
-- `next_billing_at` keeps Stripe's period end as an instant, written beside
-- the day by every Stripe path (webhook, sync, reconcile, backfill) through
-- `renewalColumns` (src/lib/stripe-renewal.ts), which also makes the day
-- Winnipeg's: the old UTC split put every renewal after 7 PM on the next day.
--
-- A write that moves only the day (anything that doesn't know the time) clears
-- the time, so a time is never shown against a day it doesn't belong to.

ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS next_billing_at timestamptz;

COMMENT ON COLUMN public.purchase_records.next_billing_at IS
  'Stripe''s exact renewal instant (current_period_end) for next_billing_date; the card is charged about an hour later. Null when unknown.';

CREATE OR REPLACE FUNCTION public.purchase_records_next_billing_at_follows_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.next_billing_date IS DISTINCT FROM OLD.next_billing_date
     AND NEW.next_billing_at IS NOT DISTINCT FROM OLD.next_billing_at THEN
    NEW.next_billing_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS purchase_records_next_billing_at_follows_date ON public.purchase_records;
CREATE TRIGGER purchase_records_next_billing_at_follows_date
  BEFORE UPDATE OF next_billing_date ON public.purchase_records
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_records_next_billing_at_follows_date();
