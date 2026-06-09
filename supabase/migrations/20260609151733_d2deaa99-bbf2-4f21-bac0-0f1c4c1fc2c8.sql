ALTER TABLE public.pl_exercise_rows
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_of_pct numeric,
  ADD COLUMN IF NOT EXISTS load_unit text;