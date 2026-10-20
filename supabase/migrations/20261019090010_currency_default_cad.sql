-- JF Effect bills in Canadian dollars. Three money tables still defaulted to
-- USD, so any write that didn't pass a currency was recorded as USD.
--
-- Defaults only. Existing rows are NOT rewritten. To see how many rows carry
-- a USD (or missing) currency today, run this read-only check:
--
--   SELECT 'payment_ledger' AS tbl, upper(coalesce(currency, '(null)')) AS currency, count(*)
--     FROM public.payment_ledger GROUP BY 2
--   UNION ALL
--   SELECT 'purchase_records', upper(coalesce(currency, '(null)')), count(*)
--     FROM public.purchase_records GROUP BY 2
--   UNION ALL
--   SELECT 'member_payment_ledger', upper(coalesce(currency, '(null)')), count(*)
--     FROM public.member_payment_ledger GROUP BY 2
--   ORDER BY 1, 2;
--
-- A USD row isn't necessarily wrong: a Stripe charge that really was in USD
-- carries Stripe's own currency. Only rows written without one picked up the
-- old default, so check them against Stripe before correcting anything.

ALTER TABLE public.payment_ledger        ALTER COLUMN currency SET DEFAULT 'CAD';
ALTER TABLE public.purchase_records      ALTER COLUMN currency SET DEFAULT 'CAD';
ALTER TABLE public.member_payment_ledger ALTER COLUMN currency SET DEFAULT 'CAD';
