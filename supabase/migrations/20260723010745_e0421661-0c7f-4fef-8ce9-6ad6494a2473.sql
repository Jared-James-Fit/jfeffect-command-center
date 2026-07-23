ALTER TABLE public.pl_workout_feedback
  ADD COLUMN IF NOT EXISTS sleep_bucket text,
  ADD COLUMN IF NOT EXISTS sleep_notes text;

ALTER TABLE public.member_workout_reviews
  ADD COLUMN IF NOT EXISTS sleep_bucket text,
  ADD COLUMN IF NOT EXISTS sleep_notes text;

ALTER TABLE public.pl_workout_feedback
  DROP CONSTRAINT IF EXISTS pl_workout_feedback_sleep_bucket_chk;
ALTER TABLE public.pl_workout_feedback
  ADD CONSTRAINT pl_workout_feedback_sleep_bucket_chk
  CHECK (sleep_bucket IS NULL OR sleep_bucket IN ('lt5','5_6','6_7','7_8','8_9','gte9'));

ALTER TABLE public.member_workout_reviews
  DROP CONSTRAINT IF EXISTS member_workout_reviews_sleep_bucket_chk;
ALTER TABLE public.member_workout_reviews
  ADD CONSTRAINT member_workout_reviews_sleep_bucket_chk
  CHECK (sleep_bucket IS NULL OR sleep_bucket IN ('lt5','5_6','6_7','7_8','8_9','gte9'));