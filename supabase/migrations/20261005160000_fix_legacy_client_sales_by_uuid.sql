-- Corrective: make the three legacy coaching sales actually exist.
--
-- 20261005011500_seed_legacy_client_sales.sql (and the product seed before it)
-- were never applied in production; production applies only migrations
-- recorded through its own pipeline (history stops at 20260823185711). This
-- migration was applied to production directly and is written to be safe to
-- re-run anywhere:
--   * targets the real production client UUIDs (no name matching)
--   * no-op for a client UUID that doesn't exist in this environment
--   * never creates a second current (non-archived) sale for the same
--     client + legacy product; an existing one is corrected in place
--   * database only: no Stripe subscription, invoice, PaymentIntent,
--     Checkout Session or charge is created, changed or cancelled.
--
-- Production UUIDs (verified 2026-10-05):
--   Reece Robinson        02ffd25f-2702-4c45-b5cb-df7fa985c8d4  → Legacy $65
--   Nicole Yusi           51dfd933-e356-429f-bbfb-9dd1aeae7fda  → Legacy $130
--   Alyssa Amanda Burg    ebedfa09-9a1b-4ec5-9e99-eafc68f25cdd  → Legacy $130

-- 1) Legacy products: fill the Stripe product IDs that were never stored.
update public.coaching_products
   set stripe_product_id = 'prod_UnkP9FIgR1l51h', updated_at = now()
 where stripe_price_id = 'price_1To8ukPwmHNsdfMLcFYn9sWr'
   and stripe_product_id is distinct from 'prod_UnkP9FIgR1l51h';

update public.coaching_products
   set stripe_product_id = 'prod_UnkPAdWy2tjBqH', updated_at = now()
 where stripe_price_id = 'price_1To8ulPwmHNsdfML4rglQdWX'
   and stripe_product_id is distinct from 'prod_UnkPAdWy2tjBqH';

-- 2) One current legacy sale per client.
with desired(client_id, stripe_price_id) as (
  values
    ('02ffd25f-2702-4c45-b5cb-df7fa985c8d4'::uuid, 'price_1To8ulPwmHNsdfML4rglQdWX'),
    ('51dfd933-e356-429f-bbfb-9dd1aeae7fda'::uuid, 'price_1To8ukPwmHNsdfMLcFYn9sWr'),
    ('ebedfa09-9a1b-4ec5-9e99-eafc68f25cdd'::uuid, 'price_1To8ukPwmHNsdfMLcFYn9sWr')
),
targets as (
  select d.client_id, p.id as offer_id, p.name, p.price_cents, p.stripe_price_id
  from desired d
  join public.clients c on c.id = d.client_id
  join public.coaching_products p on p.stripe_price_id = d.stripe_price_id
),
fixed as (
  -- Correct any existing current sale for this client + product in place.
  update public.purchase_records pr
     set offer_name = t.name,
         payment_structure = 'Monthly subscription',
         payment_frequency = 'Monthly subscription',
         is_recurring = true,
         full_payable_amount = t.price_cents / 100.0,
         currency = 'CAD',
         stripe_price_id = t.stripe_price_id,
         stripe_product_id = case t.stripe_price_id
           when 'price_1To8ukPwmHNsdfMLcFYn9sWr' then 'prod_UnkP9FIgR1l51h'
           else 'prod_UnkPAdWy2tjBqH' end
    from targets t
   where pr.client_id = t.client_id
     and pr.archived_at is null
     and (pr.offer_id = t.offer_id or pr.stripe_price_id = t.stripe_price_id)
  returning pr.client_id
)
insert into public.purchase_records (
  client_id, offer_id, offer_name, payment_structure, payment_frequency,
  is_recurring, full_payable_amount, currency, stripe_price_id,
  stripe_product_id, payment_status, service_status, status, admin_notes,
  last_payment_update_source, last_payment_update_at
)
select
  t.client_id,
  t.offer_id,
  t.name,
  'Monthly subscription',
  'Monthly subscription',
  true,
  t.price_cents / 100.0,
  'CAD',
  t.stripe_price_id,
  case t.stripe_price_id
    when 'price_1To8ukPwmHNsdfMLcFYn9sWr' then 'prod_UnkP9FIgR1l51h'
    else 'prod_UnkPAdWy2tjBqH' end,
  'Pending',
  'Active',
  'Active',
  'Legacy client — existing billing may run outside the app. Check Stripe before sending a payment link so they are not billed twice.',
  'legacy_client_sale_fix',
  now()
from targets t
where t.client_id not in (select client_id from fixed)
  and not exists (
    select 1 from public.purchase_records pr
     where pr.client_id = t.client_id
       and pr.archived_at is null
       and (pr.offer_id = t.offer_id or pr.stripe_price_id = t.stripe_price_id)
  );
