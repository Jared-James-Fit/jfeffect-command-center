-- Quick post-workout review v2 marker. v1 reviews stored a session_rpe that was
-- derived from a 3-option status card (5/7/8), not reported by the athlete.
-- v2 (review_version = 2) stores a real self-reported session RPE, so recovery
-- analytics and load suggestions only trust session_rpe when this is >= 2.
ALTER TABLE public.pl_workout_feedback
  ADD COLUMN IF NOT EXISTS review_version smallint;

COMMENT ON COLUMN public.pl_workout_feedback.review_version IS
  'NULL = legacy status-card review (session_rpe derived). 2 = quick check-out with self-reported session RPE.';
