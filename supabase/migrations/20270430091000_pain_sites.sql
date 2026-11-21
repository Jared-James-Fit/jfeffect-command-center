-- Pain, where exactly (Nov 21 2026).
--
-- The review's "Anything hurt?" is now an anatomical body map (front, back,
-- side and a deeper layer): an athlete taps the exact spot they feel it, the
-- left side delt, the patellar tendon, the inside of the elbow, rates it 0–10
-- and, if they like, says what it feels like and when it hurts (during
-- exercise, after training, at rest, certain movements) and which exercise.
-- Several spots in one region are each their own report.
--
-- What's added (nothing existing changes meaning):
--   site    the spot (src/lib/pain/sites.ts keys, never renamed); null = the
--           region in general, as every report before this
--   score   0–10; severity stays NOT NULL and is worked out from it
--           (0–3 mild, 4–6 moderate, 7–10 severe), so every reader of
--           severity reads it as before
--   timing  when it hurts; `trigger` (what set it off) is still filled from
--           it (an exercise named = exercise, during / after training =
--           training, only at rest = daily life) for the readers that use it
--   feel    takes 'burning' and 'other' too
--
-- A place is a region + side + spot, so the unique keys and the save
-- function's lookup include the spot. pain_reports_save still takes the older
-- app's reports (no spot, no score) exactly as before.

SET lock_timeout = '3s';

ALTER TABLE public.pain_reports
  ADD COLUMN IF NOT EXISTS site text CHECK (site IS NULL OR site ~ '^[a-z0-9_]{1,40}$'),
  ADD COLUMN IF NOT EXISTS score smallint CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS timing text[] NOT NULL DEFAULT '{}'
    CHECK (timing <@ ARRAY['during', 'after', 'rest', 'movement']::text[]);

ALTER TABLE public.pain_reports DROP CONSTRAINT IF EXISTS pain_reports_feel_check;
ALTER TABLE public.pain_reports ADD CONSTRAINT pain_reports_feel_check
  CHECK (feel <@ ARRAY['sore', 'tight', 'ache', 'sharp', 'pinch', 'numb', 'swollen', 'pop', 'burning', 'other']::text[]);

DROP INDEX IF EXISTS public.pain_reports_feedback_place;
DROP INDEX IF EXISTS public.pain_reports_checkin_place;
CREATE UNIQUE INDEX IF NOT EXISTS pain_reports_feedback_spot ON public.pain_reports (feedback_id, region, (coalesce(side, '')), (coalesce(site, ''))) WHERE feedback_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pain_reports_checkin_spot ON public.pain_reports (checkin_id, region, (coalesce(side, '')), (coalesce(site, ''))) WHERE checkin_id IS NOT NULL;

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
  v_site text;
  v_score smallint;
  v_severity text;
  v_timing text[];
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
  IF _reports IS NULL OR jsonb_typeof(_reports) <> 'array' OR jsonb_array_length(_reports) > 16 THEN
    RAISE EXCEPTION 'pain_reports_save: reports must be a list of at most 16';
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
    v_site := nullif(r->>'site', '');
    IF v_site IS NOT NULL AND v_site !~ '^[a-z0-9_]{1,40}$' THEN v_site := NULL; END IF;
    v_score := CASE WHEN jsonb_typeof(r->'score') = 'number' AND (r->>'score')::numeric BETWEEN 0 AND 10
                    THEN round((r->>'score')::numeric)::smallint END;
    v_severity := CASE WHEN v_score IS NULL THEN r->>'severity'
                       WHEN v_score <= 3 THEN 'mild'
                       WHEN v_score <= 6 THEN 'moderate'
                       ELSE 'severe' END;
    v_timing := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(coalesce(r->'timing', '[]'::jsonb)) x
                       WHERE x IN ('during', 'after', 'rest', 'movement'));
    v_feel := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(coalesce(r->'feel', '[]'::jsonb)) x
                     WHERE x IN ('sore', 'tight', 'ache', 'sharp', 'pinch', 'numb', 'swollen', 'pop', 'burning', 'other'));
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

    v_id := NULL;
    SELECT p.id INTO v_id FROM public.pain_reports p
     WHERE p.region = v_region AND coalesce(p.side, '') = coalesce(v_side, '') AND coalesce(p.site, '') = coalesce(v_site, '')
       AND ((_feedback_id IS NOT NULL AND p.feedback_id = _feedback_id) OR (_checkin_id IS NOT NULL AND p.checkin_id = _checkin_id));

    IF v_id IS NULL THEN
      INSERT INTO public.pain_reports (
        client_id, feedback_id, checkin_id, day_id, completion_id, source, reported_on, reported_at,
        region, side, site, severity, score, timing, trigger, exercise_id, exercise_name, feel, impact, same_issue, change, continues_id, note, created_by)
      VALUES (
        v_client, _feedback_id, _checkin_id, v_day, v_completion, v_source, v_on, v_at,
        v_region, v_side, v_site, v_severity, v_score, v_timing, nullif(r->>'trigger', ''), v_exercise,
        CASE WHEN r->>'trigger' = 'exercise' THEN left(nullif(btrim(r->>'exerciseName'), ''), 120) END,
        v_feel, nullif(r->>'impact', ''), v_same,
        CASE WHEN v_same THEN nullif(r->>'change', '') END, v_continues,
        left(nullif(btrim(r->>'note'), ''), 300), v_uid)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.pain_reports SET
        reported_on = v_on, reported_at = v_at, day_id = v_day, completion_id = v_completion,
        severity = v_severity, score = v_score, timing = v_timing,
        trigger = nullif(r->>'trigger', ''), exercise_id = v_exercise,
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
