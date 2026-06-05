
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preferred_training_days text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_rest_days text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_high_days text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_notes text,
  ADD COLUMN IF NOT EXISTS schedule_updated_at timestamptz;

ALTER TABLE public.cardio_targets
  ADD COLUMN IF NOT EXISTS day_type text NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS custom_day_type text,
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
