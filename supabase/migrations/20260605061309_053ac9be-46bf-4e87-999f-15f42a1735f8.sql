create table public.coaching_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  details text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'usd',
  image_url text,
  stripe_product_id text,
  stripe_price_id text,
  stripe_payment_link_id text,
  payment_link_url text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.coaching_products to authenticated;
grant all on public.coaching_products to service_role;

alter table public.coaching_products enable row level security;

create policy "admins manage coaching products"
  on public.coaching_products
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

create trigger coaching_products_set_updated_at
  before update on public.coaching_products
  for each row execute function public.tg_set_updated_at();