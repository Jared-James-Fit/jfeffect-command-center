ALTER TABLE public.coaching_products
  ADD COLUMN IF NOT EXISTS service_start_mode text,
  ADD COLUMN IF NOT EXISTS service_start_date date;

COMMENT ON COLUMN public.coaching_products.service_start_mode IS
  'Default coaching/service start rule for new sales: immediate | with_first_payment | on_date | admin_choice. Never affects Stripe billing dates.';
COMMENT ON COLUMN public.coaching_products.service_start_date IS
  'Calendar date used when service_start_mode = on_date. Snapshotted onto each sale; editing it never rewrites existing purchases.';