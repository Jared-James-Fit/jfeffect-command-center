-- How long a workout actually took, kept apart from when it was typed in
-- (session-duration.ts). Written once at Finish (and again when the athlete or
-- coach corrects the time), read by Workouts, analytics and the coach's brief.
--
--   performed_duration_seconds  best read of time spent training
--   duration_source             confirmed | clock | sets | estimated
--   duration_confidence         high | medium | low
--   estimated_duration_min      the plan's estimate for that workout at Finish,
--                               so estimate vs actual can be compared later
--
-- Only `confirmed` and `clock` are measured; `sets` is reconstructed from the
-- logged sets' times and `estimated` is the plan's number, never shown as
-- measured. Existing columns (elapsed_duration_seconds = wall clock,
-- active_duration_seconds, actual_duration_min) are unchanged.

ALTER TABLE public.pl_day_completions
  ADD COLUMN IF NOT EXISTS performed_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS duration_source text,
  ADD COLUMN IF NOT EXISTS duration_confidence text,
  ADD COLUMN IF NOT EXISTS estimated_duration_min integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_day_completions_duration_source_chk') THEN
    ALTER TABLE public.pl_day_completions
      ADD CONSTRAINT pl_day_completions_duration_source_chk
      CHECK (duration_source IS NULL OR duration_source IN ('confirmed', 'clock', 'sets', 'estimated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_day_completions_duration_confidence_chk') THEN
    ALTER TABLE public.pl_day_completions
      ADD CONSTRAINT pl_day_completions_duration_confidence_chk
      CHECK (duration_confidence IS NULL OR duration_confidence IN ('high', 'medium', 'low'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_day_completions_performed_duration_chk') THEN
    ALTER TABLE public.pl_day_completions
      ADD CONSTRAINT pl_day_completions_performed_duration_chk
      CHECK (performed_duration_seconds IS NULL OR performed_duration_seconds BETWEEN 0 AND 86400);
  END IF;
END $$;

COMMENT ON COLUMN public.pl_day_completions.performed_duration_seconds IS
  'Best read of time spent training (session-duration.ts); not the wall clock when sets were typed in later.';
COMMENT ON COLUMN public.pl_day_completions.duration_source IS
  'confirmed (a person set it) | clock (session clock, sets agree) | sets (reconstructed from set times) | estimated (plan estimate). Only confirmed/clock are measured.';

-- Resetting a workout to Not Started clears its timing; the read belongs to that attempt.
CREATE OR REPLACE FUNCTION public.pl_day_completions_clear_duration_read()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.started_at IS NULL AND NEW.completed_at IS NULL THEN
    NEW.performed_duration_seconds := NULL;
    NEW.duration_source := NULL;
    NEW.duration_confidence := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pl_day_completions_clear_duration_read_trg ON public.pl_day_completions;
CREATE TRIGGER pl_day_completions_clear_duration_read_trg
  BEFORE UPDATE ON public.pl_day_completions
  FOR EACH ROW
  WHEN (NEW.duration_source IS NOT NULL)
  EXECUTE FUNCTION public.pl_day_completions_clear_duration_read();
