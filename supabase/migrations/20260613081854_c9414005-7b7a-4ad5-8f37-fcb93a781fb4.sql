-- Ensure required extensions are available (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule with this exact name so the migration is re-runnable.
DO $$
BEGIN
  PERFORM cron.unschedule('jf-cleanup-pending-signups-hourly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jf-cleanup-pending-signups-hourly');
EXCEPTION WHEN OTHERS THEN
  -- ignore if job didn't exist
  NULL;
END $$;

-- Schedule the cleanup hourly. The endpoint authenticates by matching the
-- Supabase publishable apikey header against SUPABASE_PUBLISHABLE_KEY, then
-- deletes only expired jf_pending_signups whose email is NOT already
-- finalized in app_members. It is idempotent and bounded to 500 rows per run.
SELECT cron.schedule(
  'jf-cleanup-pending-signups-hourly',
  '7 * * * *', -- every hour at :07 (offset to avoid colliding with other jobs)
  $$
  SELECT net.http_post(
    url     := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/cleanup-pending-signups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qcnNpbm13a3FmdXVrZm10cnl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDYzMDEsImV4cCI6MjA5NjA4MjMwMX0.C07MklrF7k-O0g6w_EUlm-xp6MUsgCP44f8Jey4Qto4'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);