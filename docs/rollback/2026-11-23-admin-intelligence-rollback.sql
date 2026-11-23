-- Rollback for 20270517090000_admin_intelligence.sql (Nov 23 2026).
-- Drops the visit tables and the read / usage functions, and puts the deck kick back as it was
-- (20270512100000_ai_reliability.sql). The ai_spend_hold setting is removed too.
SET lock_timeout = '3s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'app-visits-retention';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.app_intel_report(integer);
DROP FUNCTION IF EXISTS public.membership_overview(integer);
DROP FUNCTION IF EXISTS public.app_pulse_record(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, jsonb, integer);
DROP FUNCTION IF EXISTS public.app_pulse_audience(uuid);
DROP TABLE IF EXISTS public.app_page_views;
DROP TABLE IF EXISTS public.app_sessions;
DROP FUNCTION IF EXISTS public.ops_ai_daily(integer);
DROP FUNCTION IF EXISTS public.ops_ai_by_model(timestamptz);
DROP FUNCTION IF EXISTS public.ops_sms_daily(integer);
DROP FUNCTION IF EXISTS public.ops_sms_by_category(timestamptz);
DELETE FROM public.app_settings WHERE key = 'ai_spend_hold';

CREATE OR REPLACE FUNCTION public.community_post_decks_kick()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_free int;
  v_background_left int;
  v_job uuid;
  v_sent boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_provider_health WHERE provider = 'openai' AND status <> 'ok' AND next_probe_at > now()) THEN
    RETURN false;
  END IF;
  v_free := 3 - (SELECT count(*) FROM public.community_post_decks WHERE status = 'running' AND claimed_at > now() - interval '12 minutes');
  IF v_free <= 0 THEN RETURN false; END IF;
  v_background_left := 4 - (SELECT count(*) FROM public.community_post_decks
                             WHERE priority >= 40 AND claimed_at > now() - interval '24 hours');
  FOR v_job IN
    SELECT id FROM public.community_post_decks
     WHERE status = 'pending' AND run_after <= now()
       AND (priority < 40 OR v_background_left > 0)
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
    v_background_left := v_background_left - 1;
  END LOOP;
  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_decks_kick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_post_decks_kick() TO service_role;
DROP FUNCTION IF EXISTS public.ai_background_held();
-- The wider account_lifecycle_events check stays: plan-change events already written are history.
