-- Coaching automation: the rest of the client updates (Nov 23 2026).
--
-- Two more kinds on the same queue, levels and safeguards
-- (20270509100000_cleo_capabilities_recovery_automation.sql,
-- 20270510100000_coaching_automation_categories.sql):
--
--   video_reply     a reply to the set videos a client sent that day (one
--                   reply for the day's videos, written 30 quiet minutes after
--                   the last one, so a workout's sets are answered together).
--   progress_reply  a reply to a progress check-in (photos or a video) once
--                   it's sent for review.
--
-- Both need the coach's own eyes on what they answer, so neither ever goes out
-- by itself: coach_automation_mode_allowed refuses "automatic" for them at
-- every level, so a setting can never send one, and mode_for steps any stored
-- "automatic" down to asking him. The draft only uses the records (the set's
-- numbers, a bar-speed read, the bodyweight trend), never how anything looked.
--
-- And workout replies now also answer a headline PR when the review says
-- nothing else: every review the client writes is queued, and the worker
-- decides (a note, a low rating, or an all-time PR on the session's main lift
-- or a barbell squat, bench or deadlift); one with nothing to answer is
-- cancelled and looked at again if they change the note. A note changed while
-- its reply waits for him has the reply written again.
--
-- And My Voice (coach_voice) is the owner's: only the owner reads it through
-- RLS (it was every coach), and the server functions refuse anyone else.
--
-- Rollback: docs/rollback/2026-11-23-coaching-automation-videos-progress-rollback.sql

SET lock_timeout = '3s';

-- ── 1. The categories ──────────────────────────────────────────────────────
ALTER TABLE public.coach_automation_items DROP CONSTRAINT IF EXISTS coach_automation_items_category_check;
ALTER TABLE public.coach_automation_items ADD CONSTRAINT coach_automation_items_category_check
  CHECK (category IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session', 'video_reply', 'progress_reply'));
ALTER TABLE public.coach_automation_items DROP CONSTRAINT IF EXISTS coach_automation_items_source_kind_check;
ALTER TABLE public.coach_automation_items ADD CONSTRAINT coach_automation_items_source_kind_check
  CHECK (source_kind IN ('review', 'follow_up', 'workout', 'checkin', 'missed', 'video', 'progress'));
ALTER TABLE public.coach_automation_client_rules DROP CONSTRAINT IF EXISTS coach_automation_client_rules_category_check;
ALTER TABLE public.coach_automation_client_rules ADD CONSTRAINT coach_automation_client_rules_category_check
  CHECK (category IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session', 'video_reply', 'progress_reply'));

CREATE OR REPLACE FUNCTION public.coach_automation_modes_valid(_modes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(_modes) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(_modes) e
        WHERE e.key NOT IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session', 'video_reply', 'progress_reply')
           OR jsonb_typeof(e.value) <> 'string'
           OR (e.value #>> '{}') NOT IN ('off', 'manual', 'approval', 'automatic')
     )
$$;

-- What a mode needs: the approval queue for anything; follow-ups for anything
-- the coach starts himself (a follow-up, a missed session); auto-send to send,
-- and never for a reply that needs his eyes (a video, progress photos).
CREATE OR REPLACE FUNCTION public.coach_automation_mode_allowed(_uid uuid, _category text, _mode text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _mode = 'off' THEN true
    WHEN _category NOT IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session', 'video_reply', 'progress_reply') THEN false
    WHEN NOT public.cleo_has_feature(_uid, 'automation.approval_queue') THEN false
    WHEN _category IN ('recovery_follow_up', 'missed_session') AND NOT public.cleo_has_feature(_uid, 'automation.follow_ups') THEN false
    WHEN _mode = 'automatic' AND _category IN ('video_reply', 'progress_reply') THEN false
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
  IF _category NOT IN ('recovery_reply', 'recovery_follow_up', 'workout_reply', 'checkin_reply', 'missed_session', 'video_reply', 'progress_reply') THEN
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

-- ── 2. Every review the client writes is looked at ─────────────────────────
-- The worker decides whether it's worth a reply (a note, a low rating, a
-- headline PR). A changed note gets a waiting reply written again. Otherwise as
-- 20270510100000.
CREATE OR REPLACE FUNCTION public.tg_workout_feedback_queue_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_coach uuid;
  v_mode text;
  v_note_changed boolean := TG_OP = 'UPDATE' AND NEW.client_note IS DISTINCT FROM OLD.client_note;
BEGIN
  IF coalesce(NEW.pain, false) THEN RETURN NEW; END IF;
  IF NEW.created_at < now() - interval '1 day' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT v_note_changed AND NEW.overall_rating IS NOT DISTINCT FROM OLD.overall_rating THEN
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
        attempts = 0, why = NULL, context = NULL, locked_at = NULL, updated_at = now()
    WHERE coach_automation_items.status = 'queued'
       OR (coach_automation_items.status = 'cancelled' AND coalesce((coach_automation_items.context ->> 'not_useful')::boolean, false))
       OR (v_note_changed AND coach_automation_items.status IN ('awaiting_approval', 'draft'));
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- never fail the athlete's review because of automation
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_workout_feedback_queue_reply() FROM PUBLIC, anon, authenticated;

-- ── 3. Set videos: one reply for the day's videos ──────────────────────────
-- A set video's chat message is written after its row (set_video_attach), and a
-- chat video becomes a set video later (chat_video_lift), so this fires when
-- the row gets its message. Only a video the client sent themselves (its
-- message is theirs), from the last day; keyed by the client and the day the
-- message went in their own time zone; each new video pushes the reply back to
-- 30 minutes after it and has a waiting one written again with it.
CREATE OR REPLACE FUNCTION public.tg_pl_set_videos_queue_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_coach uuid;
  v_mode text;
  v_user uuid;
  v_tz text;
  v_sent timestamptz;
  v_day date;
BEGIN
  IF NEW.message_id IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.message_id IS NOT DISTINCT FROM NEW.message_id THEN RETURN NEW; END IF;
  SELECT c.user_id, coalesce(nullif(c.timezone, ''), 'America/Winnipeg') INTO v_user, v_tz
    FROM public.clients c WHERE c.id = NEW.client_id;
  IF v_user IS NULL THEN RETURN NEW; END IF;
  SELECT m.created_at INTO v_sent FROM public.messages m
   WHERE m.id = NEW.message_id AND m.client_id = NEW.client_id
     AND m.sender_role = 'client' AND m.sender_id = v_user AND m.deleted_at IS NULL;
  IF v_sent IS NULL OR v_sent < now() - interval '1 day' THEN RETURN NEW; END IF;
  v_coach := public.coach_automation_coach_of(NEW.client_id);
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  v_mode := public.coach_automation_mode_for(v_coach, NEW.client_id, 'video_reply');
  IF v_mode = 'off' THEN RETURN NEW; END IF;
  v_day := public.instant_to_local(v_sent, v_tz)::date;
  INSERT INTO public.coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, source_id, status, due_at, context)
  VALUES (v_coach, NEW.client_id, 'video_reply', 'video_reply:' || NEW.client_id || ':' || v_day, 'video', NEW.id, 'queued',
          now() + interval '30 minutes', jsonb_build_object('day', v_day))
  ON CONFLICT (dedupe_key) DO UPDATE
    SET status = 'queued', due_at = greatest(coach_automation_items.due_at, now() + interval '30 minutes'),
        attempts = 0, why = NULL, locked_at = NULL, context = jsonb_build_object('day', v_day), updated_at = now()
    WHERE coach_automation_items.status IN ('queued', 'awaiting_approval', 'draft', 'failed');
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- never fail a set video because of automation
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_pl_set_videos_queue_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pl_set_videos_queue_reply ON public.pl_set_videos;
CREATE TRIGGER pl_set_videos_queue_reply AFTER INSERT OR UPDATE OF message_id ON public.pl_set_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_set_videos_queue_reply();

-- ── 4. A progress check-in sent for review ─────────────────────────────────
-- A coaching client's own submission (user_id is theirs) turning
-- awaiting_review, sent in the last two days. Ten quiet minutes first.
CREATE OR REPLACE FUNCTION public.tg_progress_submissions_queue_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_coach uuid;
  v_mode text;
BEGIN
  IF NEW.owner_type::text <> 'client' OR NEW.client_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.review_status::text <> 'awaiting_review' OR NEW.reviewed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.submitted_at IS NULL OR NEW.submitted_at < now() - interval '2 days' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.review_status::text = 'awaiting_review' AND OLD.submitted_at IS NOT DISTINCT FROM NEW.submitted_at THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM (SELECT c.user_id FROM public.clients c WHERE c.id = NEW.client_id) THEN RETURN NEW; END IF;
  v_coach := public.coach_automation_coach_of(NEW.client_id);
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  v_mode := public.coach_automation_mode_for(v_coach, NEW.client_id, 'progress_reply');
  IF v_mode = 'off' THEN RETURN NEW; END IF;
  INSERT INTO public.coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, source_id, status, due_at)
  VALUES (v_coach, NEW.client_id, 'progress_reply', 'progress_reply:' || NEW.id, 'progress', NEW.id, 'queued', now() + interval '10 minutes')
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_progress_submissions_queue_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS progress_submissions_queue_reply ON public.progress_submissions;
CREATE TRIGGER progress_submissions_queue_reply AFTER INSERT OR UPDATE OF review_status, submitted_at ON public.progress_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_progress_submissions_queue_reply();

-- Once he's reviewed it (or asked for an update), its waiting reply is no longer needed.
CREATE OR REPLACE FUNCTION public.tg_progress_submissions_reviewed_cancels_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.review_status::text = 'awaiting_review' AND NEW.reviewed_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.review_status::text IS NOT DISTINCT FROM NEW.review_status::text AND OLD.reviewed_at IS NOT DISTINCT FROM NEW.reviewed_at THEN
    RETURN NEW;
  END IF;
  WITH gone AS (
    UPDATE public.coach_automation_items i
       SET status = 'cancelled', why = 'You reviewed the check-in yourself', locked_at = NULL, updated_at = now()
     WHERE i.dedupe_key = 'progress_reply:' || NEW.id
       AND i.status IN ('queued', 'working', 'draft', 'awaiting_approval', 'failed')
    RETURNING i.id, i.coach_user_id, i.client_id
  )
  INSERT INTO public.coach_automation_events (item_id, coach_user_id, client_id, kind, detail)
  SELECT id, coach_user_id, client_id, 'cancelled', jsonb_build_object('why', 'reviewed the progress check-in') FROM gone;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_progress_submissions_reviewed_cancels_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS progress_submissions_reviewed_cancels_reply ON public.progress_submissions;
CREATE TRIGGER progress_submissions_reviewed_cancels_reply AFTER UPDATE OF review_status, reviewed_at ON public.progress_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_progress_submissions_reviewed_cancels_reply();

-- ── 5. My Voice is the owner's ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff read coach voice" ON public.coach_voice;
DROP POLICY IF EXISTS "Owner reads coach voice" ON public.coach_voice;
CREATE POLICY "Owner reads coach voice" ON public.coach_voice
  FOR SELECT TO authenticated
  USING ((SELECT public.is_business_owner((SELECT auth.uid()))));

RESET lock_timeout;
