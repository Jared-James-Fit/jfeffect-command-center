-- Rollback for 20270512090000_ai_reliability.sql (Nov 23 2026), section by section.
-- The app keeps working without these: the call log and health reads fail soft (nothing is
-- logged, nothing is paused), and the health tick has nothing to run.
SET lock_timeout = '5s';

-- the tick
DO $$ BEGIN
  PERFORM cron.unschedule('ai-health-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-health-tick');
END $$;

-- the deck writer as it was (20270429090000_crew_post_decks.sql): three at once, no health gate,
-- no daily budget for the library
CREATE OR REPLACE FUNCTION public.community_post_decks_kick()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_free int;
  v_job uuid;
  v_sent boolean := false;
BEGIN
  v_free := 3 - (SELECT count(*) FROM public.community_post_decks WHERE status = 'running' AND claimed_at > now() - interval '12 minutes');
  IF v_free <= 0 THEN RETURN false; END IF;
  FOR v_job IN
    SELECT id FROM public.community_post_decks
     WHERE status = 'pending' AND run_after <= now()
     ORDER BY priority, created_at
     LIMIT v_free
  LOOP
    UPDATE public.community_post_decks SET run_after = now() + interval '1 minute' WHERE id = v_job;
    PERFORM net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/post-decks-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
      body := jsonb_build_object('jobId', v_job),
      timeout_milliseconds := 600000);
    v_sent := true;
  END LOOP;
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_decks_kick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_decks_kick() TO service_role;

-- the functions
DROP FUNCTION IF EXISTS public.ai_recovery_requeue(integer);
DROP FUNCTION IF EXISTS public.ai_usage_by_task(timestamptz);
DROP FUNCTION IF EXISTS public.ai_usage_by_month(integer);
DROP FUNCTION IF EXISTS public.ai_error_is_provider(text);

-- the tables (the call log is a record: export it first if it's wanted)
DROP TABLE IF EXISTS public.ai_provider_health;
DROP TABLE IF EXISTS public.ai_call_log;
