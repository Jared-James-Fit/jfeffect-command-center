-- Rollback for 20270603100000_pain_unsure_severity.sql.
-- Only possible while no "not sure" places are stored; check first:
--   SELECT count(*) FROM public.pain_reports WHERE severity IS NULL;
--   SELECT count(*) FROM public.pl_workout_feedback WHERE pain AND pain_level IS NULL;
-- Both must be 0 (or those rows given a severity by hand) before running this.

SET lock_timeout = '3s';

ALTER TABLE public.pl_workout_feedback DROP CONSTRAINT IF EXISTS pl_workout_feedback_pain_consistency;
ALTER TABLE public.pl_workout_feedback ADD CONSTRAINT pl_workout_feedback_pain_consistency CHECK (
  (pain = false AND pain_level IS NULL AND pain_area IS NULL)
  OR (
    pain = true
    AND pain_level IS NOT NULL AND pain_level BETWEEN 1 AND 10
    AND pain_area IS NOT NULL AND length(btrim(pain_area)) > 0
  )
);

ALTER TABLE public.pain_reports ALTER COLUMN severity SET NOT NULL;
