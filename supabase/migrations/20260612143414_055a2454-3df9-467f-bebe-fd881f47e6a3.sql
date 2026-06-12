
CREATE TABLE public.promo_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- promo identity
  promotion_code text,
  stripe_promotion_code_id text,
  stripe_coupon_id text,
  discount_percent_off numeric,
  discount_amount_off integer,
  discount_currency text,
  discount_duration text,
  amount_discount_cents integer,
  -- product context
  product_type text,
  product_id uuid,
  product_name text,
  checkout_type text,
  source text,
  -- customer / stripe linkage
  customer_email text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  -- app linkage
  client_id uuid,
  member_id uuid,
  user_id uuid,
  -- raw + bookkeeping
  stripe_event_id text,
  raw jsonb,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX promo_code_redemptions_session_uniq
  ON public.promo_code_redemptions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX promo_code_redemptions_code_idx ON public.promo_code_redemptions (promotion_code);
CREATE INDEX promo_code_redemptions_redeemed_idx ON public.promo_code_redemptions (redeemed_at DESC);
CREATE INDEX promo_code_redemptions_customer_idx ON public.promo_code_redemptions (stripe_customer_id);

GRANT SELECT ON public.promo_code_redemptions TO authenticated;
GRANT ALL ON public.promo_code_redemptions TO service_role;

ALTER TABLE public.promo_code_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view promo redemptions"
  ON public.promo_code_redemptions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER promo_code_redemptions_set_updated_at
  BEFORE UPDATE ON public.promo_code_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
