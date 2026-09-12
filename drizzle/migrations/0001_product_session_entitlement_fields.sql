ALTER TABLE public.coaching_products
  ADD COLUMN IF NOT EXISTS session_length_minutes integer,
  ADD COLUMN IF NOT EXISTS session_expiry_days integer;

COMMENT ON COLUMN public.coaching_products.sessions_included IS
  'Session credits this product grants. Snapshotted onto purchase_records.sessions_purchased at sale time; granting is handled by grant_sessions_if_paid_in_full().';
COMMENT ON COLUMN public.coaching_products.session_fulfillment IS
  'When session credits are granted: first_payment (once on activation), per_installment (proportional to amount paid), manual.';