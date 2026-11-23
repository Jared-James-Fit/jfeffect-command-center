-- Rollback for 20270511090000_coaching_automation_videos_progress.sql.
-- Back to the five kinds of 20270510100000. Queue items of video_reply and
-- progress_reply are deleted with their client rules and settings, so the old
-- constraints hold; the append-only record keeps what happened. Workout
-- replies go back to notes and low ratings only, and My Voice goes back to
-- every coach reading it. Run as the database owner.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS pl_set_videos_queue_reply ON public.pl_set_videos;
DROP TRIGGER IF EXISTS progress_submissions_queue_reply ON public.progress_submissions;
DROP TRIGGER IF EXISTS progress_submissions_reviewed_cancels_reply ON public.progress_submissions;
DROP FUNCTION IF EXISTS public.tg_pl_set_videos_queue_reply();
DROP FUNCTION IF EXISTS public.tg_progress_submissions_queue_reply();
DROP FUNCTION IF EXISTS public.tg_progress_submissions_reviewed_cancels_reply();

DELETE FROM public.coach_automation_items WHERE category IN ('video_reply', 'progress_reply');
DELETE FROM public.coach_automation_client_rules WHERE category IN ('video_reply', 'progress_reply');
UPDATE public.coach_automation_settings
   SET modes = modes - 'video_reply' - 'progress_reply'
 WHERE modes ?| ARRAY['video_reply', 'progress_reply'];
-- reviews with nothing to answer were cancelled; they stay cancelled

ALTER TABLE public.coach_automation_items DROP CONSTRAINT IF EXISTS coach_automation_items_category_check;
ALTER TABLE public.coach_automation_items ADD CONSTRAINT coach_automation_items_category_check
  CHECK (category IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session'));
ALTER TABLE public.coach_automation_items DROP CONSTRAINT IF EXISTS coach_automation_items_source_kind_check;
ALTER TABLE public.coach_automation_items ADD CONSTRAINT coach_automation_items_source_kind_check
  CHECK (source_kind IN ('review', 'follow_up', 'workout', 'checkin', 'missed'));
ALTER TABLE public.coach_automation_client_rules DROP CONSTRAINT IF EXISTS coach_automation_client_rules_category_check;
ALTER TABLE public.coach_automation_client_rules ADD CONSTRAINT coach_automation_client_rules_category_check
  CHECK (category IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session'));

CREATE OR REPLACE FUNCTION public.coach_automation_modes_valid(_modes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(_modes) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(_modes) e
        WHERE e.key NOT IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session')
           OR jsonb_typeof(e.value) <> 'string'
           OR (e.value #>> '{}') NOT IN ('off', 'manual', 'approval', 'automatic')
     )
$$;

-- What a mode needs: the approval queue for anything; follow-ups for anything
-- the coach starts himself (a follow-up, a missed session); auto-send to send.
CREATE OR REPLACE FUNCTION public.coach_automation_mode_allowed(_uid uuid, _category text, _mode text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _mode = 'off' THEN true
    WHEN _category NOT IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session') THEN false
    WHEN NOT public.cleo_has_feature(_uid, 'automation.approval_queue') THEN false
    WHEN _category IN ('recovery_follow_up', 'missed_session') AND NOT public.cleo_has_feature(_uid, 'automation.follow_ups') THEN false
    WHEN _mode = 'automatic' THEN public.cleo_has_feature(_uid, 'automation.auto_send')
    ELSE true
  END
$$;
REVOKE ALL ON FUNCTION public.coach_automation_mode_allowed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_automation_mode_allowed(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.coach_automation_client_rule_set(_client uuid, _category text, _mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.cleo_feature('automation.approval_queue') THEN
    RAISE EXCEPTION 'Automation isn''t part of your plan' USING ERRCODE = '42501';
  END IF;
  IF _category NOT IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session') THEN
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
REVOKE ALL ON FUNCTION public.coach_automation_client_rule_set(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_automation_client_rule_set(uuid, text, text) TO authenticated, service_role;

-- the workout trigger as 20270510100000 had it
CREATE OR REPLACE FUNCTION public.tg_workout_feedback_queue_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_coach uuid;
  v_mode text;
  v_note text := nullif(btrim(coalesce(NEW.client_note, '')), '');
BEGIN
  IF coalesce(NEW.pain, false) THEN RETURN NEW; END IF;
  IF NEW.created_at < now() - interval '1 day' THEN RETURN NEW; END IF;
  IF v_note IS NULL AND coalesce(NEW.overall_rating, 5) > 2 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.client_note IS NOT DISTINCT FROM OLD.client_note
     AND NEW.overall_rating IS NOT DISTINCT FROM OLD.overall_rating THEN
    RETURN NEW;
  END IF;
  IF NEW.review_updated_by IS NULL
     OR NEW.review_updated_by IS DISTINCT FROM (SELECT c.user_id FROM public.clients c WHERE c.id = NEW.client_id) THEN
    RETURN NEW;
  END IF;
  v_coach := public.coach_automation_coach_of(NEW.client_id);
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  v_mode := public.coach_automation_mode_for(v_coach, NEW.client_id, 'workout_reply');
  IF v_mode = 'off' THEN RETURN NEW; END IF;
  INSERT INTO public.coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, source_id, status, due_at)
  VALUES (v_coach, NEW.client_id, 'workout_reply', 'workout_reply:review:' || NEW.id, 'workout', NEW.id, 'queued', now() + interval '3 minutes')
  ON CONFLICT (dedupe_key) DO UPDATE
    SET status = 'queued', due_at = greatest(coach_automation_items.due_at, now() + interval '3 minutes'),
        attempts = 0, why = NULL, context = NULL, updated_at = now()
    WHERE coach_automation_items.status = 'queued'
       OR (coach_automation_items.status = 'cancelled' AND coalesce((coach_automation_items.context ->> 'not_useful')::boolean, false));
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- never fail the athlete's review because of automation
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Owner reads coach voice" ON public.coach_voice;
DROP POLICY IF EXISTS "Staff read coach voice" ON public.coach_voice;
CREATE POLICY "Staff read coach voice" ON public.coach_voice
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'coach'::public.app_role));

COMMIT;
