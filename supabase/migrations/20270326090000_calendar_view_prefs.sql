-- The coach's calendar choices on their account (src/lib/calendar-prefs.ts):
-- the Calendar page's view, the Home card's view and Coaching vs + Google,
-- so they follow them across devices. Own row only.
--
-- Its own table rather than a column on user_preferences: a new row there
-- carries a default theme and could flip someone's dark mode.

create table if not exists public.calendar_view_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.calendar_view_prefs enable row level security;

drop policy if exists "Own calendar prefs - read" on public.calendar_view_prefs;
create policy "Own calendar prefs - read" on public.calendar_view_prefs
  for select using (user_id = (select auth.uid()));

drop policy if exists "Own calendar prefs - insert" on public.calendar_view_prefs;
create policy "Own calendar prefs - insert" on public.calendar_view_prefs
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "Own calendar prefs - update" on public.calendar_view_prefs;
create policy "Own calendar prefs - update" on public.calendar_view_prefs
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.calendar_view_prefs is
  'Calendar view choices per account (Calendar page view, Home card view, Google on/off). Written by the app; own row only.';
