-- Seed the three pending legacy coaching sale intents that were intended to be
-- visible on the client profile Sales tab.
--
-- This migration only creates purchase_records rows in the JF Effect database.
-- It does NOT create a Stripe Checkout Session, charge, invoice, customer, or
-- subscription. A later admin payment-link action can safely reuse these rows.
--
-- Idempotency: if a current (non-archived) sale for the same client + product
-- already exists, this migration leaves it untouched.

with desired_sales (
  client_label,
  primary_full_name,
  alternate_full_name,
  first_name,
  last_name,
  stripe_price_id
) as (
  values
    (
      'Reece Robinson',
      'Reece Robinson',
      null::text,
      'Reece',
      'Robinson',
      'price_1To8ulPwmHNsdfML4rglQdWX'
    ),
    (
      'Nicole Yusi',
      'Nicole Yusi',
      null::text,
      'Nicole',
      'Yusi',
      'price_1To8ukPwmHNsdfMLcFYn9sWr'
    ),
    (
      'Amanda Burg',
      'Amanda Burg',
      'Alyssa Amanda Burg',
      'Amanda',
      'Burg',
      'price_1To8ukPwmHNsdfMLcFYn9sWr'
    )
),
resolved_clients as (
  -- Resolve exactly one client row for each intended person. Exact full-name
  -- matches win; Amanda's known alternate full name / preferred name are
  -- supported so this remains safe across the existing profile naming.
  select
    d.client_label,
    d.stripe_price_id,
    matched.client_id
  from desired_sales d
  join lateral (
    select c.id as client_id
    from public.clients c
    where
      lower(trim(coalesce(c.full_name, ''))) = lower(d.primary_full_name)
      or (
        d.alternate_full_name is not null
        and lower(trim(coalesce(c.full_name, ''))) = lower(d.alternate_full_name)
      )
      or (
        lower(trim(coalesce(c.last_name, ''))) = lower(d.last_name)
        and (
          lower(trim(coalesce(c.first_name, ''))) = lower(d.first_name)
          or lower(trim(coalesce(c.preferred_name, ''))) = lower(d.first_name)
        )
      )
    order by
      case
        when lower(trim(coalesce(c.full_name, ''))) = lower(d.primary_full_name) then 0
        when d.alternate_full_name is not null
          and lower(trim(coalesce(c.full_name, ''))) = lower(d.alternate_full_name) then 1
        else 2
      end,
      c.id
    limit 1
  ) matched on true
),
targets as (
  select
    rc.client_label,
    rc.client_id,
    p.id as offer_id,
    p.name as offer_name,
    p.payment_structure,
    p.price_cents,
    p.currency,
    p.stripe_price_id,
    p.stripe_product_id
  from resolved_clients rc
  join public.coaching_products p
    on p.stripe_price_id = rc.stripe_price_id
)
insert into public.purchase_records (
  client_id,
  offer_id,
  offer_name,
  payment_structure,
  full_payable_amount,
  currency,
  stripe_price_id,
  stripe_product_id,
  payment_status,
  service_status,
  last_payment_update_source,
  last_payment_update_at
)
select
  t.client_id,
  t.offer_id,
  t.offer_name,
  t.payment_structure,
  t.price_cents / 100.0,
  upper(coalesce(t.currency, 'cad')),
  t.stripe_price_id,
  t.stripe_product_id,
  'Pending',
  'Pending',
  'legacy_client_sale_seed',
  now()
from targets t
where not exists (
  select 1
  from public.purchase_records pr
  where pr.client_id = t.client_id
    and pr.offer_id = t.offer_id
    and pr.archived_at is null
);
