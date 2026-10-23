-- When each saved nutrition plan day is used, set by the coach.
--
-- A plan's days ("Training Day", "Training Day (Friday Only)", "Rest Day")
-- were matched to a date by their name alone, so a Friday-only training day
-- lost to the first "Training Day" on every Friday. Each day now says what
-- it's for:
--   use_on    training | rest | high | every_day | manual (only when the
--             client picks it). NULL = read from the day's name.
--   weekdays  the weekdays it's limited to ('{}' = any day). NULL = read
--             from the day's name ("(Friday Only)" = {Friday}).
-- The app picks a date's day with one rule (pickPlanDayForDate,
-- client-nutrition-day.ts): a day for this weekday beats one for any day,
-- and one for this kind of day beats an every-day one. Existing rows stay
-- NULL, so they keep following their names until the coach sets them.

ALTER TABLE public.nutrition_target_days
  ADD COLUMN IF NOT EXISTS use_on text,
  ADD COLUMN IF NOT EXISTS weekdays text[];

ALTER TABLE public.nutrition_target_days
  DROP CONSTRAINT IF EXISTS nutrition_target_days_use_on_check,
  ADD CONSTRAINT nutrition_target_days_use_on_check
    CHECK (use_on IS NULL OR use_on IN ('training', 'rest', 'high', 'every_day', 'manual')),
  DROP CONSTRAINT IF EXISTS nutrition_target_days_weekdays_check,
  ADD CONSTRAINT nutrition_target_days_weekdays_check
    CHECK (weekdays IS NULL OR weekdays <@ ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']::text[]);

COMMENT ON COLUMN public.nutrition_target_days.use_on IS
  'training | rest | high | every_day | manual (only when the client picks it). NULL = read from day_label.';
COMMENT ON COLUMN public.nutrition_target_days.weekdays IS
  'Weekdays this plan day is limited to (''{}'' = any day). NULL = read from day_label.';
