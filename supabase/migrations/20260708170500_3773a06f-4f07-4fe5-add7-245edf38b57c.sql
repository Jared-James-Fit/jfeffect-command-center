
ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS scheduled_workout_id uuid
  REFERENCES public.pl_scheduled_workouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pl_row_results_scheduled_workout
  ON public.pl_row_results (scheduled_workout_id)
  WHERE scheduled_workout_id IS NOT NULL;

ALTER TABLE public.pl_row_results
  DROP CONSTRAINT IF EXISTS pl_row_results_client_row_set_unique;

CREATE UNIQUE INDEX IF NOT EXISTS pl_row_results_legacy_client_row_set_unique
  ON public.pl_row_results (client_id, row_id, set_index)
  WHERE scheduled_workout_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pl_row_results_instance_row_set_unique
  ON public.pl_row_results (scheduled_workout_id, row_id, set_index)
  WHERE scheduled_workout_id IS NOT NULL;
