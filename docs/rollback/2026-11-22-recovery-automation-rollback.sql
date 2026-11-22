-- Rollback for 20270509100000_cleo_capabilities_recovery_automation.sql.
-- Stops recovery automation and removes the capability levels. Messages
-- already sent stay in the chats (they're the clients' record); only the
-- queue, its record and the settings go. Run as the database owner.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'coach-automation-tick';
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;

DROP TRIGGER IF EXISTS pain_reports_queue_reply ON public.pain_reports;

-- the worker's claim returns the queue's row type; then the tables (their policies use the functions below)
DROP FUNCTION IF EXISTS public.coach_automation_claim(uuid);
SET LOCAL jf.allow_history_delete = 'on';
DROP TABLE IF EXISTS public.coach_automation_events;
DROP TABLE IF EXISTS public.coach_automation_items;
DROP TABLE IF EXISTS public.coach_automation_client_rules;
DROP TABLE IF EXISTS public.coach_automation_settings;
DROP TABLE IF EXISTS public.cleo_entitlement_grants;
DROP TABLE IF EXISTS public.cleo_features;

DROP FUNCTION IF EXISTS public.tg_pain_reports_queue_reply();
DROP FUNCTION IF EXISTS public.coach_automation_client_rule_set(uuid, text, text);
DROP FUNCTION IF EXISTS public.coach_automation_settings_set(boolean, jsonb);
DROP FUNCTION IF EXISTS public.coach_automation_mode_for(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.coach_automation_mode_allowed(uuid, text, text);
DROP FUNCTION IF EXISTS public.coach_automation_modes_valid(jsonb);
DROP FUNCTION IF EXISTS public.tg_coach_automation_events_keep();
DROP FUNCTION IF EXISTS public.tg_cleo_grant_guard();
DROP FUNCTION IF EXISTS public.cleo_entitlement_revoke(uuid);
DROP FUNCTION IF EXISTS public.cleo_entitlement_grant(uuid, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.cleo_capability_overview();
DROP FUNCTION IF EXISTS public.cleo_my_capabilities();
DROP FUNCTION IF EXISTS public.cleo_feature(text);
DROP FUNCTION IF EXISTS public.cleo_has_feature(uuid, text);
COMMIT;
