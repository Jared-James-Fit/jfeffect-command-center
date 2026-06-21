-- ============================================================
-- Migration: Insert JF Effect Stripe Catalogue v3
-- Corrected from actual price cards:
-- - Training App: $59 CAD/month + $499 CAD/year
-- - 12 Week Program: $999 PIF + 3x$399
-- - All prices: tax_behavior=exclusive, auto_tax=enabled
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
      'c1e57e41-1d54-4ac2-b25a-eb1c8325b8b0',
      '1 In-Person Training Session',
      '$100.00 CAD',
      10000,
      'cad',
      'prod_UkMGUUFYBPj4Wx',
      'price_1TkrXlPwmHNsdfMLnNUPAOXM',
      'plink_1Tkt8VPwmHNsdfMLnxQ7byMq',
      'https://buy.stripe.com/5kQ5kF8S683hc1l5l70co11',
      'In-Person Personal Training',
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
      'a2deb49e-fb80-4547-a7d6-d32017d37f2d',
      'Foundation Membership — 1x/Week',
      '$390.00 CAD/month',
      39000,
      'cad',
      'prod_UkMGWHu7Jl8Rrx',
      'price_1TkrXmPwmHNsdfML4QO6H217',
      'plink_1Tkt8WPwmHNsdfMLbEo33UMA',
      'https://buy.stripe.com/5kQ3cx5FUcjxghBeVH0co12',
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
      'd6829092-a53d-49dd-999d-76120f3d2e66',
      'Performance Membership — 2x/Week',
      '$760.00 CAD/month',
      76000,
      'cad',
      'prod_UkMG01NJ1TkeMV',
      'price_1TkrXnPwmHNsdfMLxFRHQuIf',
      'plink_1Tkt8WPwmHNsdfMLAVoJ61EZ',
      'https://buy.stripe.com/fZu28td8m97l6H1cNz0co13',
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
      '046452a2-6dba-4799-a2b5-59794ef36325',
      'Complete Membership — 3x/Week',
      '$1,110.00 CAD/month',
      111000,
      'cad',
      'prod_UkMGvO7PfUxnXD',
      'price_1TkrXoPwmHNsdfMLmuHuKvQ9',
      'plink_1Tkt8XPwmHNsdfMLlVwRPq1k',
      'https://buy.stripe.com/7sY5kFgky3N11mHdRD0co14',
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
      'db4fb8d8-ca90-4ee0-a4d9-1d0e04e104f9',
      'Private Coaching — 12 Months Paid in Full',
      '$30,000.00 CAD',
      3000000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrXpPwmHNsdfMLF8NP7eMJ',
      'plink_1Tkt8XPwmHNsdfMLIgYwCSI0',
      'https://buy.stripe.com/fZu3cx6JYgzN3uP7tf0co15',
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
      'fd7511bb-a2de-48ab-bb64-96bb0f6bb32b',
      'Private Coaching — 6 Months Paid in Full',
      '$18,000.00 CAD',
      1800000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrXqPwmHNsdfML2WHYrrYg',
      'plink_1Tkt8YPwmHNsdfMLwWwKLn6N',
      'https://buy.stripe.com/eVqaEZb0e2IX4yT8xj0co16',
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
      'd0814de0-adea-4b2f-b356-57066d459f31',
      'Private Coaching — 3 Months Paid in Full',
      '$12,000.00 CAD',
      1200000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrXrPwmHNsdfMLlB34AT5o',
      'plink_1Tkt8ZPwmHNsdfMLX3aSgDK8',
      'https://buy.stripe.com/aFabJ33xM5V98P9cNz0co17',
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
      'e7234bdb-5e7b-4d3d-bda9-4368e19c6f52',
      'Private Coaching — 12 Monthly Payments',
      '$2,500.00 CAD/month x12 payments',
      250000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYZPwmHNsdfMLYJfKpkQH',
      'plink_1Tkt8ZPwmHNsdfMLh1toiZNN',
      'https://buy.stripe.com/28EbJ3gkygzN1mH3cZ0co18',
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
      'b8230beb-5d20-484e-b4c5-f1971a628e7e',
      'Private Coaching — 6 Monthly Payments',
      '$3,000.00 CAD/month x6 payments',
      300000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYZPwmHNsdfMLNKe8ms9h',
      'plink_1Tkt8aPwmHNsdfMLfKA3Bzfv',
      'https://buy.stripe.com/bJe6oJ4BQ5V90iDdRD0co19',
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
      '31f5f8ff-fe78-4782-89ba-7e74d189dec4',
      'Private Coaching — 3 Monthly Payments',
      '$4,000.00 CAD/month x3 payments',
      400000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYaPwmHNsdfMLIBsT0IPL',
      'plink_1Tkt8aPwmHNsdfMLWJAlsilj',
      'https://buy.stripe.com/bJe28t5FUgzN4yTeVH0co1a',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-BIWEEKLY-12: Private Coaching — 24 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYbPwmHNsdfMLQidL91Pt') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'c4cdb52a-5ada-4b17-8417-4bc5e61413ef',
      'Private Coaching — 24 Bi-Weekly Payments',
      '$1,250.00 CAD/month x24 payments',
      125000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYbPwmHNsdfMLQidL91Pt',
      'plink_1Tkt8bPwmHNsdfML28aVwulk',
      'https://buy.stripe.com/8x2eVfecq3N10iD00N0co1b',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-BIWEEKLY-06: Private Coaching — 12 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYcPwmHNsdfMLOiWJcVm7') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '1e8ee6ed-0e4e-490e-81b3-8518db7f4591',
      'Private Coaching — 12 Bi-Weekly Payments',
      '$1,500.00 CAD/month x12 payments',
      150000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYcPwmHNsdfMLOiWJcVm7',
      'plink_1Tkt8bPwmHNsdfMLh18s4MdS',
      'https://buy.stripe.com/7sY6oJ2tIgzNd5pfZL0co1c',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- PC-BIWEEKLY-03: Private Coaching — 6 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYdPwmHNsdfMLXavPsJD2') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '7635e2b1-5fe6-499b-95d6-6f17f90e5d60',
      'Private Coaching — 6 Bi-Weekly Payments',
      '$2,000.00 CAD/month x6 payments',
      200000,
      'cad',
      'prod_UkMGmYghOJxhuZ',
      'price_1TkrYdPwmHNsdfMLXavPsJD2',
      'plink_1Tkt8cPwmHNsdfMLK9DTbgNW',
      'https://buy.stripe.com/28EfZjecqabpe9t14R0co1d',
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
      'ca5c1252-1680-4368-a6e2-e302151f47e1',
      'Coaching Plus — 12 Months Paid in Full',
      '$10,000.00 CAD',
      1000000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYePwmHNsdfMLthVvZdHp',
      'plink_1Tkt8cPwmHNsdfMLP9W0svmO',
      'https://buy.stripe.com/9B66oJ0lA83hd5p00N0co1e',
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
      '75983a17-8a99-44d3-ba5b-debe731baf0b',
      'Coaching Plus — 6 Months Paid in Full',
      '$7,000.00 CAD',
      700000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYfPwmHNsdfMLi4ueb50y',
      'plink_1Tkt8dPwmHNsdfMLHphTyzV6',
      'https://buy.stripe.com/eVq6oJc4i1ET6H13cZ0co1f',
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
      'c99ab0b4-a535-40fc-9d3f-2d4ce9045a95',
      'Coaching Plus — 3 Months Paid in Full',
      '$4,000.00 CAD',
      400000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYgPwmHNsdfMLOxGGpJms',
      'plink_1Tkt8dPwmHNsdfMLvjHDtAjY',
      'https://buy.stripe.com/28EfZj2tIabpd5p9Bn0co1g',
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
      '7f7bdf20-5760-4920-934a-38fa955d3fe1',
      'Coaching Plus — 12 Monthly Payments',
      '$1,000.00 CAD/month x12 payments',
      100000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYhPwmHNsdfMLwyJudSYt',
      'plink_1Tkt8ePwmHNsdfMLT8k63u2K',
      'https://buy.stripe.com/8x2eVf3xMdnB8P928V0co1h',
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
      '43aa0fef-db65-4788-8a3c-ffe05d88af32',
      'Coaching Plus — 6 Monthly Payments',
      '$1,300.00 CAD/month x6 payments',
      130000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYiPwmHNsdfMLVFl3sSha',
      'plink_1Tkt8fPwmHNsdfML1AFHiYFu',
      'https://buy.stripe.com/9B69AVfgufvJ4yT7tf0co1i',
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
      '271c425e-a3e6-40e8-b495-a47e48564e53',
      'Coaching Plus — 3 Monthly Payments',
      '$1,500.00 CAD/month x3 payments',
      150000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYjPwmHNsdfMLLZWkVheZ',
      'plink_1Tkt8fPwmHNsdfMLpx9YNaqg',
      'https://buy.stripe.com/6oU28t9Wa0APaXh3cZ0co1j',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-BIWEEKLY-12: Coaching Plus — 24 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYkPwmHNsdfML9nvlTZJq') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'da6ae004-7ece-4df9-bb68-021b46124069',
      'Coaching Plus — 24 Bi-Weekly Payments',
      '$500.00 CAD/month x24 payments',
      50000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYkPwmHNsdfML9nvlTZJq',
      'plink_1Tkt8gPwmHNsdfML2vczMRH6',
      'https://buy.stripe.com/cNi9AV4BQ6ZdaXhdRD0co1k',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-BIWEEKLY-06: Coaching Plus — 12 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYlPwmHNsdfMLfNoPpg8b') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'f0324279-35cc-40bd-8221-183efb4eecab',
      'Coaching Plus — 12 Bi-Weekly Payments',
      '$650.00 CAD/month x12 payments',
      65000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYlPwmHNsdfMLfNoPpg8b',
      'plink_1Tkt8gPwmHNsdfMLHT1IKCV9',
      'https://buy.stripe.com/7sYaEZ2tI0AP2qL00N0co1l',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- CP-BIWEEKLY-03: Coaching Plus — 6 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYlPwmHNsdfML46K415hz') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'c450423c-0232-422b-970d-77faf3fb01a7',
      'Coaching Plus — 6 Bi-Weekly Payments',
      '$750.00 CAD/month x6 payments',
      75000,
      'cad',
      'prod_UkMHiom0gY1LF0',
      'price_1TkrYlPwmHNsdfML46K415hz',
      'plink_1Tkt8hPwmHNsdfML28FN84JG',
      'https://buy.stripe.com/00w5kFc4iabp0iD28V0co1m',
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
      '014c91e4-d5bd-44c2-8e28-8afa58bcf7ef',
      'Jared James Fit Coaching — 12 Months Paid in Full',
      '$5,000.00 CAD',
      500000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYmPwmHNsdfMLcr7BadIE',
      'plink_1Tkt8iPwmHNsdfMLhqbOO4M3',
      'https://buy.stripe.com/dRmcN79Wa4R52qL3cZ0co1n',
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
      'bf2f433c-3366-400f-bf68-11fdb7124d1f',
      'Jared James Fit Coaching — 6 Months Paid in Full',
      '$3,500.00 CAD',
      350000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYnPwmHNsdfML7qhXDdBq',
      'plink_1Tkt8iPwmHNsdfMLI0dQvxVb',
      'https://buy.stripe.com/eVq5kF2tIcjxghB9Bn0co1o',
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
      '4ac147df-3119-4603-beb5-e676b4872ff5',
      'Jared James Fit Coaching — 3 Months Paid in Full',
      '$2,000.00 CAD',
      200000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYoPwmHNsdfMLHB80r3zt',
      'plink_1Tkt8jPwmHNsdfMLCYTGhXKB',
      'https://buy.stripe.com/cNicN7ecq5V94yTfZL0co1p',
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
      '986e7c80-4cbf-4f1a-91fb-1364226bbbe9',
      'Jared James Fit Coaching — 12 Monthly Payments',
      '$500.00 CAD/month x12 payments',
      50000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYpPwmHNsdfML2kwZvI5q',
      'plink_1Tkt8jPwmHNsdfMLRo7gnGxr',
      'https://buy.stripe.com/7sY5kFb0e0APc1l14R0co1q',
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
      '105de5cc-f325-4756-a608-a6c2da921c69',
      'Jared James Fit Coaching — 6 Monthly Payments',
      '$650.00 CAD/month x6 payments',
      65000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYqPwmHNsdfML026wzZ7O',
      'plink_1Tkt8kPwmHNsdfMLT5HjnnRP',
      'https://buy.stripe.com/cNi4gBecq0AP5CXaFr0co1r',
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
      '155d2018-9935-4b2c-be83-112ad682e6cd',
      'Jared James Fit Coaching — 3 Monthly Payments',
      '$750.00 CAD/month x3 payments',
      75000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYrPwmHNsdfMLHLJqwJED',
      'plink_1Tkt8kPwmHNsdfMLGA5MhIIs',
      'https://buy.stripe.com/28EeVfb0ecjx2qLbJv0co1s',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-BIWEEKLY-12: Jared James Fit Coaching — 24 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYsPwmHNsdfMLXkXXXAor') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '5bd2a221-9923-4a34-9e6f-25ba771f6285',
      'Jared James Fit Coaching — 24 Bi-Weekly Payments',
      '$250.00 CAD/month x24 payments',
      25000,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYsPwmHNsdfMLXkXXXAor',
      'plink_1Tkt8lPwmHNsdfMLOvM6CzFB',
      'https://buy.stripe.com/28E00lgky0AP7L500N0co1t',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-BIWEEKLY-06: Jared James Fit Coaching — 12 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYtPwmHNsdfMLB22h35qL') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '4bc76c55-4ee2-4365-aea5-01f1871ec2ff',
      'Jared James Fit Coaching — 12 Bi-Weekly Payments',
      '$325.00 CAD/month x12 payments',
      32500,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYtPwmHNsdfMLB22h35qL',
      'plink_1Tkt8lPwmHNsdfML21jX6Wyy',
      'https://buy.stripe.com/cNifZjd8mfvJ7L528V0co1u',
      'Online Coaching',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- JJF-BIWEEKLY-03: Jared James Fit Coaching — 6 Bi-Weekly Payments
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1TkrYtPwmHNsdfMLeW2qrGi1') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'b58fe88e-402c-4f51-b1bf-78768cd4ac84',
      'Jared James Fit Coaching — 6 Bi-Weekly Payments',
      '$375.00 CAD/month x6 payments',
      37500,
      'cad',
      'prod_UeqGAvKzjrzfwa',
      'price_1TkrYtPwmHNsdfMLeW2qrGi1',
      'plink_1Tkt8mPwmHNsdfMLc04D9lkq',
      'https://buy.stripe.com/eVq14p1pEgzNd5p7tf0co1v',
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
      '3d08a2d9-aeac-4b71-b237-701435785eea',
      '12 Week Training Program — Paid in Full',
      '$999.00 CAD',
      99900,
      'cad',
      'prod_UkMHIcc8W3gsu0',
      'price_1TkrYuPwmHNsdfMLnAFS40bq',
      'plink_1Tkt8mPwmHNsdfMLtqhcMkaS',
      'https://buy.stripe.com/6oU28t1pEerFfdxdRD0co1w',
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
      '27095df6-a974-4525-ad0b-c075b612e0cf',
      '12 Week Training Program — 3-Payment Plan',
      '$399.00 CAD/month x3 payments',
      39900,
      'cad',
      'prod_UkMHIcc8W3gsu0',
      'price_1TkrYvPwmHNsdfMLaHQDg0BT',
      'plink_1Tkt8nPwmHNsdfMLqx4VhSDZ',
      'https://buy.stripe.com/9B65kFfguabpd5pcNz0co1x',
      'Custom Training Program',
      'Payment plan',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- APP-MONTHLY: Jared James Fit Training App — Monthly
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1Tkt8nPwmHNsdfMLLVDRGsyW') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      'c51074a4-ad32-4cf9-b934-a5a64d63b59d',
      'Jared James Fit Training App — Monthly',
      '$59.00 CAD/month',
      5900,
      'cad',
      'prod_UkMHceEBfLzMHw',
      'price_1Tkt8nPwmHNsdfMLLVDRGsyW',
      'plink_1Tkt8oPwmHNsdfMLMZ332Tvr',
      'https://buy.stripe.com/14AdRb8S6erF2qL7tf0co1y',
      'Digital Product',
      'Monthly recurring',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

  -- APP-ANNUAL: Jared James Fit Training App — Annual
  IF NOT EXISTS (SELECT 1 FROM public.coaching_products WHERE stripe_price_id = 'price_1Tkt8oPwmHNsdfMLyDTCMuT2') THEN
    INSERT INTO public.coaching_products (
      id, name, description, price_cents, currency,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, payment_link_url,
      product_type, payment_structure, mode, status, active,
      created_at, updated_at
    ) VALUES (
      '68205420-5f27-47e5-bcd2-d6ce049e2303',
      'Jared James Fit Training App — Annual',
      '$499.00 CAD/year',
      49900,
      'cad',
      'prod_UkMHceEBfLzMHw',
      'price_1Tkt8oPwmHNsdfMLyDTCMuT2',
      'plink_1Tkt8oPwmHNsdfML8h9SsVZq',
      'https://buy.stripe.com/aFaeVfc4i5V95CX6pb0co1z',
      'Digital Product',
      'Annual recurring',
      'subscription',
      'Active',
      true,
      NOW(), NOW()
    );
  END IF;

END $$;