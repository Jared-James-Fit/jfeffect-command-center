-- ─────────────────────────────────────────────────────────────────────────────
-- Stripe Checkout Integration Migration
-- Adds stripe_customer_id to clients table so the Customer Portal can be
-- opened without scanning purchase_records on every request.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add stripe_customer_id to clients (idempotent)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE INDEX IF NOT EXISTS idx_clients_stripe_customer_id
  ON public.clients(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- coaching_products already has stripe_price_id and mode columns from prior
-- migrations. This migration only ensures the clients table is updated.
-- No other schema changes are required for the Stripe Checkout integration.
