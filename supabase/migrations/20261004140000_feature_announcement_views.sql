-- One-time "What's new" feature announcements (e.g. the dark-mode toggle).
-- Seen state is server-side so an announcement never replays across devices.
create table if not exists public.feature_announcement_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, feature_key)
);

alter table public.feature_announcement_views enable row level security;

drop policy if exists "Own announcement views - read" on public.feature_announcement_views;
create policy "Own announcement views - read"
  on public.feature_announcement_views for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Own announcement views - insert" on public.feature_announcement_views;
create policy "Own announcement views - insert"
  on public.feature_announcement_views for insert
  to authenticated
  with check (user_id = auth.uid());

grant select, insert on public.feature_announcement_views to authenticated;
