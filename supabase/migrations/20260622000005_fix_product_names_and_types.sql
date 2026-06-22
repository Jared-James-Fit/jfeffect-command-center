-- ============================================================
-- Migration: Fix product names and normalize product_type values
-- Updates display names for in-person training packages
-- Maps legacy product_type values to simplified categories
-- Preserves all Stripe IDs, prices, links, and subscriptions
-- ============================================================

-- Fix product names for in-person training packages
-- "Personal Training" (single session)
UPDATE public.coaching_products
SET name = 'Personal Training — Single Session', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGUUFYBPj4Wx'
  AND price_cents = 10000;

-- "Private Coaching" 4 weeks → "Personal Training — 12 Sessions / 4 Weeks"
UPDATE public.coaching_products
SET name = 'Personal Training — 12 Sessions / 4 Weeks', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGUUFYBPj4Wx'
  AND price_cents = 111000;

-- "Private Coaching" 12 weeks → "Personal Training — 36 Sessions / 12 Weeks"
UPDATE public.coaching_products
SET name = 'Personal Training — 36 Sessions / 12 Weeks', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGUUFYBPj4Wx'
  AND price_cents = 315000;

-- "Private Coaching" 24 weeks → "Personal Training — 72 Sessions / 24 Weeks"
UPDATE public.coaching_products
SET name = 'Personal Training — 72 Sessions / 24 Weeks', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGUUFYBPj4Wx'
  AND price_cents = 600000;

-- Normalize product_type values to simplified categories
UPDATE public.coaching_products
SET product_type = 'Personal Training', updated_at = NOW()
WHERE product_type IN ('In-Person Personal Training', 'In-Person Session Package');

UPDATE public.coaching_products
SET product_type = 'Coaching', updated_at = NOW()
WHERE product_type IN ('Online Coaching', 'Hybrid Coaching', 'Powerlifting Coaching');

UPDATE public.coaching_products
SET product_type = 'Training Programs', updated_at = NOW()
WHERE product_type IN ('Custom Training Program');

UPDATE public.coaching_products
SET product_type = 'Digital Products', updated_at = NOW()
WHERE product_type = 'Digital Product';

UPDATE public.coaching_products
SET product_type = 'Add-Ons', updated_at = NOW()
WHERE product_type IN ('Add-On Service');

-- Normalize payment_structure values
UPDATE public.coaching_products
SET payment_structure = 'Monthly subscription', updated_at = NOW()
WHERE payment_structure = 'Monthly recurring';

UPDATE public.coaching_products
SET payment_structure = 'Annual subscription', updated_at = NOW()
WHERE payment_structure = 'Annual recurring';

UPDATE public.coaching_products
SET payment_structure = 'Installment plan', updated_at = NOW()
WHERE payment_structure = 'Payment plan';

UPDATE public.coaching_products
SET payment_structure = 'One-time payment', updated_at = NOW()
WHERE payment_structure = 'Paid in full';
