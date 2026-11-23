-- Rollback for 20270510100000_coaching_automation_categories.sql.
-- Back to recovery automation only. Queue items of the three new kinds are
-- deleted (sent ones included: their messages stay in the chats, but "Take it
-- back" goes with them), with the client rules for them, so the old
-- constraints hold; the append-only record keeps what happened. The pain
-- trigger and the staff-reply trigger go back to their earlier versions. Run
-- as the database owner.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'coach-automation-missed-scan';
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN NULL;
END $$;

DROP TRIGGER IF EXISTS workout_feedback_queue_reply ON public.pl_workout_feedback;
DROP TRIGGER IF EXISTS messenger_checkin_queue_reply ON public.messenger_checkins;
DROP TRIGGER IF EXISTS messenger_checkin_reviewed_cancels_reply ON public.messenger_checkins;
DROP FUNCTION IF EXISTS public.tg_workout_feedback_queue_reply();
DROP FUNCTION IF EXISTS public.tg_messenger_checkin_queue_reply();
DROP FUNCTION IF EXISTS public.tg_messenger_checkin_reviewed_cancels_reply();

-- the pain trigger as 20270509100000 had it
CREATE OR REPLACE FUNCTION public.tg_pain_reports_queue_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_coach uuid;
  v_mode text;
BEGIN
  IF NEW.source <> 'review' OR NEW.feedback_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.reported_at < now() - interval '1 day' THEN RETURN NEW; END IF;
  SELECT co.user_id INTO v_coach
    FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
   WHERE c.id = NEW.client_id AND c.service_tier = 'coaching' AND NOT coalesce(c.archived, false)
     AND co.status = 'Active' AND NOT coalesce(co.archived, false);
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  v_mode := public.coach_automation_mode_for(v_coach, NEW.client_id, 'recovery_reply');
  IF v_mode = 'off' THEN RETURN NEW; END IF;
  INSERT INTO public.coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, source_id, regions, status, due_at)
  VALUES (v_coach, NEW.client_id, 'recovery_reply', 'recovery_reply:review:' || NEW.feedback_id, 'review', NEW.feedback_id,
          ARRAY[NEW.region], 'queued', now() + interval '2 minutes')
  ON CONFLICT (dedupe_key) DO UPDATE
    SET due_at = greatest(coach_automation_items.due_at, now() + interval '2 minutes'),
        regions = (SELECT array_agg(DISTINCT r) FROM unnest(coach_automation_items.regions || EXCLUDED.regions) r),
        updated_at = now()
    WHERE coach_automation_items.status = 'queued';
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

-- the staff-reply trigger as 20261007100000 had it
CREATE OR REPLACE FUNCTION public.tg_staff_reply_closes_reviews()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if new.sender_role = 'client'
     or coalesce(new.is_internal_note, false)
     or coalesce(new.is_automated, false)
     or new.deleted_at is not null
     or new.scheduled_at is not null
     or coalesce(new.attachments::text, '') ilike '%form_request%' then
    return new;
  end if;

  update public.messenger_checkins
     set reviewed_at = now(), reviewed_by = new.sender_id, reviewed_via = 'reply'
   where client_id = new.client_id
     and status = 'completed' and superseded_at is null and reviewed_at is null
     and submitted_at <= new.created_at;

  update public.nf_submissions
     set status = 'reviewed', reviewed_at = now(), reviewed_by = new.sender_id
   where client_id = new.client_id
     and submitted_at is not null and reviewed_at is null
     and status in ('submitted','pending_review')
     and submitted_at <= new.created_at;

  return new;
end
$function$;

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
