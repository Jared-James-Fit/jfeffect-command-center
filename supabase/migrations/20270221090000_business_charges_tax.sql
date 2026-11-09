-- Whether the business charges tax on what it sells. Every product is priced
-- before tax (Stripe prices are tax_behavior = exclusive, checkout runs Stripe
-- Tax), so while the business is GST-registered every price the app shows a
-- coach or a client reads "$130.00 + tax". business_tax_settings is the
-- owner's and finance's only, so the app reads just this yes / no.
create or replace function public.business_charges_tax()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select bool_or(gst_registered) from public.business_tax_settings), false)
$$;

revoke all on function public.business_charges_tax() from public, anon;
grant execute on function public.business_charges_tax() to authenticated;
