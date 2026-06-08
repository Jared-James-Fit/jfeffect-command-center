ALTER TABLE public.nutrition_targets ADD COLUMN water TEXT;
ALTER TABLE public.nutrition_target_days DROP COLUMN IF EXISTS water;
ALTER TABLE public.nutrition_target_days DROP COLUMN IF EXISTS steps;