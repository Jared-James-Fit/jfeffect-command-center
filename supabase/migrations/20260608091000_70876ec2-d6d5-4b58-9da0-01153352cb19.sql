
-- Phase 1: Block date ranges
ALTER TABLE public.pl_blocks
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS week_duration_days integer NOT NULL DEFAULT 7;

ALTER TABLE public.pl_weeks
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS date_source text NOT NULL DEFAULT 'auto' CHECK (date_source IN ('auto','manual'));

-- Phase 2: Committed training schedule fields on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS committed_training_frequency integer CHECK (committed_training_frequency BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS committed_training_days text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS available_training_days text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS unavailable_training_days text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS preferred_training_time text,
  ADD COLUMN IF NOT EXISTS schedule_changes_weekly boolean,
  ADD COLUMN IF NOT EXISTS schedule_notes text,
  ADD COLUMN IF NOT EXISTS training_schedule_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS training_schedule_last_updated timestamptz,
  ADD COLUMN IF NOT EXISTS training_schedule_updated_by uuid;
