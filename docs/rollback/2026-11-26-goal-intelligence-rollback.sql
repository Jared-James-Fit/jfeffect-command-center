-- Rollback for 20270601095000_goal_intelligence.sql (Goal & Performance Intelligence).
-- Removes the goal ledger, its history, the outbox, the sync triggers and the
-- schedule. What the sync already wrote to competitions (target totals), the
-- clients' bodyweight goals and the long-term goal stays as it is: those are
-- the app's own fields and keep working without the ledger.
SET lock_timeout = '10s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'goal-intel-tick';
  END IF;
END $$;
DROP TRIGGER IF EXISTS competitions_goal_sync ON public.competitions;
DROP TRIGGER IF EXISTS clients_bodyweight_goal_sync ON public.clients;
DROP TRIGGER IF EXISTS program_intel_profiles_goal_sync ON public.program_intel_profiles;
DROP FUNCTION IF EXISTS public.tg_competitions_goal_sync();
DROP FUNCTION IF EXISTS public.tg_clients_bodyweight_goal_sync();
DROP FUNCTION IF EXISTS public.tg_intel_profile_goal_sync();
DROP FUNCTION IF EXISTS public.goal_intel_due();
DROP TABLE IF EXISTS public.client_update_outbox;
DROP TABLE IF EXISTS public.client_goal_sources;
DROP TABLE IF EXISTS public.client_goal_events;
DROP TABLE IF EXISTS public.client_goals;
DROP FUNCTION IF EXISTS public.tg_client_goals_mirror();
DROP FUNCTION IF EXISTS public.tg_client_goals_touch();
DROP FUNCTION IF EXISTS public.tg_client_update_outbox_touch();
DROP FUNCTION IF EXISTS public.tg_client_goal_events_keep();
DELETE FROM public.app_settings WHERE key IN ('goal_updates', 'goal_intel_scan');
