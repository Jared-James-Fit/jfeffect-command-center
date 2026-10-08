-- Taxes & Books (Sales hub) and Summer Ledger, the bookkeeping assistant.
--
-- Revenue and GST/HST collected already live in payment_ledger. This adds the
-- other half of the books:
--   * business_expenses       what the business spent, with GST/HST paid (ITCs)
--                             and a photo/PDF of the receipt
--   * business_tax_payments   GST/HST remittances and income tax instalments
--                             already paid, so "what I owe" is net of them
--   * business_tax_settings   one row: province, GST number, filing frequency
--   * summer_messages         the assistant's chat history, per admin
--   * business-receipts       private storage bucket for receipt files
--
-- Everything is admin only. Business finances are the owner's, so coach,
-- sales and support accounts get no access even though they can see clients.

create table if not exists public.business_tax_settings (
  id boolean primary key default true check (id),
  business_name text not null default 'Jared James Fit',
  province text not null default 'MB',
  business_structure text not null default 'sole_proprietor'
    check (business_structure in ('sole_proprietor', 'corporation')),
  gst_registered boolean not null default true,
  gst_number text,
  gst_filing_frequency text not null default 'annual'
    check (gst_filing_frequency in ('monthly', 'quarterly', 'annual')),
  -- Employment or other income, so the estimate uses the right tax bracket.
  other_income_annual_minor bigint not null default 0 check (other_income_annual_minor >= 0),
  accountant_name text,
  notes text,
  stripe_fees_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.business_tax_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  vendor text,
  description text,
  category text not null default 'uncategorized',
  -- Total paid, tax included, and the GST/HST portion of it (input tax credit).
  amount_minor bigint not null check (amount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  currency text not null default 'CAD',
  payment_method text,
  business_use_pct numeric(5, 2) not null default 100 check (business_use_pct between 0 and 100),
  receipt_path text,
  receipt_mime text,
  status text not null default 'reviewed' check (status in ('needs_review', 'reviewed')),
  source text not null default 'manual' check (source in ('manual', 'receipt', 'stripe_fees')),
  -- Stable key for rows the app writes itself (monthly Stripe fees), so a
  -- re-sync updates instead of duplicating.
  external_key text unique,
  ai_summary jsonb,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_expenses_tax_le_amount check (tax_minor <= amount_minor)
);

create index if not exists business_expenses_date_idx on public.business_expenses (expense_date desc);
create index if not exists business_expenses_status_idx on public.business_expenses (status) where status = 'needs_review';

drop trigger if exists business_expenses_updated_at on public.business_expenses;
create trigger business_expenses_updated_at
  before update on public.business_expenses
  for each row execute function public.update_updated_at_column();

create table if not exists public.business_tax_payments (
  id uuid primary key default gen_random_uuid(),
  paid_on date not null default current_date,
  kind text not null check (kind in ('gst_hst', 'income_tax')),
  tax_year integer not null check (tax_year between 2000 and 2100),
  period_label text,
  amount_minor bigint not null check (amount_minor > 0),
  reference text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists business_tax_payments_year_idx on public.business_tax_payments (tax_year, kind);

create table if not exists public.summer_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists summer_messages_user_idx on public.summer_messages (user_id, created_at desc);

alter table public.business_tax_settings enable row level security;
alter table public.business_expenses enable row level security;
alter table public.business_tax_payments enable row level security;
alter table public.summer_messages enable row level security;

drop policy if exists "admin manage tax settings" on public.business_tax_settings;
create policy "admin manage tax settings" on public.business_tax_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "admin manage expenses" on public.business_expenses;
create policy "admin manage expenses" on public.business_expenses
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "admin manage tax payments" on public.business_tax_payments;
create policy "admin manage tax payments" on public.business_tax_payments
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "admin own summer messages" on public.summer_messages;
create policy "admin own summer messages" on public.summer_messages
  for all to authenticated
  using (user_id = auth.uid() and public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (user_id = auth.uid() and public.has_role(auth.uid(), 'admin'::public.app_role));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-receipts', 'business-receipts', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "business receipts admin read" on storage.objects;
create policy "business receipts admin read" on storage.objects for select to authenticated
  using (bucket_id = 'business-receipts' and public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "business receipts admin insert" on storage.objects;
create policy "business receipts admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'business-receipts' and public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "business receipts admin update" on storage.objects;
create policy "business receipts admin update" on storage.objects for update to authenticated
  using (bucket_id = 'business-receipts' and public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "business receipts admin delete" on storage.objects;
create policy "business receipts admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'business-receipts' and public.has_role(auth.uid(), 'admin'::public.app_role));

-- GST/HST that Stripe collected but older sync paths saved as 0 (the
-- checkout sync never copied total_details.amount_tax). Amounts verified
-- against each Stripe Checkout Session. Only fills rows still at 0.
update public.payment_ledger pl
   set tax_minor = v.tax_minor
  from (values
    ('f81daf11-9c04-4516-9b58-4918c786034d'::uuid, 6500::bigint),
    ('bd796283-e495-4f36-8c63-24cd9ed57d0e'::uuid, 650::bigint),
    ('ee7864d2-a632-40c8-be78-63f1c9fb796d'::uuid, 2000::bigint)
  ) as v(id, tax_minor)
 where pl.id = v.id and pl.tax_minor = 0;

notify pgrst, 'reload schema';
