-- Mirror the two existing legacy Stripe recurring prices into the PWA catalogue.
-- This migration is idempotent and does not create, cancel, or charge any Stripe subscription.

update public.coaching_products
set
  name = 'Online Coaching — Legacy $130',
  description = 'Legacy recurring online coaching rate.',
  price_cents = 13000,
  currency = 'cad',
  stripe_product_id = 'prod_UnkP9FIgR1l51h',
  product_type = 'Online Coaching',
  payment_structure = 'Monthly',
  status = 'Active',
  active = true,
  mode = 'subscription',
  is_one_off = false,
  updated_at = now()
where stripe_price_id = 'price_1To8ukPwmHNsdfMLcFYn9sWr';

insert into public.coaching_products (
  name,
  description,
  price_cents,
  currency,
  stripe_product_id,
  stripe_price_id,
  product_type,
  payment_structure,
  status,
  active,
  mode,
  is_one_off
)
select
  'Online Coaching — Legacy $130',
  'Legacy recurring online coaching rate.',
  13000,
  'cad',
  'prod_UnkP9FIgR1l51h',
  'price_1To8ukPwmHNsdfMLcFYn9sWr',
  'Online Coaching',
  'Monthly',
  'Active',
  true,
  'subscription',
  false
where not exists (
  select 1
  from public.coaching_products
  where stripe_price_id = 'price_1To8ukPwmHNsdfMLcFYn9sWr'
);

update public.coaching_products
set
  name = 'Online Coaching — Legacy $65',
  description = 'Legacy recurring online coaching rate.',
  price_cents = 6500,
  currency = 'cad',
  stripe_product_id = 'prod_UnkPAdWy2tjBqH',
  product_type = 'Online Coaching',
  payment_structure = 'Monthly',
  status = 'Active',
  active = true,
  mode = 'subscription',
  is_one_off = false,
  updated_at = now()
where stripe_price_id = 'price_1To8ulPwmHNsdfML4rglQdWX';

insert into public.coaching_products (
  name,
  description,
  price_cents,
  currency,
  stripe_product_id,
  stripe_price_id,
  product_type,
  payment_structure,
  status,
  active,
  mode,
  is_one_off
)
select
  'Online Coaching — Legacy $65',
  'Legacy recurring online coaching rate.',
  6500,
  'cad',
  'prod_UnkPAdWy2tjBqH',
  'price_1To8ulPwmHNsdfML4rglQdWX',
  'Online Coaching',
  'Monthly',
  'Active',
  true,
  'subscription',
  false
where not exists (
  select 1
  from public.coaching_products
  where stripe_price_id = 'price_1To8ulPwmHNsdfML4rglQdWX'
);
