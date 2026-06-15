-- 1. Pause the misconfigured cron job that's spamming 503s every minute.
--    Re-enable with: SELECT cron.alter_job(8, active := true);
--    BEFORE re-enabling, set SCHEDULED_WORKER_SECRET in the project's
--    server env AND update the cron command body to include
--    'x-worker-secret' header (or ?secret=... query) matching that value.
SELECT cron.alter_job(8, active := false);

-- 2. Index for unfiltered admin lift_videos list (ORDER BY created_at DESC).
CREATE INDEX IF NOT EXISTS idx_lift_videos_created_at
  ON public.lift_videos (created_at DESC);

-- 3. Index for training_phases sort-by-end_date queries.
CREATE INDEX IF NOT EXISTS idx_training_phases_end_date
  ON public.training_phases (end_date);
