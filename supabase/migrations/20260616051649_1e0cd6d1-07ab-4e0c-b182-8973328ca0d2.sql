ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS notifications_status text,
  ADD COLUMN IF NOT EXISTS setup_dismissed_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_setup_error text,
  ADD COLUMN IF NOT EXISTS first_workout_opened_at timestamptz;