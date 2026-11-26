-- Appearance now has a third choice, System (follow the device's light / dark
-- setting). The saved choice may be 'light', 'dark' or 'system'.
--
-- Additive only: no row is inserted, updated or deleted, so every existing
-- person's saved choice stays exactly as it is. The column keeps its 'light'
-- default for a row written by an older app; the app never creates a row for
-- someone who hasn't chosen (an account with no row uses its own default:
-- light for one made before dark became the default, dark for a new one).
alter table public.user_preferences drop constraint if exists user_preferences_theme_check;
alter table public.user_preferences
  add constraint user_preferences_theme_check check (theme in ('light', 'dark', 'system'));
