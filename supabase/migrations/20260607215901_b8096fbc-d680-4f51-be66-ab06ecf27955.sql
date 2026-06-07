ALTER TABLE public.pl_days
  ADD COLUMN IF NOT EXISTS source_day_id uuid REFERENCES public.pl_days(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pl_days_source_day ON public.pl_days(source_day_id);