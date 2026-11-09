-- Athlete Insights are made a week ahead (AHEAD_DAYS = 7 in daily-visuals.server.ts, since
-- 20270213090000_posts_on_their_own.sql) so the coach can read and edit each one before it goes
-- out, but the cron's wake-up still looked only 3 days ahead (from 20270125's rebuild). A day the
-- worker tried early (Nov 13, tried Nov 8 and sent back for a remake) then waited until it was 3
-- days out: the worker's own "wake me again" asked this function, which said no. The window now
-- matches AHEAD_DAYS; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.community_daily_visuals_kick(_force boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_raw text := (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_status' LIMIT 1);
  v_status jsonb := CASE WHEN v_raw ~ '^\s*\{' THEN v_raw::jsonb END;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(_force, false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.community_daily_visuals v
       WHERE v.regen IS NOT NULL AND v.status <> 'skipped' AND v.day BETWEEN v_today - 45 AND v_today + 7
         AND (v.attempts = 0 OR v.updated_at < now() - interval '20 minutes')) THEN
      RETURN false;
    END IF;
    IF v_status->>'blocked' IS NOT NULL AND (v_status->>'at')::timestamptz > now() - interval '1 hour' THEN RETURN false; END IF;
  END IF;
  PERFORM net.http_post(
    url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/daily-visuals-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000);
  RETURN true;
END;
$function$;
