-- ============================================================
-- Migration: Fix bi-weekly $250 product record + simplify names
-- 
-- 1. Update the JJF-BIWEEKLY-12 product with correct Stripe IDs
-- 2. Set name = service name only (no price/term in title)
-- 3. Set description = price + frequency + payment count subtitle
-- ============================================================

-- Step 1: Update the bi-weekly $250 product with correct Stripe Price + Link
UPDATE public.coaching_products
SET
  stripe_price_id        = 'price_1Tky4FPwmHNsdfML5udYLvOi',
  stripe_payment_link_id = 'plink_1Tky4FPwmHNsdfML8n8GOKQI',
  payment_link_url       = 'https://buy.stripe.com/fZucN79Wa2IX9TdcNz0co1A',
  name                   = 'Online Coaching',
  description            = 'CAD $250 every 2 weeks • 24 payments',
  notes                  = 'CAD $6,000 total before tax • Automatically ends after payment 24',
  payment_structure      = 'Payment plan',
  mode                   = 'subscription',
  status                 = 'Active',
  active                 = true,
  updated_at             = NOW()
WHERE stripe_price_id = 'price_1TkrYsPwmHNsdfMLXkXXXAor'
   OR (stripe_product_id = 'prod_UeqGAvKzjrzfwa' AND price_cents = 25000 AND payment_structure ILIKE '%bi%weekly%');

-- Step 2: Simplify product names — remove price/term/frequency from titles
-- Apply to all coaching products that have the service name embedded in a longer title

-- Private Coaching variants
UPDATE public.coaching_products SET name = 'Private Coaching', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGmYghOJxhuZ' AND name != 'Private Coaching';

-- Coaching Plus variants  
UPDATE public.coaching_products SET name = 'Coaching Plus', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMHiom0gY1LF0' AND name != 'Coaching Plus';

-- Jared James Fit Coaching variants → Online Coaching
UPDATE public.coaching_products SET name = 'Online Coaching', updated_at = NOW()
WHERE stripe_product_id = 'prod_UeqGAvKzjrzfwa' AND name != 'Online Coaching';

-- Foundation Membership
UPDATE public.coaching_products SET name = 'Foundation Membership', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGWHu7Jl8Rrx' AND name != 'Foundation Membership';

-- Performance Membership
UPDATE public.coaching_products SET name = 'Performance Membership', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMG01NJ1TkeMV' AND name != 'Performance Membership';

-- Complete Membership
UPDATE public.coaching_products SET name = 'Complete Membership', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGvO7PfUxnXD' AND name != 'Complete Membership';

-- Private Training Session
UPDATE public.coaching_products SET name = 'Personal Training', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMGUUFYBPj4Wx' AND name != 'Personal Training';

-- 12 Week Training Program
UPDATE public.coaching_products SET name = 'Custom Program', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMHIcc8W3gsu0' AND name != 'Custom Program';

-- JF Effect Training App
UPDATE public.coaching_products SET name = 'JF Effect Membership', updated_at = NOW()
WHERE stripe_product_id = 'prod_UkMHceEBfLzMHw' AND name != 'JF Effect Membership';
