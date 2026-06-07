
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule with this name (idempotent re-runs)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'media-archive-nightly') THEN
    PERFORM cron.unschedule('media-archive-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'media-archive-nightly',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/media-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qcnNpbm13a3FmdXVrZm10cnl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDYzMDEsImV4cCI6MjA5NjA4MjMwMX0.C07MklrF7k-O0g6w_EUlm-xp6MUsgCP44f8Jey4Qto4'
    ),
    body := '{}'::jsonb
  );
  $$
);
