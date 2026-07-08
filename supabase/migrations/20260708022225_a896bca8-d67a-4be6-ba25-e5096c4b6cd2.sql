
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS next_billing_date DATE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_purchase_records_next_billing
  ON public.purchase_records (next_billing_date)
  WHERE next_billing_date IS NOT NULL;
