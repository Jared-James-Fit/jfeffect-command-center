-- A workout completion timestamp is an explicit lifecycle event, not a row default.
-- Draft/in-progress rows are created when a workout is opened or started.
ALTER TABLE public.pl_day_completions
  ALTER COLUMN completed_at DROP NOT NULL,
  ALTER COLUMN completed_at DROP DEFAULT;

COMMENT ON COLUMN public.pl_day_completions.completed_at IS
  'Set only by an explicit workout completion action. NULL represents not started or in progress.';
