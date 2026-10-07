-- Training Time: athlete/coach-confirmed session start.
--
-- started_at is system-owned: the moment the logger first saw activity. It is
-- right when the athlete logs live, and wrong when sets are entered after the
-- session (everything lands within a few minutes of "now"). training_started_at
-- is the human-confirmed start the athlete or coach sets from the Session Time
-- sheet. Analytics prefer it; status, XP and version history never read it.

ALTER TABLE public.pl_day_completions
  ADD COLUMN IF NOT EXISTS training_started_at timestamptz;

COMMENT ON COLUMN public.pl_day_completions.training_started_at IS
  'Athlete/coach-confirmed real training start (Session Time sheet). NULL = use started_at.';

-- Resetting a workout to Not Started clears started_at and completed_at. A
-- confirmed time belongs to that attempt, so clear it with them; otherwise
-- the next attempt inherits a stale start.
CREATE OR REPLACE FUNCTION public.pl_day_completions_clear_training_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.started_at IS NULL AND NEW.completed_at IS NULL THEN
    NEW.training_started_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pl_day_completions_clear_training_time_trg ON public.pl_day_completions;
CREATE TRIGGER pl_day_completions_clear_training_time_trg
  BEFORE UPDATE ON public.pl_day_completions
  FOR EACH ROW
  WHEN (NEW.training_started_at IS NOT NULL)
  EXECUTE FUNCTION public.pl_day_completions_clear_training_time();
