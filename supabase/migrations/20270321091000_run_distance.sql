-- A run's distance, typed in the workout logger's Distance box (on by default
-- for running exercises, optional on any timed row): stored in metres with the
-- unit it was typed in, so it reads back in km or miles as the athlete logged
-- it. Pace is never stored (time ÷ distance, src/lib/running/run-log.ts).
-- Never needed for a set to count as done. Nothing existing is changed.
ALTER TABLE public.pl_row_results ADD COLUMN IF NOT EXISTS actual_distance_m numeric;
ALTER TABLE public.pl_row_results ADD COLUMN IF NOT EXISTS actual_distance_unit text;
ALTER TABLE public.pl_row_results DROP CONSTRAINT IF EXISTS pl_row_results_actual_distance_range;
ALTER TABLE public.pl_row_results ADD CONSTRAINT pl_row_results_actual_distance_range
  CHECK (actual_distance_m IS NULL OR (actual_distance_m > 0 AND actual_distance_m <= 300000));
ALTER TABLE public.pl_row_results DROP CONSTRAINT IF EXISTS pl_row_results_actual_distance_unit_check;
ALTER TABLE public.pl_row_results ADD CONSTRAINT pl_row_results_actual_distance_unit_check
  CHECK (actual_distance_unit IS NULL OR actual_distance_unit IN ('km', 'mi'));
COMMENT ON COLUMN public.pl_row_results.actual_distance_m IS 'Distance a set covered, in metres (a run). Optional; pace = completed_duration_seconds / distance.';
COMMENT ON COLUMN public.pl_row_results.actual_distance_unit IS 'The unit the distance was typed in: km or mi.';
