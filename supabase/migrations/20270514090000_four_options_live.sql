-- All four ways in, live (Nov 23 2026).
--
-- The owner asked for the free app and all three coaching packages to be on the
-- site, once Nutrition Coaching ($99) and Coaching Plus ($249) can actually be
-- sold. The coaching-package-stripe hook sets each one up first (a Stripe
-- product with one monthly CAD price before tax, a Products row shaped like
-- Complete's $130/month, the package pointing at it) and proves it with a
-- subscription checkout made and expired at once. This migration lists a
-- package only when that link is in place and matches the package's price, so
-- run anywhere else (or before the hook) it changes nothing.
--
-- Nothing here touches a sale, a subscription, an existing Stripe price or
-- product, the four one-time calls (still drafts), or anyone's billing.

SET lock_timeout = '8s';

-- ---------------------------------------------------------------------------
-- 1. Nutrition Coaching and Coaching Plus on the site, only when sellable
-- ---------------------------------------------------------------------------
UPDATE public.coaching_packages p SET
  status = 'active',
  is_public = true,
  admin_note = 'Live from Nov 23 2026. Sold through each client''s own checkout; its Stripe price was set up and checked by the coaching-package-stripe hook.'
WHERE p.slug IN ('nutrition', 'plus')
  AND p.status = 'draft'
  AND p.kind = 'subscription'
  AND p.price_cents > 0
  AND EXISTS (
    SELECT 1
    FROM public.coaching_products cp
    WHERE cp.id = p.product_id
      AND cp.stripe_price_id IS NOT NULL
      AND cp.price_cents = p.price_cents
      AND lower(cp.currency) = lower(p.currency)
      AND cp.mode = 'subscription'
      AND cp.status = 'Active'
      AND cp.active
  );

-- ---------------------------------------------------------------------------
-- 2. With Nutrition listed, Complete says what it adds to it instead of
--    repeating the nutrition plan (only while its words are still these)
-- ---------------------------------------------------------------------------
UPDATE public.coaching_packages c SET
  features = ARRAY[
    'Everything in Nutrition Coaching',
    'A program written for you and changed as you progress',
    'Weekly check-ins, and I adjust the plan',
    'Technique feedback on the sets you film',
    'Message me in the app',
    'Meet prep if you compete'
  ]
WHERE c.slug = 'complete'
  AND c.features = ARRAY[
    'A program written for you and changed as you progress',
    'A nutrition plan built around the food you eat',
    'Weekly check-ins, and I adjust the plan',
    'Technique feedback on the sets you film',
    'Message me in the app',
    'Meet prep if you compete'
  ]
  AND EXISTS (
    SELECT 1 FROM public.coaching_packages n
    WHERE n.slug = 'nutrition' AND n.status = 'active' AND n.is_public
  );
