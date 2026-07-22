ALTER TABLE public.pl_workout_feedback
  ADD COLUMN IF NOT EXISTS recovery_today smallint
    CHECK (recovery_today IS NULL OR (recovery_today BETWEEN 1 AND 5));

ALTER TABLE public.member_workout_reviews
  ADD COLUMN IF NOT EXISTS recovery_today smallint
    CHECK (recovery_today IS NULL OR (recovery_today BETWEEN 1 AND 5));