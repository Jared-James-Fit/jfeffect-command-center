
ALTER TABLE public.pl_client_maxes
  ADD COLUMN IF NOT EXISTS exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_lift text,
  ADD COLUMN IF NOT EXISTS variation_modifier numeric,
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tested_at date,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rounding_step numeric,
  ADD COLUMN IF NOT EXISTS rounding_mode text NOT NULL DEFAULT 'nearest';

CREATE INDEX IF NOT EXISTS pl_client_maxes_client_active_idx
  ON public.pl_client_maxes (client_id, active);
