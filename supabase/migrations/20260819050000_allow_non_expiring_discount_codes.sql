-- Allow active promotions with NULL expires_at, where NULL means no expiration.
-- Existing dated promotions remain valid and the canonical validation RPC already
-- rejects only records whose non-null expires_at is in the past.
-- No RLS policy, product eligibility, Stripe identity, redemption history, or
-- discount uniqueness rule is changed by this migration.

CREATE OR REPLACE FUNCTION public.discount_codes_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.discount_type = 'percentage' AND NEW.discount_value > 100 THEN
    RAISE EXCEPTION 'percentage discount cannot exceed 100';
  END IF;

  IF NEW.subscription_duration = 'repeating'
     AND (NEW.duration_months IS NULL OR NEW.duration_months <= 0) THEN
    RAISE EXCEPTION 'repeating duration requires duration_months > 0';
  END IF;

  -- expires_at IS NULL is intentionally valid and means no expiration.
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_discount_codes_require_expiry_before_active
  ON public.discount_codes;
DROP FUNCTION IF EXISTS public.discount_codes_require_expiry_before_active();
