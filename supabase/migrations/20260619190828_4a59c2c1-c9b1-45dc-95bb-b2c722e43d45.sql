
ALTER TABLE public.pl_exercise_rows
  ADD COLUMN IF NOT EXISTS tracking_type text NOT NULL DEFAULT 'reps_weight';

ALTER TABLE public.pl_exercise_rows
  DROP CONSTRAINT IF EXISTS pl_exercise_rows_tracking_type_check;

ALTER TABLE public.pl_exercise_rows
  ADD CONSTRAINT pl_exercise_rows_tracking_type_check
  CHECK (tracking_type IN ('reps_weight','reps','time'));

-- Backfill existing rows that were programmed as time-based
UPDATE public.pl_exercise_rows
  SET tracking_type = 'time'
  WHERE measurement_type = 'time' AND tracking_type = 'reps_weight';
