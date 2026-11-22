-- A person's default photo / video filter for Crew posts and stories
-- (src/lib/media-filter-prefs.ts): the filter, its strength and any
-- adjustments they saved with "Save as default", one for posts and one for
-- stories, on their account so it follows them to every device. Applied to
-- new media in the post composer and the story camera only (never progress
-- check-ins). Changing one post's filter never touches it. Own row only.

create table if not exists public.media_filter_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.media_filter_prefs enable row level security;

drop policy if exists "Own media filter prefs - read" on public.media_filter_prefs;
create policy "Own media filter prefs - read" on public.media_filter_prefs
  for select using (user_id = (select auth.uid()));

drop policy if exists "Own media filter prefs - insert" on public.media_filter_prefs;
create policy "Own media filter prefs - insert" on public.media_filter_prefs
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "Own media filter prefs - update" on public.media_filter_prefs;
create policy "Own media filter prefs - update" on public.media_filter_prefs
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update on public.media_filter_prefs to authenticated;

comment on table public.media_filter_prefs is
  'Default photo / video filter per account for Crew posts and stories ({post, story}: filter, intensity, adjust). Written by the app; own row only.';
