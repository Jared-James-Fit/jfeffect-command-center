ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS first_payment_date date,
  ADD COLUMN IF NOT EXISTS billing_anchor_day integer,
  ADD COLUMN IF NOT EXISTS service_start_date date,
  ADD COLUMN IF NOT EXISTS billing_schedule_source text;

COMMENT ON COLUMN public.purchase_records.first_payment_date IS 'Agreed date of the first Stripe charge at sale time (snapshot). Stripe next_billing_date remains the live source of truth.';
COMMENT ON COLUMN public.purchase_records.billing_anchor_day IS 'Friendly monthly billing day (1-28) agreed for this sale.';
COMMENT ON COLUMN public.purchase_records.service_start_date IS 'When coaching/access begins — deliberately separate from billing dates.';
COMMENT ON COLUMN public.purchase_records.billing_schedule_source IS 'product_default | client_override';