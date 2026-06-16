INSERT INTO public.discount_codes (
  internal_name, public_code, category, description,
  discount_type, discount_value, subscription_duration, duration_months,
  applies_to_all_products, new_customers_only,
  pairing_allowed, pairable_category, max_promo_codes, max_referral_codes, max_total_codes,
  linked_client_id, status
)
SELECT
  c.full_name || ' — Client Referral',
  upper(regexp_replace(
    coalesce(NULLIF(c.first_name, ''), split_part(c.full_name, ' ', 1)),
    '[^A-Za-z0-9]', '', 'g'
  )) AS public_code,
  'client_referral'::public.discount_code_category,
  'Auto-seeded referral code for ' || c.full_name,
  'percentage'::public.discount_code_type,
  5,
  'forever'::public.discount_code_duration,
  NULL,
  true,
  false,
  true,
  'promotion'::public.discount_code_category,
  1, 1, 2,
  c.id,
  'draft'::public.discount_code_status
FROM public.clients c
WHERE c.status IN ('Active', 'New Client')
  AND c.email IS NOT NULL AND c.email <> ''
  AND coalesce(NULLIF(c.first_name, ''), split_part(c.full_name, ' ', 1)) IS NOT NULL
ON CONFLICT (public_code) DO NOTHING;