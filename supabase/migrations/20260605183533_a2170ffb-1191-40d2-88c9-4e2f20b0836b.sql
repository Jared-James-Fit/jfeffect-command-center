ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS home_screen_setup_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS home_screen_setup_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS home_screen_setup_remind_after timestamptz;