-- Coaching automation beyond pain (Nov 23 2026).
--
-- The same queue, levels and safeguards as recovery automation
-- (20270509100000_cleo_capabilities_recovery_automation.sql), for three more
-- kinds of client update:
--
--   workout_reply    a reply to a workout review that says something to the
--                    coach (a note, or a session they rated 1 or 2 out of 5).
--                    A review with pain is recovery's, never both.
--   checkin_reply    a reply to a weekly check-in, once its recap is written
--                    (messenger_checkins.ai_status turns ready), only while the
--                    coach hasn't replied himself.
--   missed_session   a check-in when a planned workout went by with nothing
--                    logged (found once a day by the worker, never a SQL guess
--                    at the schedule). Proactive, so it needs follow-ups too.
--
-- Same rules for all: the coach's level decides what's possible
-- (coach_automation_mode_allowed), his settings decide what happens
-- (coach_automation_mode_for: a client's rule, else his setting, else ask him
-- first), anything that needs his judgment always waits for him, every item
-- is once per thing (dedupe_key), and every step is on the record.
--
-- Rollback: docs/rollback/2026-11-23-coaching-automation-categories-rollback.sql

SET lock_timeout = '3s';

-- ── 1. The categories ──────────────────────────────────────────────────────
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

-- (internal) The active coach (login) of an active coaching client, or null.
CREATE OR REPLACE FUNCTION public.coach_automation_coach_of(_client uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT co.user_id
    FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
   WHERE c.id = _client AND c.service_tier = 'coaching' AND NOT coalesce(c.archived, false)
     AND co.status = 'Active' AND NOT coalesce(co.archived, false) AND co.user_id IS NOT NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.coach_automation_coach_of(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_automation_coach_of(uuid) TO service_role;

-- ── 2. A workout review that says something queues its reply ───────────────
-- A note, or a session rated 1 or 2 out of 5, in the client's own words (never a
-- review a coach wrote for them in View as client: review_updated_by is whoever
-- saved it). Three minutes of quiet first (they may still be editing it, or adding
-- pain, which makes it recovery's), one reply per review, only a review from the
-- last day. One the worker found had nothing to reply to is looked at again when
-- they change the note.
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
REVOKE ALL ON FUNCTION public.tg_workout_feedback_queue_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS workout_feedback_queue_reply ON public.pl_workout_feedback;
CREATE TRIGGER workout_feedback_queue_reply AFTER INSERT OR UPDATE OF client_note, overall_rating, pain ON public.pl_workout_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_workout_feedback_queue_reply();

-- ── 3. A weekly check-in's recap being ready queues its reply ──────────────
-- Only the first time its recap is ready (a coach's Redo doesn't queue another),
-- only a check-in sent in the last two days that nobody has replied to.
CREATE OR REPLACE FUNCTION public.tg_messenger_checkin_queue_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_coach uuid;
  v_mode text;
BEGIN
  IF NEW.ai_status IS DISTINCT FROM 'ready' OR OLD.ai_status IS NOT DISTINCT FROM 'ready' THEN RETURN NEW; END IF;
  IF NEW.task_type IS DISTINCT FROM 'weekly_checkin' THEN RETURN NEW; END IF;
  IF NEW.status <> 'completed' OR NEW.submitted_at IS NULL OR NEW.submitted_at < now() - interval '2 days' THEN RETURN NEW; END IF;
  IF NEW.reviewed_at IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN RETURN NEW; END IF;
  v_coach := public.coach_automation_coach_of(NEW.client_id);
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  v_mode := public.coach_automation_mode_for(v_coach, NEW.client_id, 'checkin_reply');
  IF v_mode = 'off' THEN RETURN NEW; END IF;
  INSERT INTO public.coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, source_id, status, due_at)
  VALUES (v_coach, NEW.client_id, 'checkin_reply', 'checkin_reply:' || NEW.id, 'checkin', NEW.id, 'queued', now())
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_messenger_checkin_queue_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messenger_checkin_queue_reply ON public.messenger_checkins;
CREATE TRIGGER messenger_checkin_queue_reply AFTER UPDATE OF ai_status ON public.messenger_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tg_messenger_checkin_queue_reply();

-- Once he's replied to a check-in (or marked it reviewed), its waiting reply is no
-- longer needed. A run writing it loses its hold (held()), so nothing of it lands.
CREATE OR REPLACE FUNCTION public.tg_messenger_checkin_reviewed_cancels_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.reviewed_at IS NULL OR OLD.reviewed_at IS NOT NULL THEN RETURN NEW; END IF;
  WITH gone AS (
    UPDATE public.coach_automation_items i
       SET status = 'cancelled', why = 'You replied to the check-in yourself', locked_at = NULL, updated_at = now()
     WHERE i.dedupe_key = 'checkin_reply:' || NEW.id
       AND i.status IN ('queued', 'working', 'draft', 'awaiting_approval', 'failed')
    RETURNING i.id, i.coach_user_id, i.client_id
  )
  INSERT INTO public.coach_automation_events (item_id, coach_user_id, client_id, kind, detail)
  SELECT id, coach_user_id, client_id, 'cancelled', jsonb_build_object('why', 'replied to the check-in') FROM gone;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_messenger_checkin_reviewed_cancels_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messenger_checkin_reviewed_cancels_reply ON public.messenger_checkins;
CREATE TRIGGER messenger_checkin_reviewed_cancels_reply AFTER UPDATE OF reviewed_at ON public.messenger_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tg_messenger_checkin_reviewed_cancels_reply();

-- ── 3b. Pain replies: the client's own report only ─────────────────────────
-- pain_reports.created_by is whoever saved it (auth.uid(), empty when the server
-- saves for a coach in View as client), so a coach's report for a client never
-- queues a reply to them. Otherwise as 20270509100000.
CREATE OR REPLACE FUNCTION public.tg_pain_reports_queue_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_coach uuid;
  v_mode text;
BEGIN
  IF NEW.source <> 'review' OR NEW.feedback_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.reported_at < now() - interval '1 day' THEN RETURN NEW; END IF;
  IF NEW.created_by IS NULL
     OR NEW.created_by IS DISTINCT FROM (SELECT c.user_id FROM public.clients c WHERE c.id = NEW.client_id) THEN
    RETURN NEW;
  END IF;
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
REVOKE ALL ON FUNCTION public.tg_pain_reports_queue_reply() FROM PUBLIC, anon, authenticated;

-- ── 3c. An approved reply closes only what it answers ──────────────────────
-- A message the coach approves from the queue is his own reply (not automated),
-- so it used to mark every unreviewed check-in and form reviewed. Only a reply to
-- a check-in does that now; a reply about pain, a workout or a missed session
-- leaves them waiting. Otherwise as 20261007100000_checkin_reviewed_state.sql.
CREATE OR REPLACE FUNCTION public.tg_staff_reply_closes_reviews()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.sender_role = 'client'
     or coalesce(new.is_internal_note, false)
     or coalesce(new.is_automated, false)
     or new.deleted_at is not null
     or new.scheduled_at is not null
     or coalesce(new.attachments::text, '') ilike '%form_request%' then
    return new;
  end if;
  if jsonb_typeof(new.attachments) = 'array' and exists (
    select 1 from jsonb_array_elements(new.attachments) a
     where a ->> 'kind' = 'recovery_auto' and coalesce(a ->> 'category', '') <> 'checkin_reply'
  ) then
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

-- ── 4. Once a day, the worker looks for missed sessions ────────────────────
-- 15:17 UTC is 10:17 in Manitoba: late enough that yesterday is over in every
-- client's time zone in North America, early enough to still mean something.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'coach-automation-missed-scan';
  PERFORM cron.schedule(
    'coach-automation-missed-scan',
    '17 15 * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/coach-automation-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{"scan":"missed"}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
    $cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
    NULL;
END
$$;

RESET lock_timeout;
