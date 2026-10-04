-- Per-account UI preferences. Starts with the light/dark appearance so a
-- user's choice follows them across devices, reinstalls and sign-outs until
-- they change it again.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  theme_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Own preferences - read" on public.user_preferences;
create policy "Own preferences - read"
  on public.user_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Own preferences - insert" on public.user_preferences;
create policy "Own preferences - insert"
  on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Own preferences - update" on public.user_preferences;
create policy "Own preferences - update"
  on public.user_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.user_preferences to authenticated;
