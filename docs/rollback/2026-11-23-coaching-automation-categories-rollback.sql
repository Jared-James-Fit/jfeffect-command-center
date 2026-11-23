-- Rollback for 20270510090000_coaching_automation_categories.sql.
-- Back to recovery automation only. Messages already sent stay in the chats;
-- queue items of the three new kinds that haven't gone are cancelled first,
-- then removed with the client rules for them so the old constraints hold
-- (the append-only record keeps what happened). Run as the database owner.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'coach-automation-missed-scan';
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;

DROP TRIGGER IF EXISTS workout_feedback_queue_reply ON public.pl_workout_feedback;
DROP TRIGGER IF EXISTS messenger_checkin_queue_reply ON public.messenger_checkins;
DROP FUNCTION IF EXISTS public.tg_workout_feedback_queue_reply();
DROP FUNCTION IF EXISTS public.tg_messenger_checkin_queue_reply();

DELETE FROM public.coach_automation_items WHERE category IN ('workout_reply', 'checkin_reply', 'missed_session');
DELETE FROM public.coach_automation_client_rules WHERE category IN ('workout_reply', 'checkin_reply', 'missed_session');
UPDATE public.coach_automation_settings
   SET modes = modes - 'workout_reply' - 'checkin_reply' - 'missed_session'
 WHERE modes ?| ARRAY['workout_reply', 'checkin_reply', 'missed_session'];

ALTER TABLE public.coach_automation_items DROP CONSTRAINT IF EXISTS coach_automation_items_category_check;
ALTER TABLE public.coach_automation_items ADD CONSTRAINT coach_automation_items_category_check CHECK (category IN ('recovery_reply', 'recovery_follow_up'));
ALTER TABLE public.coach_automation_items DROP CONSTRAINT IF EXISTS coach_automation_items_source_kind_check;
ALTER TABLE public.coach_automation_items ADD CONSTRAINT coach_automation_items_source_kind_check CHECK (source_kind IN ('review', 'follow_up'));
ALTER TABLE public.coach_automation_client_rules DROP CONSTRAINT IF EXISTS coach_automation_client_rules_category_check;
ALTER TABLE public.coach_automation_client_rules ADD CONSTRAINT coach_automation_client_rules_category_check CHECK (category IN ('recovery_reply', 'recovery_follow_up'));

CREATE OR REPLACE FUNCTION public.coach_automation_modes_valid(_modes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(_modes) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(_modes) e
        WHERE e.key NOT IN ('recovery_reply', 'recovery_follow_up')
           OR jsonb_typeof(e.value) <> 'string'
           OR (e.value #>> '{}') NOT IN ('off', 'manual', 'approval', 'automatic'))
$$;

CREATE OR REPLACE FUNCTION public.coach_automation_mode_allowed(_uid uuid, _category text, _mode text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _mode = 'off' THEN true
    WHEN NOT public.cleo_has_feature(_uid, 'automation.approval_queue') THEN false
    WHEN _category = 'recovery_follow_up' AND NOT public.cleo_has_feature(_uid, 'automation.follow_ups') THEN false
    WHEN _mode = 'automatic' THEN public.cleo_has_feature(_uid, 'automation.auto_send')
    ELSE true
  END
$$;

CREATE OR REPLACE FUNCTION public.coach_automation_client_rule_set(_client uuid, _category text, _mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.cleo_feature('automation.approval_queue') THEN
    RAISE EXCEPTION 'Automation isn''t part of your plan' USING ERRCODE = '42501';
  END IF;
  IF _category NOT IN ('recovery_reply', 'recovery_follow_up') THEN
    RAISE EXCEPTION 'Unknown automation setting' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
     WHERE c.id = _client AND co.user_id = v_uid AND co.status = 'Active' AND NOT coalesce(co.archived, false)
  ) THEN
    RAISE EXCEPTION 'Not your client' USING ERRCODE = '42501';
  END IF;
  IF _mode IS NULL THEN
    DELETE FROM public.coach_automation_client_rules WHERE user_id = v_uid AND client_id = _client AND category = _category;
  ELSE
    IF _mode NOT IN ('off', 'manual', 'approval', 'automatic') OR NOT public.coach_automation_mode_allowed(v_uid, _category, _mode) THEN
      RAISE EXCEPTION 'That setting isn''t part of your plan' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.coach_automation_client_rules (user_id, client_id, category, mode, updated_at)
    VALUES (v_uid, _client, _category, _mode, now())
    ON CONFLICT (user_id, client_id, category) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now();
  END IF;
  INSERT INTO public.coach_automation_events (coach_user_id, client_id, kind, actor, detail)
  VALUES (v_uid, _client, 'client_rule_changed', v_uid, jsonb_build_object('category', _category, 'mode', _mode));
END;
$$;

DROP FUNCTION IF EXISTS public.coach_automation_coach_of(uuid);

COMMIT;
