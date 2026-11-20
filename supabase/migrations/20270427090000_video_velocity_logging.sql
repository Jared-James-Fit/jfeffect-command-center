-- A set video's bar speed, logged on its set.
--
-- The phone reads a barbell set video (src/lib/lift-analysis/) and, when the
-- read passes the acceptance rules (verdict.ts: every rep found and measured,
-- the plate seen through each press, a steady camera within ~25° of
-- side-on), saves `velocity.accepted` with the set-average mean concentric
-- velocity. This migration puts that number on the set's own velocity
-- (pl_row_results.mean_concentric_velocity_mps), the field the logger, the
-- History sheet, analytics and Program Intelligence already read, and keeps
-- it honest:
--   * velocity_source says where a set's velocity came from: 'device' (typed
--     in, from a VBT device) or 'video' (this read), with the set video it
--     came from in velocity_set_video_id;
--   * a typed velocity is never overwritten: the video only fills an empty
--     velocity or replaces its own;
--   * the server re-checks the read before writing it: every rep complete and
--     measured, as many reps as are logged on the set (when reps are logged),
--     and either a confirmed plate size or a load heavy enough to mean
--     full-size 450 mm plates (60 kg / 135 lb or more);
--   * it follows the video: moved to another set, it leaves the old one and is
--     checked again on the new one; removed, its number goes; the set's reps
--     changed so they no longer match, its number goes;
--   * a client can't mark a typed number as the video's (the trigger stamps
--     every client write as 'device'); only the server functions here write
--     'video'.

ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS velocity_source text
    CHECK (velocity_source IS NULL OR velocity_source IN ('device', 'video')),
  ADD COLUMN IF NOT EXISTS velocity_set_video_id uuid
    REFERENCES public.pl_set_videos(id) ON DELETE SET NULL;

-- every velocity typed in before this is a device's (or the athlete's own) number
UPDATE public.pl_row_results
   SET velocity_source = 'device'
 WHERE mean_concentric_velocity_mps IS NOT NULL AND velocity_source IS NULL;

CREATE INDEX IF NOT EXISTS pl_row_results_velocity_video
  ON public.pl_row_results (velocity_set_video_id) WHERE velocity_set_video_id IS NOT NULL;

-- a read that couldn't find the plate on its own is kept too ('needs_tap': the app asks for a tap;
-- 'failed': the video couldn't be read), so no phone tries the same video again and again
ALTER TABLE public.pl_set_video_analyses
  ADD COLUMN IF NOT EXISTS set_mcv numeric(5,3) CHECK (set_mcv IS NULL OR (set_mcv > 0 AND set_mcv <= 3.5)),
  ADD COLUMN IF NOT EXISTS velocity_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'needs_tap', 'failed'));

-- A client's own write: velocity changed by hand is the device's (or theirs), never the video's;
-- server functions (SECURITY DEFINER, the service role) set the source themselves.
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
  -- the video's number belongs to a set with as many reps as the video showed
  IF TG_OP = 'UPDATE' AND NEW.velocity_source = 'video' AND NEW.velocity_set_video_id IS NOT NULL
     AND NEW.actual_reps IS DISTINCT FROM OLD.actual_reps THEN
    SELECT a.reps INTO v_reps FROM public.pl_set_video_analyses a WHERE a.set_video_id = NEW.velocity_set_video_id;
    IF v_reps IS DISTINCT FROM NEW.actual_reps THEN
      NEW.mean_concentric_velocity_mps := NULL;
      NEW.velocity_source := NULL;
      NEW.velocity_set_video_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS pl_row_results_velocity_source ON public.pl_row_results;
CREATE TRIGGER pl_row_results_velocity_source
  BEFORE INSERT OR UPDATE ON public.pl_row_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_pl_row_results_velocity_source();

/**
 * Put a set video's accepted bar speed on its set, or take it off. Called
 * after every save, move or removal; safe to call any number of times.
 */
CREATE OR REPLACE FUNCTION public._apply_video_velocity(_set_video_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sv      public.pl_set_videos;
  v_a       public.pl_set_video_analyses;
  v_res     public.pl_row_results;
  v_value   numeric;
  v_n       int;
  v_good    int;
  v_ok      boolean := false;
  num CONSTANT text := '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$';
BEGIN
  SELECT * INTO v_sv FROM public.pl_set_videos WHERE id = _set_video_id;
  SELECT * INTO v_a FROM public.pl_set_video_analyses WHERE set_video_id = _set_video_id;
  IF FOUND AND v_sv.id IS NOT NULL AND v_sv.deleted_at IS NULL AND v_sv.result_id IS NOT NULL
     AND v_a.velocity_accepted AND v_a.units = 'mm' THEN
    SELECT * INTO v_res FROM public.pl_row_results WHERE id = v_sv.result_id;
    IF FOUND THEN
      -- every rep complete and measured, re-read from the saved read itself
      SELECT count(*),
             count(*) FILTER (
               WHERE (r->>'complete')::boolean IS TRUE
                 AND r#>>'{mcv,tier}' = 'measured'
                 AND (r#>>'{mcv,v}') ~ num
                 AND (r#>>'{mcv,v}')::numeric > 0 AND (r#>>'{mcv,v}')::numeric <= 3.5),
             avg((r#>>'{mcv,v}')::numeric) FILTER (WHERE (r#>>'{mcv,v}') ~ num)
        INTO v_n, v_good, v_value
        FROM jsonb_array_elements(coalesce(v_a.result->'reps', '[]'::jsonb)) r;
      v_ok := v_n > 0 AND v_good = v_n
        -- the athlete's own count is the independent check that the video saw the whole set
        AND v_res.actual_reps IS NOT NULL AND v_res.actual_reps = v_n
        AND (coalesce((v_a.result#>>'{plate,confirmed}')::boolean, false)
             OR (coalesce(v_res.is_bodyweight, false) = false AND coalesce(v_res.actual_load_kg, 0) >= 59.5));
      IF v_ok THEN
        v_value := round(v_value, 3);
        IF NOT (v_value > 0 AND v_value <= 3.5) THEN v_ok := false; END IF;
      END IF;
    END IF;
  END IF;

  -- off anything this video filled that it shouldn't fill now (moved, removed, no longer accepted)
  UPDATE public.pl_row_results
     SET mean_concentric_velocity_mps = NULL, velocity_source = NULL, velocity_set_video_id = NULL
   WHERE velocity_set_video_id = _set_video_id AND velocity_source = 'video'
     AND (NOT v_ok OR id IS DISTINCT FROM v_sv.result_id);

  IF v_ok THEN
    -- an empty velocity, or one a video filled (the newest read wins); never a typed one
    UPDATE public.pl_row_results
       SET mean_concentric_velocity_mps = v_value, velocity_source = 'video', velocity_set_video_id = _set_video_id
     WHERE id = v_sv.result_id
       AND (mean_concentric_velocity_mps IS NULL OR velocity_source = 'video')
       AND (mean_concentric_velocity_mps IS DISTINCT FROM v_value OR velocity_set_video_id IS DISTINCT FROM _set_video_id);
    RETURN v_value;
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public._apply_video_velocity(uuid) FROM PUBLIC, anon, authenticated;

/**
 * Save (or replace) a set video's analysis, then log its bar speed on the set
 * when it's accepted (see the header). `_result` is the engine's whole read
 * (≤ 600 KB); the listed numbers are read from it here, so the columns can
 * never disagree with it.
 */
CREATE OR REPLACE FUNCTION public.set_video_analysis_save(_set_video_id uuid, _result jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sv     public.pl_set_videos;
  v_ex     uuid;
  v_id     uuid;
  v_set    jsonb;
  v_units  text;
  v_source text;
  v_engine text;
  v_reps   int;
  v_fps    numeric;
  v_plate  numeric;
  v_first  numeric;
  v_best   numeric;
  v_last   numeric;
  v_tier   text;
  v_vl     numeric;
  v_mcv    numeric;
  v_acc    boolean;
  v_status text;
  num CONSTANT text := '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$';
BEGIN
  v_sv := public._set_video_for_analysis(_set_video_id);
  IF _result IS NULL OR jsonb_typeof(_result) <> 'object' OR octet_length(_result::text) > 600000 THEN
    RAISE EXCEPTION 'That analysis couldn''t be saved.' USING ERRCODE = '22023';
  END IF;
  v_status := coalesce(_result->>'status', 'done');
  IF v_status NOT IN ('done', 'needs_tap', 'failed') THEN
    RAISE EXCEPTION 'That analysis couldn''t be saved.' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'done' THEN
    -- nothing read: no numbers, no velocity; never replaces a read that worked
    INSERT INTO public.pl_set_video_analyses
      (set_video_id, client_id, exercise_id, result_id, engine, source, units, reps, status, result, created_by)
    VALUES
      (v_sv.id, v_sv.client_id, (SELECT r.exercise_id FROM public.pl_exercise_rows r WHERE r.id = v_sv.row_id),
       v_sv.result_id, left(coalesce(_result->>'engine', 'bar-path'), 40), 'auto', 'px', 0, v_status,
       jsonb_build_object('engine', left(coalesce(_result->>'engine', 'bar-path'), 40), 'status', v_status,
                          'why', left(coalesce(_result->>'why', ''), 40), 'suggestions', coalesce(_result->'suggestions', '[]'::jsonb)),
       (SELECT auth.uid()))
    ON CONFLICT (set_video_id) DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result, updated_at = now()
      WHERE public.pl_set_video_analyses.status <> 'done'
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  v_engine := left(coalesce(_result->>'engine', ''), 40);
  v_units  := _result->>'units';
  v_source := _result#>>'{plate,source}';
  v_set    := _result->'set';
  IF v_engine = '' OR v_units NOT IN ('mm', 'px') OR v_source NOT IN ('auto', 'tap') OR jsonb_typeof(v_set) <> 'object' THEN
    RAISE EXCEPTION 'That analysis couldn''t be saved.' USING ERRCODE = '22023';
  END IF;
  v_reps  := CASE WHEN (v_set->>'reps') ~ '^[0-9]+$' THEN least((v_set->>'reps')::int, 60) ELSE 0 END;
  v_fps   := CASE WHEN (_result->>'fps') ~ num THEN least(greatest((_result->>'fps')::numeric, 0), 1000) END;
  v_plate := CASE WHEN (_result#>>'{plate,mm}') ~ num AND (_result#>>'{plate,mm}')::numeric BETWEEN 100 AND 600 THEN (_result#>>'{plate,mm}')::numeric END;
  IF v_units = 'mm' THEN
    v_first := CASE WHEN v_set#>>'{firstMcv,tier}' IN ('measured', 'estimated') AND (v_set#>>'{firstMcv,v}') ~ num THEN (v_set#>>'{firstMcv,v}')::numeric END;
    v_best  := CASE WHEN v_set#>>'{bestMcv,tier}' IN ('measured', 'estimated') AND (v_set#>>'{bestMcv,v}') ~ num THEN (v_set#>>'{bestMcv,v}')::numeric END;
    v_last  := CASE WHEN v_set#>>'{lastMcv,tier}' IN ('measured', 'estimated') AND (v_set#>>'{lastMcv,v}') ~ num THEN (v_set#>>'{lastMcv,v}')::numeric END;
    v_tier  := CASE WHEN v_best IS NOT NULL THEN v_set#>>'{bestMcv,tier}' END;
  END IF;
  v_first := CASE WHEN v_first > 0 AND v_first <= 3.5 THEN round(v_first, 3) END;
  v_best  := CASE WHEN v_best > 0 AND v_best <= 3.5 THEN round(v_best, 3) END;
  v_last  := CASE WHEN v_last > 0 AND v_last <= 3.5 THEN round(v_last, 3) END;
  IF v_best IS NULL THEN v_tier := NULL; END IF;
  v_vl := CASE WHEN v_set#>>'{velocityLoss,tier}' IN ('measured', 'estimated') AND (v_set#>>'{velocityLoss,v}') ~ num
               AND (v_set#>>'{velocityLoss,v}')::numeric BETWEEN -100 AND 100
          THEN round((v_set#>>'{velocityLoss,v}')::numeric, 1) END;
  -- the phone's verdict: the set-average MCV, when it passed the acceptance rules
  v_acc := v_units = 'mm' AND coalesce((_result#>>'{velocity,accepted}')::boolean, false);
  v_mcv := CASE WHEN v_acc AND (_result#>>'{velocity,value}') ~ num
                 AND (_result#>>'{velocity,value}')::numeric > 0 AND (_result#>>'{velocity,value}')::numeric <= 3.5
            THEN round((_result#>>'{velocity,value}')::numeric, 3) END;
  IF v_mcv IS NULL THEN v_acc := false; END IF;

  SELECT r.exercise_id INTO v_ex FROM public.pl_exercise_rows r WHERE r.id = v_sv.row_id;

  INSERT INTO public.pl_set_video_analyses
    (set_video_id, client_id, exercise_id, result_id, engine, source, units, fps, reps,
     first_mcv, best_mcv, last_mcv, best_mcv_tier, velocity_loss_pct, plate_mm, set_mcv, velocity_accepted,
     status, result, created_by)
  VALUES
    (v_sv.id, v_sv.client_id, v_ex, v_sv.result_id, v_engine, v_source, v_units, v_fps, v_reps,
     v_first, v_best, v_last, v_tier, v_vl, v_plate, v_mcv, v_acc, 'done', _result, (SELECT auth.uid()))
  ON CONFLICT (set_video_id) DO UPDATE SET
    exercise_id = EXCLUDED.exercise_id,
    result_id = EXCLUDED.result_id,
    engine = EXCLUDED.engine,
    source = EXCLUDED.source,
    units = EXCLUDED.units,
    fps = EXCLUDED.fps,
    reps = EXCLUDED.reps,
    first_mcv = EXCLUDED.first_mcv,
    best_mcv = EXCLUDED.best_mcv,
    last_mcv = EXCLUDED.last_mcv,
    best_mcv_tier = EXCLUDED.best_mcv_tier,
    velocity_loss_pct = EXCLUDED.velocity_loss_pct,
    plate_mm = EXCLUDED.plate_mm,
    set_mcv = EXCLUDED.set_mcv,
    velocity_accepted = EXCLUDED.velocity_accepted,
    status = 'done',
    result = EXCLUDED.result,
    created_by = EXCLUDED.created_by,
    updated_at = now()
  RETURNING id INTO v_id;
  PERFORM public._apply_video_velocity(v_sv.id);
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION public.set_video_analysis_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_analysis_save(uuid, jsonb) TO authenticated, service_role;

/** Take a set video's analysis off (and the bar speed it put on the set). */
CREATE OR REPLACE FUNCTION public.set_video_analysis_delete(_set_video_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._set_video_for_analysis(_set_video_id);
  DELETE FROM public.pl_set_video_analyses WHERE set_video_id = _set_video_id;
  PERFORM public._apply_video_velocity(_set_video_id);
END
$$;
REVOKE ALL ON FUNCTION public.set_video_analysis_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_analysis_delete(uuid) TO authenticated, service_role;

-- a set video moved to another set: its analysis follows, and so does its bar speed (checked again there)
CREATE OR REPLACE FUNCTION public.tg_set_video_analysis_follows_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.result_id IS DISTINCT FROM OLD.result_id OR NEW.row_id IS DISTINCT FROM OLD.row_id THEN
    UPDATE public.pl_set_video_analyses a
       SET result_id = NEW.result_id,
           exercise_id = (SELECT r.exercise_id FROM public.pl_exercise_rows r WHERE r.id = NEW.row_id)
     WHERE a.set_video_id = NEW.id;
  END IF;
  -- removed from the set: its analysis goes with it
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    DELETE FROM public.pl_set_video_analyses WHERE set_video_id = NEW.id;
  END IF;
  IF NEW.result_id IS DISTINCT FROM OLD.result_id OR NEW.row_id IS DISTINCT FROM OLD.row_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM public._apply_video_velocity(NEW.id);
  END IF;
  RETURN NEW;
END
$$;

-- the set's reps or load corrected after the read: check the video's speed against it again
-- (a set logged with 4 reps then fixed to the 5 the video showed gets its speed)
CREATE OR REPLACE FUNCTION public.tg_pl_row_results_recheck_video_velocity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT a.set_video_id FROM public.pl_set_video_analyses a
     WHERE a.result_id = NEW.id AND a.velocity_accepted
  LOOP
    PERFORM public._apply_video_velocity(v_id);
  END LOOP;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS pl_row_results_recheck_video_velocity ON public.pl_row_results;
CREATE TRIGGER pl_row_results_recheck_video_velocity
  -- no column list: the kg mirror is set by a trigger, never named in the client's UPDATE
  AFTER UPDATE ON public.pl_row_results
  FOR EACH ROW
  WHEN (NEW.actual_reps IS DISTINCT FROM OLD.actual_reps
        OR NEW.actual_load_kg IS DISTINCT FROM OLD.actual_load_kg
        OR NEW.is_bodyweight IS DISTINCT FROM OLD.is_bodyweight)
  EXECUTE FUNCTION public.tg_pl_row_results_recheck_video_velocity();
REVOKE ALL ON FUNCTION public.tg_pl_row_results_recheck_video_velocity() FROM PUBLIC, anon, authenticated;

SELECT public.rls_evaluate_once('pl_set_video_analyses');
