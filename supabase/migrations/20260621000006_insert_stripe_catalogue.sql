-- ============================================================
-- Migration: Insert JF Effect Stripe Catalogue (34 products)
-- 9 canonical products, 34 price options, all with Stripe Tax
-- Generated from Stripe API — all prices have tax_behavior=exclusive
-- All payment links have automatic_tax=true, billing_address=required
-- ============================================================

DO $$
BEGIN

  -- PT-01: 1 In-Person Training Session
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrXlPwmHNsdfMLnNUPAOXM') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '6bc24892-c967-498d-848d-41d122f1fa29',
      '1 In-Person Training Session',
      '$100.00 CAD',
      10000,
      'cad',
      'prod_UkMGUUFYBPj4Wx',
      'price_1TkrXlPwmHNsdfMLnNUPAOXM',
      'plink_1TkrYUPwmHNsdfMLL1oalksr',
      'https://buy.stripe.com/14A8wR5FUbft7L5aFr0co0s',
      'Custom',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PT-02: Foundation Membership — 1x/Week
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrXmPwmHNsdfML4QO6H217') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '41a4889e-d366-492d-9d37-68bebe0ad057',
      'Foundation Membership — 1x/Week',
      '$390.00 CAD/month',
      39000,
      'cad',
      'prod_UkMGWHu7Jl8Rrx',
      'price_1TkrXmPwmHNsdfML4QO6H217',
      'plink_1TkrYVPwmHNsdfMLtJ02Zr01',
      'https://buy.stripe.com/9B6cN7c4icjxaXhcNz0co0t',
      'In-Person Session Package',
      'Monthly recurring',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PT-03: Performance Membership — 2x/Week
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrXnPwmHNsdfMLxFRHQuIf') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '405a7f0c-1db1-4c69-aeef-ffcda80116eb',
      'Performance Membership — 2x/Week',
      '$760.00 CAD/month',
      76000,
      'cad',
      'prod_UkMG01NJ1TkeMV',
      'price_1TkrXnPwmHNsdfMLxFRHQuIf',
      'plink_1TkrYVPwmHNsdfMLLvrIj7L0',
      'https://buy.stripe.com/4gMdRb6JY5V9e9t9Bn0co0u',
      'In-Person Session Package',
      'Monthly recurring',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PT-04: Complete Membership — 3x/Week
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrXoPwmHNsdfMLmuHuKvQ9') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '9b195844-4522-4365-b574-c5b5f8fa4bd2',
      'Complete Membership — 3x/Week',
      '$1,110.00 CAD/month',
      111000,
      'cad',
      'prod_UkMGvO7PfUxnXD',
      'price_1TkrXoPwmHNsdfMLmuHuKvQ9',
      'plink_1TkrYWPwmHNsdfMLaeXubZfN',
      'https://buy.stripe.com/fZu3cx5FU5V92qL14R0co0v',
      'In-Person Session Package',
      'Monthly recurring',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-PIF-12: Private Coaching — 12 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrXpPwmHNsdfMLF8NP7eMJ') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'fbde4dda-dd21-4f75-a39b-a49bd226aea0',
      'Private Coaching — 12 Months Paid in Full',
      '$30,000.00 CAD',
      3000000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrXpPwmHNsdfMLF8NP7eMJ',
      'plink_1TkrYXPwmHNsdfMLbgTJQXzw',
      'https://buy.stripe.com/bJe9AVgky4R50iD4h30co0w',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-PIF-06: Private Coaching — 6 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrXqPwmHNsdfML2WHYrrYg') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '666db7d1-17eb-41a6-a1b0-c9599a245816',
      'Private Coaching — 6 Months Paid in Full',
      '$18,000.00 CAD',
      1800000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrXqPwmHNsdfML2WHYrrYg',
      'plink_1TkrYXPwmHNsdfMLfZcWf46B',
      'https://buy.stripe.com/00w3cxecq0AP2qL9Bn0co0x',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-PIF-03: Private Coaching — 3 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrXrPwmHNsdfMLlB34AT5o') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '6b0f465f-8810-4c44-bbce-027d39b351f0',
      'Private Coaching — 3 Months Paid in Full',
      '$12,000.00 CAD',
      1200000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrXrPwmHNsdfMLlB34AT5o',
      'plink_1TkrYYPwmHNsdfMLpyBbdFWW',
      'https://buy.stripe.com/14AfZjc4i1ETaXhcNz0co0y',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-MONTHLY-12: Private Coaching — 12 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYZPwmHNsdfMLYJfKpkQH') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'b7427ac6-a83e-44bd-9a5b-fbbacef60b0c',
      'Private Coaching — 12 Monthly Payments',
      '$2,500.00 CAD/month x12 payments',
      250000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYZPwmHNsdfMLYJfKpkQH',
      'plink_1TkrYZPwmHNsdfMLmxlWe9hB',
      'https://buy.stripe.com/6oU00l3xMbft6H1fZL0co0z',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-MONTHLY-06: Private Coaching — 6 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYZPwmHNsdfMLNKe8ms9h') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '9eec645c-2bf6-4243-9402-540e9d6333e2',
      'Private Coaching — 6 Monthly Payments',
      '$3,000.00 CAD/month x6 payments',
      300000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYZPwmHNsdfMLNKe8ms9h',
      'plink_1TkrYaPwmHNsdfMLcJ4LHAq2',
      'https://buy.stripe.com/28EaEZ4BQ5V9aXhfZL0co0A',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-MONTHLY-03: Private Coaching — 3 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYaPwmHNsdfMLIBsT0IPL') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '829de720-bc2b-4ca8-8d6c-01679b2a9ab5',
      'Private Coaching — 3 Monthly Payments',
      '$4,000.00 CAD/month x3 payments',
      400000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYaPwmHNsdfMLIBsT0IPL',
      'plink_1TkrYbPwmHNsdfMLcs6Z1PKh',
      'https://buy.stripe.com/dRm3cx2tIcjx7L57tf0co0B',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-TWICE-12: Private Coaching — 24 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYbPwmHNsdfMLQidL91Pt') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '7436f1b1-a5f9-4c6a-9e85-ee02b6080703',
      'Private Coaching — 24 Twice-Monthly Payments',
      '$1,250.00 CAD/month x24 payments',
      125000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYbPwmHNsdfMLQidL91Pt',
      'plink_1TkrYcPwmHNsdfML1JyQCjol',
      'https://buy.stripe.com/8x27sNc4i97l1mH7tf0co0C',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-TWICE-06: Private Coaching — 12 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYcPwmHNsdfMLOiWJcVm7') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '489df9c1-35a5-420a-8c02-de1c199d536d',
      'Private Coaching — 12 Twice-Monthly Payments',
      '$1,500.00 CAD/month x12 payments',
      150000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYcPwmHNsdfMLOiWJcVm7',
      'plink_1TkrYdPwmHNsdfMLux8LIkge',
      'https://buy.stripe.com/8x2cN71pEgzN5CX7tf0co0D',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-TWICE-03: Private Coaching — 6 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYdPwmHNsdfMLXavPsJD2') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '1c149936-4ccb-412b-9e72-75737798ef42',
      'Private Coaching — 6 Twice-Monthly Payments',
      '$2,000.00 CAD/month x6 payments',
      200000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYdPwmHNsdfMLXavPsJD2',
      'plink_1TkrYdPwmHNsdfMLPOONTSDm',
      'https://buy.stripe.com/3cIbJ3c4i3N1e9tbJv0co0E',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-PIF-12: Coaching Plus — 12 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYePwmHNsdfMLthVvZdHp') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '449478fd-3bb5-4a9c-a87f-dfd9c9110280',
      'Coaching Plus — 12 Months Paid in Full',
      '$10,000.00 CAD',
      1000000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYePwmHNsdfMLthVvZdHp',
      'plink_1TkrYfPwmHNsdfMLLCIXqbga',
      'https://buy.stripe.com/5kQ28t6JYdnB0iD4h30co0F',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-PIF-06: Coaching Plus — 6 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYfPwmHNsdfMLi4ueb50y') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '764b3162-0fdf-4f34-840d-113590559d92',
      'Coaching Plus — 6 Months Paid in Full',
      '$7,000.00 CAD',
      700000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYfPwmHNsdfMLi4ueb50y',
      'plink_1TkrYfPwmHNsdfMLRSrRyhZB',
      'https://buy.stripe.com/cNibJ33xM2IXe9t3cZ0co0G',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-PIF-03: Coaching Plus — 3 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYgPwmHNsdfMLOxGGpJms') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'c483f58e-6c89-4901-8d57-eedb58d8ce35',
      'Coaching Plus — 3 Months Paid in Full',
      '$4,000.00 CAD',
      400000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYgPwmHNsdfMLOxGGpJms',
      'plink_1TkrYgPwmHNsdfML13EsavsP',
      'https://buy.stripe.com/aFaaEZc4ifvJ9Td7tf0co0H',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-MONTHLY-12: Coaching Plus — 12 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYhPwmHNsdfMLwyJudSYt') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'c6610889-9c8b-44d4-a2fe-990d872a494d',
      'Coaching Plus — 12 Monthly Payments',
      '$1,000.00 CAD/month x12 payments',
      100000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYhPwmHNsdfMLwyJudSYt',
      'plink_1TkrYhPwmHNsdfMLTKpxjTKr',
      'https://buy.stripe.com/3cI9AV0lAabp4yT3cZ0co0I',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-MONTHLY-06: Coaching Plus — 6 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYiPwmHNsdfMLVFl3sSha') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '57b649d3-1d41-4416-98ce-3f2c74ce91d2',
      'Coaching Plus — 6 Monthly Payments',
      '$1,300.00 CAD/month x6 payments',
      130000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYiPwmHNsdfMLVFl3sSha',
      'plink_1TkrYiPwmHNsdfMLHXZJOh8P',
      'https://buy.stripe.com/7sY6oJb0e83hfdx3cZ0co0J',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-MONTHLY-03: Coaching Plus — 3 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYjPwmHNsdfMLLZWkVheZ') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '8fb89549-15cd-4aa5-8580-1611ee1796c2',
      'Coaching Plus — 3 Monthly Payments',
      '$1,500.00 CAD/month x3 payments',
      150000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYjPwmHNsdfMLLZWkVheZ',
      'plink_1TkrYjPwmHNsdfMLl4lSB8KB',
      'https://buy.stripe.com/bJeaEZ6JYfvJ9Td14R0co0K',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-TWICE-12: Coaching Plus — 24 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYkPwmHNsdfML9nvlTZJq') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'e7ced791-3e63-4a40-8e76-7e9a27b85456',
      'Coaching Plus — 24 Twice-Monthly Payments',
      '$500.00 CAD/month x24 payments',
      50000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYkPwmHNsdfML9nvlTZJq',
      'plink_1TkrYkPwmHNsdfMLdPYzasoj',
      'https://buy.stripe.com/3cI9AV7O2cjx2qLbJv0co0L',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-TWICE-06: Coaching Plus — 12 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYlPwmHNsdfMLfNoPpg8b') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'd1fdc516-12b1-4e5c-8938-34311e586206',
      'Coaching Plus — 12 Twice-Monthly Payments',
      '$650.00 CAD/month x12 payments',
      65000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYlPwmHNsdfMLfNoPpg8b',
      'plink_1TkrYlPwmHNsdfMLMzeEqywz',
      'https://buy.stripe.com/00w9AV9Wa0AP8P96pb0co0M',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-TWICE-03: Coaching Plus — 6 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYlPwmHNsdfML46K415hz') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '3c364571-7447-40d9-a660-45355c089ae1',
      'Coaching Plus — 6 Twice-Monthly Payments',
      '$750.00 CAD/month x6 payments',
      75000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYlPwmHNsdfML46K415hz',
      'plink_1TkrYmPwmHNsdfMLF3MrphCC',
      'https://buy.stripe.com/9B67sNd8mbftc1lfZL0co0N',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-PIF-12: Jared James Fit Coaching — 12 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYmPwmHNsdfMLcr7BadIE') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '036c5c05-b233-4f14-bf53-f78e60792fd4',
      'Jared James Fit Coaching — 12 Months Paid in Full',
      '$5,000.00 CAD',
      500000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYmPwmHNsdfMLcr7BadIE',
      'plink_1TkrYnPwmHNsdfMLPOHQDGTv',
      'https://buy.stripe.com/bJedRb6JY97lfdx4h30co0O',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-PIF-06: Jared James Fit Coaching — 6 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYnPwmHNsdfML7qhXDdBq') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '664ee8c9-4e7e-416b-881f-54354fab0606',
      'Jared James Fit Coaching — 6 Months Paid in Full',
      '$3,500.00 CAD',
      350000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYnPwmHNsdfML7qhXDdBq',
      'plink_1TkrYoPwmHNsdfMLS0T3ukU3',
      'https://buy.stripe.com/dRmfZj3xM97l9Td5l70co0P',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-PIF-03: Jared James Fit Coaching — 3 Months Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYoPwmHNsdfMLHB80r3zt') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '38992f5a-2ff8-4631-a2fd-7374ac571f8f',
      'Jared James Fit Coaching — 3 Months Paid in Full',
      '$2,000.00 CAD',
      200000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYoPwmHNsdfMLHB80r3zt',
      'plink_1TkrYoPwmHNsdfMLApZ7LHr0',
      'https://buy.stripe.com/28E5kFd8mcjxghB14R0co0Q',
      'Online Coaching',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-MONTHLY-12: Jared James Fit Coaching — 12 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYpPwmHNsdfML2kwZvI5q') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '2946dc6a-0d37-4182-aeea-492ea57f0c0c',
      'Jared James Fit Coaching — 12 Monthly Payments',
      '$500.00 CAD/month x12 payments',
      50000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYpPwmHNsdfML2kwZvI5q',
      'plink_1TkrYpPwmHNsdfMLOzYalvGO',
      'https://buy.stripe.com/8x2fZj2tI4R5ghB28V0co0R',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-MONTHLY-06: Jared James Fit Coaching — 6 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYqPwmHNsdfML026wzZ7O') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '9948467c-53cf-49f6-a09e-e961cfb804cc',
      'Jared James Fit Coaching — 6 Monthly Payments',
      '$650.00 CAD/month x6 payments',
      65000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYqPwmHNsdfML026wzZ7O',
      'plink_1TkrYqPwmHNsdfML608WfURR',
      'https://buy.stripe.com/7sY14p3xM97le9teVH0co0S',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-MONTHLY-03: Jared James Fit Coaching — 3 Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYrPwmHNsdfMLHLJqwJED') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '616ee284-37d8-4ed7-aceb-bbca38e9b144',
      'Jared James Fit Coaching — 3 Monthly Payments',
      '$750.00 CAD/month x3 payments',
      75000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYrPwmHNsdfMLHLJqwJED',
      'plink_1TkrYrPwmHNsdfML3PjcaeOr',
      'https://buy.stripe.com/dRm9AVc4i83h4yT7tf0co0T',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-TWICE-12: Jared James Fit Coaching — 24 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYsPwmHNsdfMLXkXXXAor') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '8c347c00-111c-4a0c-9d0e-a228a9c68085',
      'Jared James Fit Coaching — 24 Twice-Monthly Payments',
      '$250.00 CAD/month x24 payments',
      25000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYsPwmHNsdfMLXkXXXAor',
      'plink_1TkrYsPwmHNsdfMLv36aZkeo',
      'https://buy.stripe.com/bJecN75FUabp2qL00N0co0U',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-TWICE-06: Jared James Fit Coaching — 12 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYtPwmHNsdfMLB22h35qL') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '09f0aabe-1edd-4864-9592-8599b06eaad8',
      'Jared James Fit Coaching — 12 Twice-Monthly Payments',
      '$325.00 CAD/month x12 payments',
      32500,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYtPwmHNsdfMLB22h35qL',
      'plink_1TkrYtPwmHNsdfMLpV8nz2aj',
      'https://buy.stripe.com/eVq3cx1pE0AP1mHfZL0co0V',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-TWICE-03: Jared James Fit Coaching — 6 Twice-Monthly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYtPwmHNsdfMLeW2qrGi1') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'd22d20c9-4c2a-4a42-ba41-67f36e9afeba',
      'Jared James Fit Coaching — 6 Twice-Monthly Payments',
      '$375.00 CAD/month x6 payments',
      37500,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYtPwmHNsdfMLeW2qrGi1',
      'plink_1TkrYuPwmHNsdfMLG7N1iXuU',
      'https://buy.stripe.com/aFa14p1pEerFc1l8xj0co0W',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PROGRAM-PIF: 12 Week Training Program — Paid in Full
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYuPwmHNsdfMLnAFS40bq') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'e8ba20b1-7a43-499f-a425-407a9c320b38',
      '12 Week Training Program — Paid in Full',
      '$999.00 CAD',
      99900,
      'cad',
      'prod_UkMHIcc8W3gsu0',
      'price_1TkrYuPwmHNsdfMLnAFS40bq',
      'plink_1TkrYvPwmHNsdfML6gJzTCNw',
      'https://buy.stripe.com/cNi7sNecq4R5c1l3cZ0co0X',
      'Custom Training Program',
      'One-time payment',
      'payment',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PROGRAM-PLAN: 12 Week Training Program — 3-Payment Plan
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYvPwmHNsdfMLaHQDg0BT') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '13ab7fbc-02dc-41fd-90a7-09c27732a884',
      '12 Week Training Program — 3-Payment Plan',
      '$399.00 CAD/month x3 payments',
      39900,
      'cad',
      'prod_UkMHIcc8W3gsu0',
      'price_1TkrYvPwmHNsdfMLaHQDg0BT',
      'plink_1TkrYwPwmHNsdfMLATnUSFl8',
      'https://buy.stripe.com/fZu4gB9Wa3N1aXh28V0co0Y',
      'Custom Training Program',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- APP-MONTHLY: Jared James Fit Training App — Monthly
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYwPwmHNsdfMLKMACjBFe') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '5013947c-fdcf-40c5-a227-bb84348f6604',
      'Jared James Fit Training App — Monthly',
      '$29.00 USD/month',
      2900,
      'usd',
      'prod_UkMHceEBfLzMHw',
      'price_1TkrYwPwmHNsdfMLKMACjBFe',
      'plink_1TkrYxPwmHNsdfMLnuc2jC2o',
      'https://buy.stripe.com/eVq9AVecq0AP4yTeVH0co0Z',
      'Digital Product',
      'Monthly recurring',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

END $$;