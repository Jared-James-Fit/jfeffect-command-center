ALTER TABLE public.pl_days
  ADD COLUMN IF NOT EXISTS schedule_source text,
  ADD COLUMN IF NOT EXISTS schedule_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.pl_blocks
  ADD COLUMN IF NOT EXISTS last_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_scheduled_availability text[];