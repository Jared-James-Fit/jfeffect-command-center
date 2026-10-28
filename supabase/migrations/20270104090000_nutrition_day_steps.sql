-- Daily step target per nutrition day type (Training / Non-Training / High),
-- written by the AI plan and edited next to the day's calories. The cardio
-- session's own step target stays on cardio_targets (automatic from minutes).
ALTER TABLE public.nutrition_target_days ADD COLUMN IF NOT EXISTS steps integer;
ALTER TABLE public.nutrition_target_days DROP CONSTRAINT IF EXISTS nutrition_target_days_steps_range;
ALTER TABLE public.nutrition_target_days ADD CONSTRAINT nutrition_target_days_steps_range
  CHECK (steps IS NULL OR (steps >= 0 AND steps <= 60000));
