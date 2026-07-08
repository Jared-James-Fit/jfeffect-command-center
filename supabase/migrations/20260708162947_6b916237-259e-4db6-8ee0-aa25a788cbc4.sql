
-- 1. New instance-scoped uniqueness: each scheduled instance gets one completion.
CREATE UNIQUE INDEX IF NOT EXISTS pl_day_completions_scheduled_workout_id_unique
  ON public.pl_day_completions (scheduled_workout_id)
  WHERE scheduled_workout_id IS NOT NULL;

-- 2. Legacy protection for rows created before instance threading:
--    still one completion per (client_id, day_id) when there is no instance.
CREATE UNIQUE INDEX IF NOT EXISTS pl_day_completions_legacy_client_day_unique
  ON public.pl_day_completions (client_id, day_id)
  WHERE scheduled_workout_id IS NULL;

-- 3. Drop the old blanket uniqueness that prevents duplicate-instance completions.
--    Safe now: the two partial indexes above cover both cases without overlap.
ALTER TABLE public.pl_day_completions
  DROP CONSTRAINT IF EXISTS pl_day_completions_day_id_client_id_key;

-- Some environments created it as a bare unique index rather than a constraint.
DROP INDEX IF EXISTS public.pl_day_completions_day_id_client_id_key;
