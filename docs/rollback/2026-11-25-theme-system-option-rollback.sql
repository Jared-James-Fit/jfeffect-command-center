-- Back to light / dark only. Anyone who picked System is put on light first
-- (the old constraint would refuse the row), so run this only if you must.
update public.user_preferences set theme = 'light' where theme = 'system';
alter table public.user_preferences drop constraint if exists user_preferences_theme_check;
alter table public.user_preferences
  add constraint user_preferences_theme_check check (theme in ('light', 'dark'));
