-- A coaching client's workout notes go to their coach in Messages.
--
-- What the athlete tells the coach while training (a note on an exercise) or
-- after it (the review's note, and pain: where, which side, how bad) becomes
-- one message from them in their coach chat: a "workout_note" card the coach
-- sees in the inbox (it needs a reply), with a push from the app. The card
-- reads the note itself (like a check-in card reads its check-in), so an edit
-- shows on it without rewriting the message; a change made later (or pain
-- flagged on an edit) posts a new card, and the old one points to it.
--
-- Only for a coaching client writing it themselves: a member has no coach,
-- and a coach editing in "View as client" isn't the athlete talking.
ALTER TABLE public.pl_workout_feedback ADD COLUMN IF NOT EXISTS coach_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.pl_exercise_notes ADD COLUMN IF NOT EXISTS coach_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

-- The athlete sending it: a coaching client, signed in as themselves. NULL = nothing goes to the coach.
CREATE OR REPLACE FUNCTION public.workout_note_sender(_client_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT c.user_id
    FROM public.clients c
   WHERE c.id = _client_id
     AND c.service_tier = 'coaching'
     AND NOT coalesce(c.archived, false)
     AND c.user_id IS NOT NULL
     AND c.user_id = (SELECT auth.uid())
$$;
REVOKE ALL ON FUNCTION public.workout_note_sender(uuid) FROM PUBLIC, anon;

-- A new card only when there's no live one yet, or the live one is more than
-- 10 minutes old (quick re-edits just show on the card), or pain was just flagged.
CREATE OR REPLACE FUNCTION public.workout_note_needs_card(_msg uuid, _pain_added boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _msg IS NULL
      OR _pain_added
      OR NOT EXISTS (
           SELECT 1 FROM public.messages m
            WHERE m.id = _msg AND m.deleted_at IS NULL AND m.created_at > now() - interval '10 minutes')
$$;
REVOKE ALL ON FUNCTION public.workout_note_needs_card(uuid, boolean) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.tg_workout_feedback_to_coach()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_sender uuid;
  v_note text := nullif(btrim(coalesce(NEW.client_note, '')), '');
  v_pain boolean := coalesce(NEW.pain, false);
  v_pain_added boolean := false;
  v_sev text;
  v_title text;
  v_at timestamptz;
  v_body text;
  v_msg uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.client_note IS NOT DISTINCT FROM OLD.client_note
     AND NEW.pain IS NOT DISTINCT FROM OLD.pain
     AND NEW.pain_area IS NOT DISTINCT FROM OLD.pain_area
     AND NEW.pain_level IS NOT DISTINCT FROM OLD.pain_level THEN
    RETURN NEW;
  END IF;
  -- nothing to tell the coach (a removed note shows as removed on its card)
  IF v_note IS NULL AND NOT v_pain THEN RETURN NEW; END IF;
  v_sender := public.workout_note_sender(NEW.client_id);
  IF v_sender IS NULL THEN RETURN NEW; END IF;
  v_pain_added := v_pain AND TG_OP = 'UPDATE' AND NOT coalesce(OLD.pain, false);
  IF NOT public.workout_note_needs_card(NEW.coach_message_id, v_pain_added) THEN RETURN NEW; END IF;

  v_sev := CASE WHEN NOT v_pain OR NEW.pain_level IS NULL THEN NULL
                WHEN NEW.pain_level <= 3 THEN 'mild'
                WHEN NEW.pain_level <= 6 THEN 'moderate'
                ELSE 'sharp' END;
  SELECT d.title INTO v_title FROM public.pl_days d WHERE d.id = NEW.day_id;
  SELECT coalesce(pc.completed_at, pc.started_at) INTO v_at FROM public.pl_day_completions pc WHERE pc.id = NEW.completion_id;
  -- what the inbox and lock screen preview say; the card shows the rest
  v_body := left(
    CASE WHEN v_pain
      THEN '⚠️ Pain' || coalesce(': ' || nullif(NEW.pain_area, ''), '') || coalesce(' · ' || v_sev, '') || coalesce(' · ' || v_note, '')
      ELSE '📝 ' || v_note END,
    400);

  INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, delivery_status, sent_at, read_by_client_at)
  VALUES (
    NEW.client_id, v_sender, 'client', v_body,
    jsonb_build_array(jsonb_build_object(
      'type', 'file', 'url', '', 'kind', 'workout_note', 'source', 'review',
      'feedback_id', NEW.id, 'day_id', NEW.day_id, 'completion_id', NEW.completion_id,
      'workout', v_title, 'at', coalesce(v_at, now()),
      'note', v_note,
      'pain', CASE WHEN v_pain THEN jsonb_build_object('area', NEW.pain_area, 'level', NEW.pain_level) END,
      'rpe', NEW.session_rpe)),
    'Workout Note', 'sent', now(), now())
  RETURNING id INTO v_msg;
  NEW.coach_message_id := v_msg;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_exercise_note_to_coach()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_sender uuid;
  v_note text := nullif(btrim(coalesce(NEW.content, '')), '');
  v_title text;
  v_msg uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.content IS NOT DISTINCT FROM OLD.content THEN RETURN NEW; END IF;
  IF v_note IS NULL THEN RETURN NEW; END IF;
  v_sender := public.workout_note_sender(NEW.client_id);
  IF v_sender IS NULL THEN RETURN NEW; END IF;
  IF NOT public.workout_note_needs_card(NEW.coach_message_id, false) THEN RETURN NEW; END IF;

  SELECT d.title INTO v_title FROM public.pl_days d WHERE d.id = NEW.day_id;
  INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, delivery_status, sent_at, read_by_client_at)
  VALUES (
    NEW.client_id, v_sender, 'client',
    left('📝 ' || coalesce(nullif(NEW.exercise_name, '') || ': ', '') || v_note, 400),
    jsonb_build_array(jsonb_build_object(
      'type', 'file', 'url', '', 'kind', 'workout_note', 'source', 'exercise',
      'note_id', NEW.id, 'day_id', NEW.day_id, 'row_id', NEW.row_id,
      'exercise', NEW.exercise_name, 'workout', v_title, 'at', now(),
      'note', v_note)),
    'Workout Note', 'sent', now(), now())
  RETURNING id INTO v_msg;
  NEW.coach_message_id := v_msg;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workout_feedback_to_coach ON public.pl_workout_feedback;
CREATE TRIGGER trg_workout_feedback_to_coach
  BEFORE INSERT OR UPDATE OF client_note, pain, pain_area, pain_level ON public.pl_workout_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_workout_feedback_to_coach();

DROP TRIGGER IF EXISTS trg_exercise_note_to_coach ON public.pl_exercise_notes;
CREATE TRIGGER trg_exercise_note_to_coach
  BEFORE INSERT OR UPDATE OF content ON public.pl_exercise_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_exercise_note_to_coach();

-- The coach's notes log: everything a client has told them in their workouts
-- (review notes, pain, exercise notes), newest first. Staff who can see the
-- client, or the client themselves.
CREATE OR REPLACE FUNCTION public.client_workout_notes(_client_id uuid, _limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_role(uid, 'admin') OR public.is_assigned_coach(_client_id)
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.user_id = uid)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(s.x ORDER BY s.at DESC)
      FROM (
        SELECT u.x, u.at
          FROM (
            SELECT coalesce(pc.completed_at, f.review_submitted_at, f.created_at) AS at,
                   jsonb_build_object(
                     'id', f.id, 'source', 'review', 'at', coalesce(pc.completed_at, f.review_submitted_at, f.created_at),
                     'edited_at', f.review_last_edited_at, 'day_id', f.day_id, 'row_id', NULL, 'workout', d.title, 'exercise', NULL,
                     'note', nullif(btrim(coalesce(f.client_note, '')), ''),
                     'pain', CASE WHEN f.pain THEN jsonb_build_object('area', f.pain_area, 'level', f.pain_level) END,
                     'rpe', f.session_rpe, 'message_id', f.coach_message_id) AS x
              FROM public.pl_workout_feedback f
              LEFT JOIN public.pl_days d ON d.id = f.day_id
              LEFT JOIN public.pl_day_completions pc ON pc.id = f.completion_id
             WHERE f.client_id = _client_id AND (f.pain OR nullif(btrim(coalesce(f.client_note, '')), '') IS NOT NULL)
            UNION ALL
            SELECT n.created_at,
                   jsonb_build_object(
                     'id', n.id, 'source', 'exercise', 'at', n.created_at,
                     'edited_at', CASE WHEN n.status = 'edited' THEN n.updated_at END, 'day_id', n.day_id, 'row_id', n.row_id,
                     'workout', d.title, 'exercise', n.exercise_name, 'note', nullif(btrim(coalesce(n.content, '')), ''),
                     'pain', NULL, 'rpe', NULL, 'message_id', n.coach_message_id)
              FROM public.pl_exercise_notes n
              LEFT JOIN public.pl_days d ON d.id = n.day_id
             WHERE n.client_id = _client_id AND nullif(btrim(coalesce(n.content, '')), '') IS NOT NULL
          ) u
         ORDER BY u.at DESC
         LIMIT greatest(1, least(coalesce(_limit, 200), 500))
      ) s
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.client_workout_notes(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_workout_notes(uuid, int) TO authenticated, service_role;
