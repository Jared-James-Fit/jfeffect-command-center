ALTER TABLE public.pl_workout_feedback
  ADD COLUMN IF NOT EXISTS strength_feel TEXT,
  ADD COLUMN IF NOT EXISTS fatigue_feel TEXT,
  ADD COLUMN IF NOT EXISTS hit_target TEXT;

ALTER TABLE public.member_workout_reviews
  ADD COLUMN IF NOT EXISTS strength_feel TEXT,
  ADD COLUMN IF NOT EXISTS fatigue_feel TEXT,
  ADD COLUMN IF NOT EXISTS hit_target TEXT;