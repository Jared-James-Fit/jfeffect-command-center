-- Real-time Stripe ↔ sales sync: the admin/client sales surfaces must update
-- the moment a webhook writes, instead of waiting for a cache window.
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_ledger;