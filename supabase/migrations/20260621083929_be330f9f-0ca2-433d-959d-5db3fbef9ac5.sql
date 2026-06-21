CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.validate_discount_codes(
  _codes TEXT[],
  _customer_id UUID DEFAULT NULL,
  _product_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applied JSONB := '[]'::jsonb;
  rejected JSONB := '[]'::jsonb;
  seen TEXT[] := '{}';
  promo_count INT := 0;
  referral_count INT := 0;
  code_text TEXT;
  rec public.discount_codes%ROWTYPE;
  cat_referral BOOLEAN;
BEGIN
  IF _codes IS NULL OR array_length(_codes,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'applied', applied, 'rejected', rejected);
  END IF;

  IF array_length(_codes,1) > 2 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'applied', applied,
      'rejected', jsonb_build_array(jsonb_build_object('code', NULL, 'reason', 'Maximum two codes per checkout'))
    );
  END IF;

  FOREACH code_text IN ARRAY _codes LOOP
    IF code_text IS NULL OR length(trim(code_text)) = 0 THEN CONTINUE; END IF;
    IF upper(code_text) = ANY(SELECT upper(x) FROM unnest(seen) x) THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Duplicate code');
      CONTINUE;
    END IF;
    seen := array_append(seen, code_text);

    SELECT * INTO rec FROM public.discount_codes WHERE lower(public_code::text) = lower(code_text) LIMIT 1;
    IF NOT FOUND THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Code not found. Check spelling or try another code.');
      CONTINUE;
    END IF;
    IF rec.status <> 'active' THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'This code is not currently active.');
      CONTINUE;
    END IF;
    IF rec.expires_at IS NOT NULL AND rec.expires_at < now() THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'This code has expired.');
      CONTINUE;
    END IF;
    IF rec.start_at IS NOT NULL AND rec.start_at > now() THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'This code is not yet active.');
      CONTINUE;
    END IF;
    IF _product_id IS NOT NULL AND NOT rec.applies_to_all_products
       AND NOT (_product_id = ANY(rec.eligible_product_ids)) THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'This code cannot be combined with the current offer.');
      CONTINUE;
    END IF;

    cat_referral := rec.category IN ('ambassador','client_referral');

    IF rec.category = 'promotion' THEN promo_count := promo_count + 1; END IF;
    IF cat_referral THEN referral_count := referral_count + 1; END IF;

    IF promo_count > 1 THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Only one promotion code allowed.');
      CONTINUE;
    END IF;
    IF referral_count > 1 THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'Only one referral code allowed.');
      CONTINUE;
    END IF;
    IF NOT rec.pairing_allowed AND (promo_count + referral_count > 1) THEN
      rejected := rejected || jsonb_build_object('code', code_text, 'reason', 'This code cannot be combined with others.');
      CONTINUE;
    END IF;

    applied := applied || jsonb_build_object(
      'id', rec.id,
      'code', code_text,
      'category', rec.category,
      'discount_type', rec.discount_type,
      'discount_value', rec.discount_value,
      'subscription_duration', rec.subscription_duration,
      'duration_months', rec.duration_months,
      'description', rec.description
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(rejected) = 0,
    'applied', applied,
    'rejected', rejected
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_discount_codes(TEXT[], UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_discount_codes(TEXT[], UUID, UUID) TO authenticated, service_role;