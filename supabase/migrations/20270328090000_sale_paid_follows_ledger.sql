-- A sale's paid total in dollars (purchase_records.amount_paid) always says what its payment rows
-- say once it has any. recompute_purchase_totals sets amount_paid_cents and amount_paid from
-- payment_ledger on every payment, refund or void, but the Stripe checkout handlers (the webhook's
-- checkout.session.completed, the account sync) then wrote the checkout's own total into
-- amount_paid, so on Nov 16 2026 four live subscriptions (Alyssa, Nicole, Reece, Jarrett) read
-- one charge in dollars while their payment rows held two, and Cleo's purchases lookup said so.
-- The paid total is the payment rows' sum: what any other writer puts in the dollar column is
-- replaced by the cents the ledger set. A sale with no payment rows yet keeps whatever it was
-- given (a legacy or demo sale).

CREATE OR REPLACE FUNCTION public.purchase_paid_follows_ledger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.amount_paid_cents IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.payment_ledger l WHERE l.purchase_id = NEW.id) THEN
    NEW.amount_paid := ROUND(NEW.amount_paid_cents::numeric / 100.0, 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_records_paid_follows_ledger ON public.purchase_records;
CREATE TRIGGER purchase_records_paid_follows_ledger
  BEFORE UPDATE OF amount_paid, amount_paid_cents ON public.purchase_records
  FOR EACH ROW EXECUTE FUNCTION public.purchase_paid_follows_ledger();

-- Put the sales that drifted back in step (the trigger does the work; only the dollar column moves).
UPDATE public.purchase_records pr
   SET amount_paid = pr.amount_paid
 WHERE pr.amount_paid_cents IS NOT NULL
   AND ROUND(COALESCE(pr.amount_paid, 0) * 100)::bigint <> pr.amount_paid_cents
   AND EXISTS (SELECT 1 FROM public.payment_ledger l WHERE l.purchase_id = pr.id);
