-- ============================================================
-- Migration: Add 3 Private Coaching packages (3 sessions/week)
-- Get Started (4wk), Most Popular (12wk), Best Value (24wk)
-- ============================================================

-- PT-4WK: Private Coaching — 4 Weeks
INSERT INTO public.coaching_products (
  id, name, description, notes, price_cents, currency,
  stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
  product_type, payment_structure, mode, status, active,
  created_at, updated_at
) VALUES (
  'e1fa8deb-0a5b-44f3-bd87-26f90bb3b4ef',
  'Private Coaching',
  'CAD $1,110 • 12 sessions / 4 weeks',
  'Save $90 vs single sessions • 3 sessions/week',
  111000,
  'cad',
  'prod_UkMGUUFYBPj4Wx',
  'price_1Tkz8YPwmHNsdfMLDU6ePT08',
  'plink_1Tkz8YPwmHNsdfMLdoJE9BQF',
  'https://buy.stripe.com/eVq8wR2tI2IX4yT3cZ0co1B',
  'In-Person Personal Training',
  'One-time payment',
  'payment',
  'Active',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- PT-12WK: Private Coaching — 12 Weeks
INSERT INTO public.coaching_products (
  id, name, description, notes, price_cents, currency,
  stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
  product_type, payment_structure, mode, status, active,
  created_at, updated_at
) VALUES (
  '4452d7ac-e2b8-4619-9f47-e346f3e81036',
  'Private Coaching',
  'CAD $3,150 • 36 sessions / 12 weeks',
  'Save $450 vs single sessions • 3 sessions/week • Partner flexibility included',
  315000,
  'cad',
  'prod_UkMGUUFYBPj4Wx',
  'price_1Tkz8YPwmHNsdfMLRvEJuSMR',
  'plink_1Tkz8ZPwmHNsdfMLQacARNba',
  'https://buy.stripe.com/5kQ5kFgkyfvJ1mHbJv0co1C',
  'In-Person Personal Training',
  'One-time payment',
  'payment',
  'Active',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- PT-24WK: Private Coaching — 24 Weeks
INSERT INTO public.coaching_products (
  id, name, description, notes, price_cents, currency,
  stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
  product_type, payment_structure, mode, status, active,
  created_at, updated_at
) VALUES (
  '90d88ccc-09c2-4bf0-981e-bafeb50c6372',
  'Private Coaching',
  'CAD $6,000 • 72 sessions / 24 weeks',
  'Save $1,200 vs single sessions • 3 sessions/week • Partner flexibility included',
  600000,
  'cad',
  'prod_UkMGUUFYBPj4Wx',
  'price_1Tkz8ZPwmHNsdfMLuNtRp12Y',
  'plink_1Tkz8ZPwmHNsdfMLEmHy7tvp',
  'https://buy.stripe.com/8x2aEZ0lA1ETfdxeVH0co1D',
  'In-Person Personal Training',
  'One-time payment',
  'payment',
  'Active',
  true,
  NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;
