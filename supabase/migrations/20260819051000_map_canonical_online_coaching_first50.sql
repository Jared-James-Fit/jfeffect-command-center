-- Map the verified live Stripe Online Coaching / FIRST50 catalog into the
-- existing JF Effect coaching_products and discount_codes architecture.
-- This migration is intentionally staged only. Apply it only after Lovable Cloud
-- access is restored and the target backend is independently confirmed as
-- ojrsinmwkqfuukfmtryx.

DO $$
DECLARE
  v_product_id uuid;
  v_product_count integer;
  v_discount_id uuid;
BEGIN
  -- Reuse the exact Stripe Price mapping first. Otherwise reuse one unambiguous
  -- existing Online Coaching row only when it is unmapped or already canonical.
  SELECT count(*)
    INTO v_product_count
  FROM public.coaching_products
  WHERE stripe_price_id = 'price_1U616UPwmHNsdfMLcSuG7LYs'
     OR (
       name = 'Online Coaching'
       AND COALESCE(currency, '') = 'cad'
       AND COALESCE(price_cents, 0) = 18000
       AND (stripe_price_id IS NULL OR stripe_price_id = 'price_1U616UPwmHNsdfMLcSuG7LYs')
     );

  IF v_product_count > 1 THEN
    RAISE EXCEPTION 'Canonical Online Coaching mapping is ambiguous; expected at most one eligible local product row.';
  END IF;

  SELECT id
    INTO v_product_id
  FROM public.coaching_products
  WHERE stripe_price_id = 'price_1U616UPwmHNsdfMLcSuG7LYs'
     OR (
       name = 'Online Coaching'
       AND COALESCE(currency, '') = 'cad'
       AND COALESCE(price_cents, 0) = 18000
       AND (stripe_price_id IS NULL OR stripe_price_id = 'price_1U616UPwmHNsdfMLcSuG7LYs')
     )
  LIMIT 1;

  IF v_product_id IS NULL THEN
    INSERT INTO public.coaching_products (
      name, description, price_cents, currency,
      stripe_product_id, stripe_price_id,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'Online Coaching',
      'Personalized 1:1 online coaching with custom training, nutrition guidance and weekly support.',
      18000,
      'cad',
      'prod_V6DXyDNiHWBpUg',
      'price_1U616UPwmHNsdfMLcSuG7LYs',
      'Coaching', 'Monthly subscription', 'subscription', 'Active', true,
      now(), now()
    )
    RETURNING id INTO v_product_id;
  ELSE
    -- Never repurpose a local row linked to another live Price/Product.
    IF EXISTS (
      SELECT 1
      FROM public.coaching_products
      WHERE id = v_product_id
        AND (
          (stripe_product_id IS NOT NULL AND stripe_product_id <> 'prod_V6DXyDNiHWBpUg')
          OR (stripe_price_id IS NOT NULL AND stripe_price_id <> 'price_1U616UPwmHNsdfMLcSuG7LYs')
        )
    ) THEN
      RAISE EXCEPTION 'Existing Online Coaching row is linked to a different Stripe catalog object; reconciliation stopped.';
    END IF;

    UPDATE public.coaching_products
    SET name = 'Online Coaching',
        description = 'Personalized 1:1 online coaching with custom training, nutrition guidance and weekly support.',
        price_cents = 18000,
        currency = 'cad',
        stripe_product_id = 'prod_V6DXyDNiHWBpUg',
        stripe_price_id = 'price_1U616UPwmHNsdfMLcSuG7LYs',
        product_type = 'Coaching',
        payment_structure = 'Monthly subscription',
        mode = 'subscription',
        status = 'Active',
        active = true,
        updated_at = now()
    WHERE id = v_product_id;
  END IF;

  -- FIRST50 is one non-stacking, once-only fixed CAD discount eligible only for
  -- the canonical local Online Coaching product. A conflicting existing public
  -- code is a hard stop, never an implicit replacement.
  SELECT id
    INTO v_discount_id
  FROM public.discount_codes
  WHERE lower(public_code::text) = 'first50'
  LIMIT 1;

  IF v_discount_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.discount_codes
    WHERE id = v_discount_id
      AND (
        (stripe_coupon_id IS NOT NULL AND stripe_coupon_id <> 'h4MvrqqK')
        OR (stripe_promotion_code_id IS NOT NULL AND stripe_promotion_code_id <> 'promo_1U617DPwmHNsdfMLXzmOHqn9')
      )
  ) THEN
    RAISE EXCEPTION 'Existing FIRST50 local record has conflicting Stripe identifiers; reconciliation stopped.';
  END IF;

  IF v_discount_id IS NULL THEN
    INSERT INTO public.discount_codes (
      internal_name, public_code, category, description,
      discount_type, discount_value, subscription_duration,
      eligible_product_ids, applies_to_all_products,
      new_customers_only, existing_customers_only,
      status, per_customer_limit, pairing_allowed,
      stripe_coupon_id, stripe_promotion_code_id,
      stripe_test_mode_synced, stripe_live_mode_synced,
      expires_at, created_at, updated_at
    ) VALUES (
      'FIRST50 — Online Coaching First Payment',
      'FIRST50', 'promotion', 'CAD $50 off the first Online Coaching payment only.',
      'fixed', 50.00, 'once',
      ARRAY[v_product_id], false,
      false, false,
      'active', 1, false,
      'h4MvrqqK', 'promo_1U617DPwmHNsdfMLXzmOHqn9',
      false, true,
      NULL, now(), now()
    );
  ELSE
    UPDATE public.discount_codes
    SET internal_name = 'FIRST50 — Online Coaching First Payment',
        description = 'CAD $50 off the first Online Coaching payment only.',
        category = 'promotion',
        discount_type = 'fixed',
        discount_value = 50.00,
        subscription_duration = 'once',
        duration_months = NULL,
        eligible_product_ids = ARRAY[v_product_id],
        applies_to_all_products = false,
        new_customers_only = false,
        existing_customers_only = false,
        status = 'active',
        per_customer_limit = 1,
        pairing_allowed = false,
        pairable_category = NULL,
        stripe_coupon_id = 'h4MvrqqK',
        stripe_promotion_code_id = 'promo_1U617DPwmHNsdfMLXzmOHqn9',
        stripe_test_mode_synced = false,
        stripe_live_mode_synced = true,
        expires_at = NULL,
        updated_at = now()
    WHERE id = v_discount_id;
  END IF;
END;
$$;
