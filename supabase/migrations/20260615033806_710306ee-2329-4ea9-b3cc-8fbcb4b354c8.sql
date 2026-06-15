ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS intake_training_experience text,
  ADD COLUMN IF NOT EXISTS intake_followed_program text,
  ADD COLUMN IF NOT EXISTS intake_squat_5rm numeric,
  ADD COLUMN IF NOT EXISTS intake_bench_5rm numeric,
  ADD COLUMN IF NOT EXISTS intake_deadlift_5rm numeric,
  ADD COLUMN IF NOT EXISTS intake_injuries text;