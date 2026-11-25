-- A barbell set video's bar speed goes on its logged set, every time it can
-- honestly be read (Nov 25 2026, T19).
--
-- Why: a set's video was analysed ("set 3": 0.42 m/s across four reps) and the
-- speed never reached the logger. drizzle 0015 had made the writeback demand a
-- hand-confirmed plate diameter on every clip and an exact rep match, and the
-- phone read an unconfirmed plate in pixels only, so an automatic read could
-- never log anything without the athlete opening the scanner. The coach wants
-- every barbell set read and logged with no scanner step, tolerant of how
-- people really film (slightly off is fine; it is labelled ≈ and can be
-- corrected or flagged).
--
-- The rule (mirrors src/lib/lift-analysis/quality.ts SPEED_RULES; keep them in step):
--   * the phone's read passed (velocity_accepted), every rep complete and read;
--   * scale: a confirmed plate, OR a load that means 450 mm plates (60 kg+, not
--     bodyweight), OR every rep's range fits the movement at 450 mm
--     (velocity.plateCheck: a 230 mm plate taken for 450 mm doubles every range);
--   * tolerant limits: >= 24 fps, plate followed in 70 % of the clip, never lost
--     inside the set for more than 1.5 s, scale within 12 %, camera within ~53°
--     turned / ~41° otherwise (plate ratio 0.6 / 0.75), no camera movement,
--     margin within 35 % of the value;
--   * the logged reps within one of the video's (or none logged yet);
--   * a measurement only inside the strict limits with every rep measured and
--     the reps matching; otherwise an estimate (velocity_quality 'estimated').
--   * Olympic lifts (read.movement.metric = 'peak') log the mean of each rep's
--     peak bar speed instead of its mean concentric velocity.
-- A typed velocity (velocity_source 'device') is never overwritten; an excluded
-- read or set keeps its history (set_velocity_history) and can be put back.
--
-- Also: Olympic lifts, presses, rows and RDL variants are enqueued for
-- automatic reading (they were skipped), clips up to 120 s are read, a read
-- from a standard plate is 'done' rather than 'needs_calibration', and recent
-- jobs left waiting on calibration or skipped by the old name rule are queued
-- again so the next open of the app reads them.

-- ── which set videos are read automatically ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._velocity_analysable(_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN coalesce(trim(_name), '') = '' THEN false
    -- no plate to follow (src/lib/lift-analysis/exercise.ts NOT_A_BAR)
    WHEN lower(_name) ~ '\m(dumbbells?|db|cables?|bands?|kettlebells?|kb|bodyweight|pull[ -]?ups?|chin[ -]?ups?|dips?|push[ -]?ups?|planks?|carry|carries|sled|treadmill|bike|walk|run|running|leg press|hack squat|pendulum|belt squat|lat pull|pulldown|curl machine|pec deck|leg extension|leg curl|calf raise machine|landmine)\M' THEN false
    WHEN lower(_name) ~ '\mmachine\M' AND lower(_name) !~ '\msmith\M' THEN false
    ELSE lower(_name) ~ '\m(barbell|smith|trap bar|ez bar|larsen|spoto|floor press|pin press|jerks?|deadlifts?|dl|rack pulls?|block pulls?|deficit pulls?|cleans?|snatch(es)?|high pulls?|rows?|pendlay|overhead press|ohp|military press|push press|strict press|z press|hip thrusts?|glute bridges?|shrugs?|squats?|bench|rdls?|sldl|romanian|good mornings?|stiff[ -]?leg)\M'
  END
$$;
REVOKE ALL ON FUNCTION public._velocity_analysable(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._velocity_enqueue(_video uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s public.pl_set_videos; n text; eq text; en boolean;
BEGIN
  SELECT * INTO s FROM public.pl_set_videos WHERE id = _video;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(e.name, r.exercise_name_override, s.exercise_name, ''), coalesce(to_jsonb(e)->>'equipment', '')
    INTO n, eq
    FROM public.pl_exercise_rows r LEFT JOIN public.exercises e ON e.id = r.exercise_id
   WHERE r.id = s.row_id;
  n := coalesce(n, s.exercise_name, '');
  en := s.set_index > 0 AND s.deleted_at IS NULL AND coalesce(s.duration_s, 0) <= 120
        AND public._velocity_analysable(n || ' ' || coalesce(eq, ''));
  INSERT INTO public.set_velocity_jobs (set_video_id, client_id, exercise_id, exercise_name, enabled, status)
  SELECT s.id, s.client_id, r.exercise_id, n, en, CASE WHEN en THEN 'queued' ELSE 'skipped' END
    FROM public.pl_exercise_rows r WHERE r.id = s.row_id
  ON CONFLICT (set_video_id) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION public._velocity_enqueue(uuid) FROM PUBLIC, anon, authenticated;

-- ── the set's speed from its read ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._apply_video_velocity(_set_video_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.pl_set_videos; a public.pl_set_video_analyses; r public.pl_row_results;
  raw jsonb; q jsonb; metric text; field text;
  v numeric; u numeric; tier text; nr int := 0; ng int := 0; nm int := 0;
  err numeric; ratio numeric; scale_rel numeric; picked uuid; confirmed boolean; scale_ok boolean;
  num CONSTANT text := '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$';
BEGIN
  SELECT * INTO s FROM public.pl_set_videos WHERE id = _set_video_id;
  -- off any set this video no longer belongs to
  UPDATE public.pl_row_results
     SET mean_concentric_velocity_mps = NULL, velocity_source = NULL, velocity_set_video_id = NULL,
         velocity_quality = NULL, velocity_uncertainty = NULL
   WHERE velocity_set_video_id = _set_video_id AND velocity_source = 'video'
     AND (s.id IS NULL OR s.deleted_at IS NOT NULL OR s.result_id IS DISTINCT FROM id);
  IF s.id IS NULL OR s.result_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.pl_row_results WHERE id = s.result_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- a speed typed in (a device, or corrected by hand) is never overwritten
  IF r.velocity_source = 'device' AND r.mean_concentric_velocity_mps IS NOT NULL THEN
    RETURN r.mean_concentric_velocity_mps;
  END IF;

  SELECT x.* INTO a
    FROM public.pl_set_video_analyses x JOIN public.pl_set_videos sv ON sv.id = x.set_video_id
   WHERE sv.result_id = r.id AND sv.deleted_at IS NULL AND sv.set_index > 0
     AND x.status = 'done' AND NOT x.excluded AND x.velocity_accepted AND x.units = 'mm'
     AND (r.velocity_selected_video_id IS NULL OR r.velocity_selected_video_id = x.set_video_id)
   ORDER BY sv.created_at, sv.id
   LIMIT 1;

  IF FOUND AND NOT r.velocity_excluded THEN
    raw := a.result;
    picked := a.set_video_id;
    metric := coalesce(raw#>>'{movement,metric}', raw#>>'{velocity,metric}', 'mcv');
    field := CASE WHEN metric = 'peak' THEN 'peak' ELSE 'mcv' END;
    v := 0; u := 0;
    FOR q IN SELECT value FROM jsonb_array_elements(coalesce(raw->'reps', '[]'::jsonb)) LOOP
      nr := nr + 1;
      IF (q->>'complete')::boolean IS TRUE
         AND q#>>ARRAY[field, 'tier'] IN ('measured', 'estimated')
         AND (q#>>ARRAY[field, 'v']) ~ num
         AND (q#>>ARRAY[field, 'v'])::numeric > 0 AND (q#>>ARRAY[field, 'v'])::numeric <= 3.5 THEN
        ng := ng + 1;
        IF q#>>ARRAY[field, 'tier'] = 'measured' THEN nm := nm + 1; END IF;
        v := v + (q#>>ARRAY[field, 'v'])::numeric;
        u := u + power(CASE WHEN (q#>>ARRAY[field, 'u']) ~ num THEN (q#>>ARRAY[field, 'u'])::numeric
                            ELSE 0.1 * (q#>>ARRAY[field, 'v'])::numeric END, 2);
      END IF;
    END LOOP;
    IF nr > 0 AND nr = ng THEN
      v := v / nr;
      err := CASE WHEN (raw#>>'{calibration,relErr}') ~ num THEN (raw#>>'{calibration,relErr}')::numeric ELSE 1 END;
      ratio := CASE WHEN (raw#>>'{plate,ratio}') ~ num THEN (raw#>>'{plate,ratio}')::numeric ELSE 1 END;
      confirmed := coalesce((raw#>>'{plate,confirmed}')::boolean, false);
      scale_rel := sqrt(power(err, 2) + CASE WHEN confirmed THEN 0 ELSE power(0.02, 2) END);
      u := sqrt(u / power(nr, 2) + power(2 * scale_rel * v, 2));
      scale_ok := confirmed
        OR (NOT coalesce(r.is_bodyweight, false) AND coalesce(r.actual_load_kg, 0) >= 59.5)
        OR coalesce((raw#>>'{velocity,plateCheck}')::boolean, false);
      IF NOT scale_ok
         OR NOT coalesce((raw#>>'{calibration,ok}')::boolean, false)
         OR coalesce(CASE WHEN (raw->>'fps') ~ num THEN (raw->>'fps')::numeric END, 0) < 24
         OR coalesce(CASE WHEN (raw#>>'{quality,tracked}') ~ num THEN (raw#>>'{quality,tracked}')::numeric END, 0) < 0.7
         OR err > 0.12
         OR ratio < (CASE WHEN raw#>>'{plate,view}' = 'turned' THEN 0.6 ELSE 0.75 END)
         OR coalesce(raw#>'{quality,notes}', '[]'::jsonb) ? 'camera_moved'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(raw#>'{track,lost}', '[]'::jsonb)) g
                     WHERE (g->>'end') ~ num AND (g->>'start') ~ num
                       AND (g->>'end')::numeric - (g->>'start')::numeric > 1.5)
         OR (r.actual_reps IS NOT NULL AND abs(r.actual_reps - nr) > 1)
         OR NOT (v > 0 AND v <= 3.5)
         OR u / v > 0.35 THEN
        v := NULL;
      ELSE
        tier := CASE WHEN raw#>>'{velocity,tier}' = 'measured' AND nm = nr AND u / v <= 0.08
                          AND r.actual_reps IS NOT DISTINCT FROM nr
                     THEN 'measured' ELSE 'estimated' END;
      END IF;
    ELSE
      v := NULL;
    END IF;
  END IF;

  UPDATE public.pl_row_results
     SET mean_concentric_velocity_mps = round(v, 3),
         velocity_source = CASE WHEN v IS NOT NULL THEN 'video' END,
         velocity_set_video_id = CASE WHEN v IS NOT NULL THEN picked END,
         velocity_uncertainty = CASE WHEN v IS NOT NULL THEN round(u, 4) END,
         velocity_quality = CASE WHEN v IS NOT NULL THEN tier END
   WHERE id = r.id
     AND (mean_concentric_velocity_mps IS NULL OR velocity_source = 'video')
     AND (mean_concentric_velocity_mps IS DISTINCT FROM round(v, 3)
          OR velocity_set_video_id IS DISTINCT FROM (CASE WHEN v IS NOT NULL THEN picked END)
          OR velocity_quality IS DISTINCT FROM (CASE WHEN v IS NOT NULL THEN tier END));
  RETURN round(v, 3);
END
$$;
REVOKE ALL ON FUNCTION public._apply_video_velocity(uuid) FROM PUBLIC, anon, authenticated;

-- the logged reps changed: a video's speed stays while the video saw within one rep of them
-- (the AFTER trigger pl_row_results_recheck_video_velocity then re-applies the rule)
CREATE OR REPLACE FUNCTION public.tg_pl_row_results_velocity_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_reps int;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.velocity_source := CASE WHEN NEW.mean_concentric_velocity_mps IS NULL THEN NULL ELSE 'device' END;
      NEW.velocity_set_video_id := NULL;
      RETURN NEW;
    END IF;
    IF NEW.mean_concentric_velocity_mps IS DISTINCT FROM OLD.mean_concentric_velocity_mps THEN
      NEW.velocity_source := CASE WHEN NEW.mean_concentric_velocity_mps IS NULL THEN NULL ELSE 'device' END;
      NEW.velocity_set_video_id := NULL;
    ELSE
      NEW.velocity_source := OLD.velocity_source;
      NEW.velocity_set_video_id := OLD.velocity_set_video_id;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.velocity_source = 'video' AND NEW.velocity_set_video_id IS NOT NULL
     AND NEW.actual_reps IS DISTINCT FROM OLD.actual_reps THEN
    SELECT a.reps INTO v_reps FROM public.pl_set_video_analyses a WHERE a.set_video_id = NEW.velocity_set_video_id;
    IF v_reps IS NULL OR (NEW.actual_reps IS NOT NULL AND abs(v_reps - NEW.actual_reps) > 1) THEN
      NEW.mean_concentric_velocity_mps := NULL;
      NEW.velocity_source := NULL;
      NEW.velocity_set_video_id := NULL;
      NEW.velocity_quality := NULL;
      NEW.velocity_uncertainty := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ── a read from a standard plate is a finished read, not "needs calibration" ─
CREATE OR REPLACE FUNCTION public.velocity_analysis_commit(_video uuid, _result jsonb, _lease uuid DEFAULT NULL, _expected timestamptz DEFAULT NULL, _compute_ms integer DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE j public.set_velocity_jobs; a public.pl_set_video_analyses;
BEGIN
  PERFORM public._set_video_for_analysis(_video);
  PERFORM pg_advisory_xact_lock(hashtextextended(_video::text, 9));
  SELECT * INTO a FROM public.pl_set_video_analyses WHERE set_video_id = _video;
  IF _lease IS NOT NULL THEN
    SELECT * INTO j FROM public.set_velocity_jobs WHERE set_video_id = _video FOR UPDATE;
    IF j.lease_id IS DISTINCT FROM _lease OR j.claimed_by IS DISTINCT FROM (SELECT auth.uid()) OR j.status <> 'running' OR j.lease_until < now() THEN
      RETURN false;
    END IF;
    IF a.reviewed OR a.updated_at IS DISTINCT FROM j.analysis_base THEN
      UPDATE public.set_velocity_jobs SET status = 'needs_review', lease_id = NULL, lease_until = NULL, updated_at = now(),
             error = 'A newer reviewed read was kept'
       WHERE set_video_id = _video;
      RETURN false;
    END IF;
  ELSIF a.updated_at IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'This analysis changed. Open it again before saving.';
  END IF;
  PERFORM public._velocity_analysis_store(_video, _result);
  UPDATE public.pl_set_video_analyses SET reviewed = (_lease IS NULL), excluded = false WHERE set_video_id = _video;
  UPDATE public.set_velocity_jobs
     SET status = CASE WHEN coalesce(_result->>'status', 'done') <> 'done' THEN 'needs_review'
                       WHEN coalesce(_result->>'units', 'px') <> 'mm' THEN 'needs_calibration'
                       ELSE 'done' END,
         finished_at = now(), compute_ms = greatest(0, least(_compute_ms, 120000)),
         lease_id = NULL, lease_until = NULL, error = NULL, updated_at = now()
   WHERE set_video_id = _video;
  -- the read is no longer excluded: its speed goes on the set now, not at the next change
  PERFORM public._apply_video_velocity(_video);
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.velocity_analysis_commit(uuid, jsonb, uuid, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_analysis_commit(uuid, jsonb, uuid, timestamptz, integer) TO authenticated, service_role;

-- ── catch up recent clips ───────────────────────────────────────────────────
-- skipped only by the old name rule (never touched since it was enqueued; an athlete's own
-- "turn off auto read" goes through velocity_job_retry, which moves updated_at)
UPDATE public.set_velocity_jobs j
   SET enabled = true, status = 'queued', attempts = 0, available_at = now(), error = NULL, updated_at = now()
  FROM public.pl_set_videos s
 WHERE s.id = j.set_video_id AND s.deleted_at IS NULL AND s.set_index > 0
   AND s.created_at > now() - interval '14 days' AND coalesce(s.duration_s, 0) <= 120
   AND j.status = 'skipped' AND NOT j.enabled AND j.attempts = 0
   AND j.updated_at <= j.created_at + interval '2 seconds'
   AND public._velocity_analysable(j.exercise_name);

-- read in pixels while waiting for a diameter: read again (the phone now reads a standard plate)
UPDATE public.set_velocity_jobs j
   SET status = 'queued', attempts = 0, available_at = now(), error = NULL, updated_at = now()
  FROM public.pl_set_videos s, public.pl_set_video_analyses a
 WHERE s.id = j.set_video_id AND a.set_video_id = j.set_video_id
   AND s.deleted_at IS NULL AND s.created_at > now() - interval '14 days'
   AND j.enabled AND j.status IN ('needs_calibration', 'failed')
   AND NOT a.reviewed AND NOT a.velocity_accepted;

-- every stored accepted read checked against the new rule once (typed speeds untouched)
DO $$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT a.set_video_id FROM public.pl_set_video_analyses a
            WHERE a.velocity_accepted AND a.status = 'done' AND a.result_id IS NOT NULL
              AND a.created_at > now() - interval '60 days'
  LOOP
    PERFORM public._apply_video_velocity(v);
  END LOOP;
END $$;
