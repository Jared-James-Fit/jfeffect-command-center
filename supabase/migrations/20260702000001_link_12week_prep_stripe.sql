-- Link Stripe product/price/payment link to the "Online Coaching — 12 Week Prep" product
-- Stripe Product ID: prod_UoUgXLSnCMfK6u
-- Stripe Price ID: price_1Torh5PwmHNsdfMLs2oJURzn
-- Payment Link ID: plink_1Torh6PwmHNsdfMLbxkRzjXF
-- Payment Link URL: https://buy.stripe.com/dRm00l7O22IXfdx4h30co1I
-- Price: $1,400 CAD one-time, tax_behavior=exclusive, automatic_tax=true

UPDATE coaching_products
SET
  stripe_product_id = 'prod_UoUgXLSnCMfK6u',
  stripe_price_id = 'price_1Torh5PwmHNsdfMLs2oJURzn',
  stripe_payment_link_id = 'plink_1Torh6PwmHNsdfMLbxkRzjXF',
  payment_link_url = 'https://buy.stripe.com/dRm00l7O22IXfdx4h30co1I',
  price_cad = 1400.00,
  payment_structure = 'one_time',
  checkout_mode = 'payment',
  status = 'active',
  auto_create_stripe = true,
  tax_behavior = 'exclusive'
WHERE name = 'Online Coaching — 12 Week Prep'
  AND (stripe_price_id IS NULL OR stripe_price_id = '');
