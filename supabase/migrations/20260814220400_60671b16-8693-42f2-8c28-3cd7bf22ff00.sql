ALTER TABLE public.cardio_completions
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS distance numeric(8,2),
  ADD COLUMN IF NOT EXISTS distance_unit text,
  ADD COLUMN IF NOT EXISTS avg_speed numeric(6,2),
  ADD COLUMN IF NOT EXISTS incline numeric(5,2),
  ADD COLUMN IF NOT EXISTS calories integer,
  ADD COLUMN IF NOT EXISTS avg_heart_rate integer;