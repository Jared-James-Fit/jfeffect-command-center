
-- Add service_status, Stripe IDs, receipt, email tracking to purchase_records
ALTER TABLE public.purchase_records
  ADD COLUMN IF NOT EXISTS service_status text NOT NULL DEFAULT 'Not Started',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_receipt_url text,
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_update_source text,
  ADD COLUMN IF NOT EXISTS last_payment_update_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_purchase_records_payment_status ON public.purchase_records(payment_status);
CREATE INDEX IF NOT EXISTS idx_purchase_records_service_status ON public.purchase_records(service_status);
CREATE INDEX IF NOT EXISTS idx_purchase_records_stripe_checkout ON public.purchase_records(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_purchase_records_stripe_intent ON public.purchase_records(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_purchase_records_stripe_subscription ON public.purchase_records(stripe_subscription_id);

-- Link coaching products (payment links) to offers + add archive/notes
ALTER TABLE public.coaching_products
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS payment_structure text;

CREATE INDEX IF NOT EXISTS idx_coaching_products_offer_id ON public.coaching_products(offer_id);
CREATE INDEX IF NOT EXISTS idx_coaching_products_active ON public.coaching_products(active);
