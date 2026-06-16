-- Extend discount_codes with separate test/live Stripe references + sync status,
-- migrate any existing data from the single-column shape, and tighten the
-- activation trigger so a promotion cannot go active without an expiry.

ALTER TABLE public.discount_codes
  ADD COLUMN IF NOT EXISTS stripe_test_coupon_id text,
  ADD COLUMN IF NOT EXISTS stripe_test_promotion_code_id text,
  ADD COLUMN IF NOT EXISTS stripe_live_coupon_id text,
  ADD COLUMN IF NOT EXISTS stripe_live_promotion_code_id text,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_error text,
  ADD COLUMN IF NOT EXISTS stripe_active boolean NOT NULL DEFAULT false;

-- Backfill: if legacy single columns hold a test- or live-shaped id, move it.
UPDATE public.discount_codes
SET stripe_test_coupon_id = stripe_coupon_id
WHERE stripe_test_coupon_id IS NULL
  AND stripe_coupon_id IS NOT NULL
  AND stripe_coupon_id NOT LIKE 'live_%';

UPDATE public.discount_codes
SET stripe_test_promotion_code_id = stripe_promotion_code_id
WHERE stripe_test_promotion_code_id IS NULL
  AND stripe_promotion_code_id IS NOT NULL
  AND stripe_promotion_code_id NOT LIKE 'live_%';

-- Activation guard: a code cannot become 'active' without an expires_at timestamp.
CREATE OR REPLACE FUNCTION public.discount_codes_require_expiry_before_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.expires_at IS NULL THEN
    RAISE EXCEPTION 'discount_codes: cannot set status=active without expires_at (code=%)', NEW.public_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_discount_codes_require_expiry_before_active ON public.discount_codes;
CREATE TRIGGER trg_discount_codes_require_expiry_before_active
BEFORE INSERT OR UPDATE OF status, expires_at ON public.discount_codes
FOR EACH ROW
EXECUTE FUNCTION public.discount_codes_require_expiry_before_active();

-- Helpful index for the admin "Expiring soon" filter and sync runs.
CREATE INDEX IF NOT EXISTS idx_discount_codes_status_expires
  ON public.discount_codes (status, expires_at);