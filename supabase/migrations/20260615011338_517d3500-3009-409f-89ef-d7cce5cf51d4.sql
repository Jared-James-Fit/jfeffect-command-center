-- 1. pl_exercise_rows: measurement type + duration
ALTER TABLE public.pl_exercise_rows
  ADD COLUMN IF NOT EXISTS measurement_type text NOT NULL DEFAULT 'reps',
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS reps_text_backup text,
  ADD COLUMN IF NOT EXISTS duration_seconds_backup integer;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pl_exercise_rows_measurement_type_check'
  ) THEN
    ALTER TABLE public.pl_exercise_rows
      ADD CONSTRAINT pl_exercise_rows_measurement_type_check
      CHECK (measurement_type IN ('reps','time'));
  END IF;
END $$;

-- 2. pl_block_set_rows: per-set duration override
ALTER TABLE public.pl_block_set_rows
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- 3. exercises library default
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS default_measurement_type text NOT NULL DEFAULT 'reps';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercises_default_measurement_type_check'
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_default_measurement_type_check
      CHECK (default_measurement_type IN ('reps','time'));
  END IF;
END $$;

-- 4. completed duration in result/log tables
ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS completed_duration_seconds integer;

ALTER TABLE public.member_set_logs
  ADD COLUMN IF NOT EXISTS completed_duration_seconds integer;
