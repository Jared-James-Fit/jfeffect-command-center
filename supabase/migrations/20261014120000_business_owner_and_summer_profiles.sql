-- A second admin (Fionna) is coming. Admins share the app, but the books are
-- the owner's: Taxes & Books, expenses, receipts, tax payments and the tax
-- settings (which hold the owner's other income) move from "any admin" to
-- "the business owner". Summer's personality becomes per person, so each
-- admin tunes their own.

create table if not exists public.business_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.business_owners enable row level security;

drop policy if exists "owners read own row" on public.business_owners;
create policy "owners read own row" on public.business_owners
  for select to authenticated
  using (user_id = auth.uid());

-- Today's admins are the owners (just Jared). Admins added later are not.
insert into public.business_owners (user_id)
select user_id from public.user_roles where role = 'admin'::public.app_role
on conflict (user_id) do nothing;

create or replace function public.is_business_owner(_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.business_owners where user_id = _uid);
$$;

revoke all on function public.is_business_owner(uuid) from public, anon;
grant execute on function public.is_business_owner(uuid) to authenticated, service_role;

-- Books: owner only.
drop policy if exists "admin manage tax settings" on public.business_tax_settings;
drop policy if exists "owner manage tax settings" on public.business_tax_settings;
create policy "owner manage tax settings" on public.business_tax_settings
  for all to authenticated
  using (public.is_business_owner(auth.uid()))
  with check (public.is_business_owner(auth.uid()));

drop policy if exists "admin manage expenses" on public.business_expenses;
drop policy if exists "owner manage expenses" on public.business_expenses;
create policy "owner manage expenses" on public.business_expenses
  for all to authenticated
  using (public.is_business_owner(auth.uid()))
  with check (public.is_business_owner(auth.uid()));

drop policy if exists "admin manage tax payments" on public.business_tax_payments;
drop policy if exists "owner manage tax payments" on public.business_tax_payments;
create policy "owner manage tax payments" on public.business_tax_payments
  for all to authenticated
  using (public.is_business_owner(auth.uid()))
  with check (public.is_business_owner(auth.uid()));

drop policy if exists "business receipts admin read" on storage.objects;
drop policy if exists "business receipts admin insert" on storage.objects;
drop policy if exists "business receipts admin update" on storage.objects;
drop policy if exists "business receipts admin delete" on storage.objects;
drop policy if exists "business receipts owner read" on storage.objects;
drop policy if exists "business receipts owner insert" on storage.objects;
drop policy if exists "business receipts owner update" on storage.objects;
drop policy if exists "business receipts owner delete" on storage.objects;
create policy "business receipts owner read" on storage.objects for select to authenticated
  using (bucket_id = 'business-receipts' and public.is_business_owner(auth.uid()));
create policy "business receipts owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'business-receipts' and public.is_business_owner(auth.uid()));
create policy "business receipts owner update" on storage.objects for update to authenticated
  using (bucket_id = 'business-receipts' and public.is_business_owner(auth.uid()));
create policy "business receipts owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'business-receipts' and public.is_business_owner(auth.uid()));

-- Summer's personality, per admin.
create table if not exists public.summer_profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  tone text not null default 'girly_pop' check (tone in ('girly_pop', 'chill', 'professional')),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  updated_at timestamptz not null default now()
);

alter table public.summer_profiles enable row level security;

drop policy if exists "admin own summer profile" on public.summer_profiles;
create policy "admin own summer profile" on public.summer_profiles
  for all to authenticated
  using (user_id = auth.uid() and public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (user_id = auth.uid() and public.has_role(auth.uid(), 'admin'::public.app_role));

-- Keep the owner's current Summer settings.
insert into public.summer_profiles (user_id, tone, instructions)
select o.user_id, coalesce(s.assistant_tone, 'girly_pop'), s.assistant_instructions
from public.business_owners o
cross join (select assistant_tone, assistant_instructions from public.business_tax_settings limit 1) s
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
