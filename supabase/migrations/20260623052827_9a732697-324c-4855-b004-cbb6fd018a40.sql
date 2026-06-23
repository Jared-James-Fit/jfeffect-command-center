ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS timer_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS timer_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_method  text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pl_row_results_completion_method_check'
  ) THEN
    ALTER TABLE public.pl_row_results
      ADD CONSTRAINT pl_row_results_completion_method_check
      CHECK (completion_method IS NULL OR completion_method IN (
        'countdown_timer','stopwatch','prescribed_quick_confirm','manual_entry'
      ));
  END IF;
END $$;