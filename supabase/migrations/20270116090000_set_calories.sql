-- Calories a cardio set burned (the treadmill's or the watch's number), typed
-- in the workout logger's optional Cal box. Never needed for a set to count
-- as done: a timed set completes on its time. Whole calories, 0–5000.
ALTER TABLE public.pl_row_results ADD COLUMN IF NOT EXISTS actual_calories integer;
ALTER TABLE public.pl_row_results DROP CONSTRAINT IF EXISTS pl_row_results_actual_calories_range;
ALTER TABLE public.pl_row_results ADD CONSTRAINT pl_row_results_actual_calories_range
  CHECK (actual_calories IS NULL OR (actual_calories >= 0 AND actual_calories <= 5000));
