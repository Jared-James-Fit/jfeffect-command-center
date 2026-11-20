-- Pain, tracked over time (Nov 20 2026).
--
-- The review's "Anything hurt?" picked places off a grid of 12 chips into one
-- free-text pain_area ("Shoulder (L), Other") with one level for all of them.
-- Half of all reports were "Other" with the real place only in the note, and
-- nothing could say whether a shoulder that keeps coming up is better, the
-- same or worse. Now each place is its own dated report (src/lib/pain/):
-- where and which side, how bad, and, only if the athlete adds them, what set
-- it off (an exercise from that workout), how it feels, whether it changed the
-- session and a note. A place that came up before asks "Same as Nov 16?":
-- only that answer ties two reports together (`same_issue`, `continues_id`);
-- two reports in one spot are never assumed to be one injury.
--
-- pl_workout_feedback keeps pain / pain_area / pain_level, filled from the
-- reports (pain_area in the format it always had), so the coach's chat card,
-- the inbox's Pain filter, Program Intelligence and older apps read it as
-- before. Older reviews are read as stored (pain/history.ts), never rewritten.
--
-- Access: the athlete reads their own, their coach and admins read their
-- clients', a linked login reads its own client account's. Nobody writes the
-- table directly: pain_reports_save (below) checks who's asking and writes.

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.pain_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- where it was reported: a workout's review, or a weekly check-in
  feedback_id uuid REFERENCES public.pl_workout_feedback(id) ON DELETE CASCADE,
  checkin_id uuid REFERENCES public.messenger_checkins(id) ON DELETE CASCADE,
  day_id uuid,
  completion_id uuid,
  source text NOT NULL CHECK (source IN ('review', 'checkin')),
  -- the athlete's day (their clock) and the moment
  reported_on date NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  region text NOT NULL CHECK (region IN (
    'neck', 'shoulder', 'chest', 'upper_arm', 'elbow', 'wrist_hand',
    'upper_back', 'shoulder_blade', 'mid_back', 'low_back', 'abs',
    'hip_groin', 'glute', 'quad', 'hamstring', 'knee', 'shin', 'calf', 'ankle_foot', 'other')),
  side text CHECK (side IN ('L', 'R')),
  severity text NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  trigger text CHECK (trigger IN ('training', 'exercise', 'daily', 'unsure')),
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  exercise_name text CHECK (char_length(exercise_name) <= 120),
  feel text[] NOT NULL DEFAULT '{}'
    CHECK (feel <@ ARRAY['sore', 'tight', 'ache', 'sharp', 'pinch', 'numb', 'swollen', 'pop']::text[]),
  impact text CHECK (impact IN ('none', 'modified', 'stopped')),
  -- "Same as <date>?": true = the same issue (then `change` and `continues_id`), false = something new, null = not asked
  same_issue boolean,
  change text CHECK (change IN ('better', 'same', 'worse')),
  continues_id uuid REFERENCES public.pain_reports(id) ON DELETE SET NULL,
  note text CHECK (char_length(note) <= 300),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((feedback_id IS NOT NULL) <> (checkin_id IS NOT NULL)),
  CHECK (change IS NULL OR same_issue)
);

CREATE INDEX IF NOT EXISTS pain_reports_client_day ON public.pain_reports (client_id, reported_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pain_reports_feedback_place ON public.pain_reports (feedback_id, region, (coalesce(side, ''))) WHERE feedback_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pain_reports_checkin_place ON public.pain_reports (checkin_id, region, (coalesce(side, ''))) WHERE checkin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pain_reports_continues ON public.pain_reports (continues_id) WHERE continues_id IS NOT NULL;

ALTER TABLE public.pain_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own pain reports" ON public.pain_reports;
CREATE POLICY "Clients read own pain reports" ON public.pain_reports FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff read pain reports" ON public.pain_reports;
CREATE POLICY "Staff read pain reports" ON public.pain_reports FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));

DROP POLICY IF EXISTS "Linked login reads own pain reports" ON public.pain_reports;
CREATE POLICY "Linked login reads own pain reports" ON public.pain_reports FOR SELECT TO authenticated
  USING (client_id = (SELECT public.linked_client_id()));

REVOKE ALL ON public.pain_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.pain_reports FROM authenticated;
GRANT SELECT ON public.pain_reports TO authenticated;
GRANT ALL ON public.pain_reports TO service_role;

-- Save a review's (or a check-in's) places: one row per place, updated in
-- place so a later report that points at one keeps pointing at it; places no
-- longer sent are removed. The athlete themselves, an admin, their assigned
-- coach ("View as client") or the server (which checked first) may call it.
CREATE OR REPLACE FUNCTION public.pain_reports_save(_feedback_id uuid, _checkin_id uuid, _reports jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  v_day uuid;
  v_completion uuid;
  v_at timestamptz;
  v_tz text;
  v_on date;
  v_source text;
  r jsonb;
  v_region text;
  v_side text;
  v_feel text[];
  v_same boolean;
  v_continues uuid;
  v_exercise uuid;
  v_id uuid;
  v_keep uuid[] := '{}';
  v_count integer := 0;
BEGIN
  IF (_feedback_id IS NULL) = (_checkin_id IS NULL) THEN
    RAISE EXCEPTION 'pain_reports_save: pass a review or a check-in';
  END IF;
  IF _reports IS NULL OR jsonb_typeof(_reports) <> 'array' OR jsonb_array_length(_reports) > 12 THEN
    RAISE EXCEPTION 'pain_reports_save: reports must be a list of at most 12';
  END IF;

  IF _feedback_id IS NOT NULL THEN
    SELECT f.client_id, f.day_id, f.completion_id, coalesce(pc.completed_at, pc.started_at, f.created_at, now())
      INTO v_client, v_day, v_completion, v_at
      FROM public.pl_workout_feedback f
      LEFT JOIN public.pl_day_completions pc ON pc.id = f.completion_id
     WHERE f.id = _feedback_id;
    v_source := 'review';
  ELSE
    SELECT m.client_id, coalesce(m.submitted_at, m.created_at, now())
      INTO v_client, v_at
      FROM public.messenger_checkins m
     WHERE m.id = _checkin_id;
    v_source := 'checkin';
  END IF;
  IF v_client IS NULL THEN RAISE EXCEPTION 'pain_reports_save: not found'; END IF;

  IF NOT (
       coalesce((SELECT auth.role()), '') = 'service_role'
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client AND c.user_id = v_uid)
    OR (v_uid IS NOT NULL AND coalesce(public.has_role(v_uid, 'admin'::app_role), false))
    OR v_client IN (SELECT public.coached_client_ids())
  ) THEN
    RAISE EXCEPTION 'pain_reports_save: not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(nullif(c.timezone, ''), 'America/Winnipeg') INTO v_tz FROM public.clients c WHERE c.id = v_client;
  v_on := public.instant_to_local(v_at, v_tz)::date;

  FOR r IN SELECT * FROM jsonb_array_elements(_reports) LOOP
    v_region := r->>'region';
    v_side := nullif(r->>'side', '');
    IF v_side IS NOT NULL AND v_side NOT IN ('L', 'R') THEN v_side := NULL; END IF;
    v_feel := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(coalesce(r->'feel', '[]'::jsonb)) x
                     WHERE x IN ('sore', 'tight', 'ache', 'sharp', 'pinch', 'numb', 'swollen', 'pop'));
    v_same := CASE WHEN jsonb_typeof(r->'sameIssue') = 'boolean' THEN (r->>'sameIssue')::boolean END;
    -- a link only to an earlier report of theirs, never one from this same review
    v_continues := NULL;
    IF v_same AND coalesce(r->>'continuesId', '') ~ '^[0-9a-f-]{36}$' THEN
      SELECT p.id INTO v_continues FROM public.pain_reports p
       WHERE p.id = (r->>'continuesId')::uuid AND p.client_id = v_client
         AND p.feedback_id IS DISTINCT FROM _feedback_id AND p.checkin_id IS DISTINCT FROM _checkin_id;
    END IF;
    v_exercise := NULL;
    IF r->>'trigger' = 'exercise' AND coalesce(r->>'exerciseId', '') ~ '^[0-9a-f-]{36}$' THEN
      SELECT e.id INTO v_exercise FROM public.exercises e WHERE e.id = (r->>'exerciseId')::uuid;
    END IF;

    SELECT p.id INTO v_id FROM public.pain_reports p
     WHERE p.region = v_region AND coalesce(p.side, '') = coalesce(v_side, '')
       AND ((_feedback_id IS NOT NULL AND p.feedback_id = _feedback_id) OR (_checkin_id IS NOT NULL AND p.checkin_id = _checkin_id));

    IF v_id IS NULL THEN
      INSERT INTO public.pain_reports (
        client_id, feedback_id, checkin_id, day_id, completion_id, source, reported_on, reported_at,
        region, side, severity, trigger, exercise_id, exercise_name, feel, impact, same_issue, change, continues_id, note, created_by)
      VALUES (
        v_client, _feedback_id, _checkin_id, v_day, v_completion, v_source, v_on, v_at,
        v_region, v_side, r->>'severity', nullif(r->>'trigger', ''), v_exercise,
        CASE WHEN r->>'trigger' = 'exercise' THEN left(nullif(btrim(r->>'exerciseName'), ''), 120) END,
        v_feel, nullif(r->>'impact', ''), v_same,
        CASE WHEN v_same THEN nullif(r->>'change', '') END, v_continues,
        left(nullif(btrim(r->>'note'), ''), 300), v_uid)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.pain_reports SET
        reported_on = v_on, reported_at = v_at, day_id = v_day, completion_id = v_completion,
        severity = r->>'severity', trigger = nullif(r->>'trigger', ''), exercise_id = v_exercise,
        exercise_name = CASE WHEN r->>'trigger' = 'exercise' THEN left(nullif(btrim(r->>'exerciseName'), ''), 120) END,
        feel = v_feel, impact = nullif(r->>'impact', ''), same_issue = v_same,
        change = CASE WHEN v_same THEN nullif(r->>'change', '') END, continues_id = v_continues,
        note = left(nullif(btrim(r->>'note'), ''), 300), updated_at = now()
      WHERE id = v_id;
    END IF;
    v_keep := v_keep || v_id;
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.pain_reports p
   WHERE ((_feedback_id IS NOT NULL AND p.feedback_id = _feedback_id) OR (_checkin_id IS NOT NULL AND p.checkin_id = _checkin_id))
     AND NOT (p.id = ANY (v_keep));
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pain_reports_save(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pain_reports_save(uuid, uuid, jsonb) TO authenticated, service_role;

-- What the coach did about a client's pain: looked at it ("reviewed" through
-- the latest report, so the dashboard stops asking until something new comes
-- in), a reply the AI drafted, and which recovery suggestions went out in a
-- reply they used (so the same one isn't suggested again for a few weeks).
-- Staff only; the athlete never reads it.
CREATE TABLE IF NOT EXISTS public.pain_coach_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reviewed', 'draft', 'used')),
  -- the latest report it covered
  through_at timestamptz,
  regions text[] NOT NULL DEFAULT '{}',
  suggestion_keys text[] NOT NULL DEFAULT '{}',
  draft text CHECK (char_length(draft) <= 2000),
  insights jsonb,
  model text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pain_coach_reviews_client ON public.pain_coach_reviews (client_id, created_at DESC);

ALTER TABLE public.pain_coach_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read pain coach reviews" ON public.pain_coach_reviews;
CREATE POLICY "Staff read pain coach reviews" ON public.pain_coach_reviews FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff add pain coach reviews" ON public.pain_coach_reviews;
CREATE POLICY "Staff add pain coach reviews" ON public.pain_coach_reviews FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid())
    AND ((SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)) OR client_id IN (SELECT public.coached_client_ids())));
REVOKE ALL ON public.pain_coach_reviews FROM anon;
REVOKE UPDATE, DELETE ON public.pain_coach_reviews FROM authenticated;
GRANT SELECT, INSERT ON public.pain_coach_reviews TO authenticated;
GRANT ALL ON public.pain_coach_reviews TO service_role;

-- The chat card's preview says "severe", the review's word (was "sharp").
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
                ELSE 'severe' END;
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
