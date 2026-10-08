-- Quick check-out asks sleep as <5h / 5–6h / 6–7h / 7–8h / 8h+, anchored on 8h.
-- 'gte8' is the new top bucket. 'gte7' (asked briefly) stays valid so any
-- rows saved with it still pass; 8_9 / gte9 stay valid for history.
ALTER TABLE public.pl_workout_feedback
  DROP CONSTRAINT IF EXISTS pl_workout_feedback_sleep_bucket_chk;
ALTER TABLE public.pl_workout_feedback
  ADD CONSTRAINT pl_workout_feedback_sleep_bucket_chk
  CHECK (sleep_bucket IS NULL OR sleep_bucket IN ('lt5','5_6','6_7','7_8','8_9','gte9','gte7','gte8'));

ALTER TABLE public.member_workout_reviews
  DROP CONSTRAINT IF EXISTS member_workout_reviews_sleep_bucket_chk;
ALTER TABLE public.member_workout_reviews
  ADD CONSTRAINT member_workout_reviews_sleep_bucket_chk
  CHECK (sleep_bucket IS NULL OR sleep_bucket IN ('lt5','5_6','6_7','7_8','8_9','gte9','gte7','gte8'));
