-- Fix permission denied on pl_workout_feedback (missing GRANTs)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_workout_feedback TO authenticated;
GRANT ALL ON public.pl_workout_feedback TO service_role;

-- Add quick-completion fields directly on pl_day_completions so the new
-- minimal "Workout Complete" popup writes through the same row members
-- already control via existing RLS (no new policy surface).
ALTER TABLE public.pl_day_completions
  ADD COLUMN IF NOT EXISTS session_rating smallint,
  ADD COLUMN IF NOT EXISTS session_weight_total numeric,
  ADD COLUMN IF NOT EXISTS session_weight_unit text;

ALTER TABLE public.pl_day_completions
  DROP CONSTRAINT IF EXISTS pl_day_completions_session_rating_range;
ALTER TABLE public.pl_day_completions
  ADD CONSTRAINT pl_day_completions_session_rating_range
  CHECK (session_rating IS NULL OR (session_rating BETWEEN 1 AND 5));

ALTER TABLE public.pl_day_completions
  DROP CONSTRAINT IF EXISTS pl_day_completions_session_weight_unit_check;
ALTER TABLE public.pl_day_completions
  ADD CONSTRAINT pl_day_completions_session_weight_unit_check
  CHECK (session_weight_unit IS NULL OR session_weight_unit IN ('kg','lb'));

CREATE INDEX IF NOT EXISTS idx_pl_day_completions_client_completed_at
  ON public.pl_day_completions (client_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;