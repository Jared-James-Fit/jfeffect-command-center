-- Bar path and bar speed for a set video (lift analysis).
--
-- The analysis runs on the phone (or the coach's computer): the plate is
-- found and followed through every frame, scaled by its own 450 mm, and the
-- reps, velocities and bar path are read from it (src/lib/lift-analysis/).
-- Nothing is sent to a server or a model to do it. What it found is kept
-- here, one row per set video, so the athlete and the coach see the same
-- read and nobody's phone does it twice:
--   * read: exactly who can see the set video (the athlete, their coach,
--     admins), never anyone else;
--   * written only through set_video_analysis_save / _delete (the athlete,
--     their coach or an admin), which tie it to the set video's own client
--     and exercise (never taken from the caller) and check its size;
--   * removing the set video removes its analysis (ON DELETE CASCADE), and
--     a soft-removed one is never written to again.
-- Each number in `result` says how far it can be trusted (measured /
-- estimated / unavailable, with its 95 % margin); the columns beside it are
-- the few the app lists and compares across sessions (load–velocity).

CREATE TABLE IF NOT EXISTS public.pl_set_video_analyses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_video_id      uuid NOT NULL REFERENCES public.pl_set_videos(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  exercise_id       uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  result_id         uuid REFERENCES public.pl_row_results(id) ON DELETE SET NULL,
  engine            text NOT NULL,
  -- how the plate was found: on its own, or from a tap
  source            text NOT NULL CHECK (source IN ('auto', 'tap')),
  -- 'mm' once the plate gave a scale; 'px' when it didn't (no speeds then, only timing and velocity loss)
  units             text NOT NULL CHECK (units IN ('mm', 'px')),
  fps               numeric(6,2),
  reps              int NOT NULL DEFAULT 0 CHECK (reps BETWEEN 0 AND 60),
  first_mcv         numeric(5,3) CHECK (first_mcv IS NULL OR (first_mcv > 0 AND first_mcv <= 3.5)),
  best_mcv          numeric(5,3) CHECK (best_mcv IS NULL OR (best_mcv > 0 AND best_mcv <= 3.5)),
  last_mcv          numeric(5,3) CHECK (last_mcv IS NULL OR (last_mcv > 0 AND last_mcv <= 3.5)),
  best_mcv_tier     text CHECK (best_mcv_tier IS NULL OR best_mcv_tier IN ('measured', 'estimated')),
  velocity_loss_pct numeric(5,1) CHECK (velocity_loss_pct IS NULL OR velocity_loss_pct BETWEEN -100 AND 100),
  plate_mm          numeric(5,1) CHECK (plate_mm IS NULL OR plate_mm BETWEEN 100 AND 600),
  result            jsonb NOT NULL,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pl_set_video_analyses_video ON public.pl_set_video_analyses (set_video_id);
CREATE INDEX IF NOT EXISTS pl_set_video_analyses_client_exercise ON public.pl_set_video_analyses (client_id, exercise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pl_set_video_analyses_result ON public.pl_set_video_analyses (result_id);

ALTER TABLE public.pl_set_video_analyses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pl_set_video_analyses FROM anon, authenticated;
GRANT SELECT ON public.pl_set_video_analyses TO authenticated;
GRANT ALL ON public.pl_set_video_analyses TO service_role;

DROP POLICY IF EXISTS "Set video analyses: own" ON public.pl_set_video_analyses;
CREATE POLICY "Set video analyses: own" ON public.pl_set_video_analyses
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Set video analyses: coach" ON public.pl_set_video_analyses;
CREATE POLICY "Set video analyses: coach" ON public.pl_set_video_analyses
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Set video analyses: admin" ON public.pl_set_video_analyses;
CREATE POLICY "Set video analyses: admin" ON public.pl_set_video_analyses
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

/** Who may write a set video's analysis: the athlete, their coach, an admin. Returns the set video, or raises. */
CREATE OR REPLACE FUNCTION public._set_video_for_analysis(_set_video_id uuid)
RETURNS public.pl_set_videos
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sv  public.pl_set_videos;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sv FROM public.pl_set_videos WHERE id = _set_video_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That video isn''t on a set any more.' USING ERRCODE = '22023'; END IF;
  IF NOT (
       EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_sv.client_id AND c.user_id = v_uid)
       OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))
       OR v_sv.client_id IN (SELECT public.coached_client_ids())
     ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN v_sv;
END
$$;
REVOKE ALL ON FUNCTION public._set_video_for_analysis(uuid) FROM PUBLIC, anon, authenticated;

/**
 * Save (or replace) a set video's analysis. `_result` is the engine's whole
 * read (≤ 600 KB); the listed numbers are read from its "set" part here, so
 * the columns can never disagree with it.
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
  -- a number only when the engine gave one it stands behind (measured or estimated)
  num CONSTANT text := '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$';
BEGIN
  v_sv := public._set_video_for_analysis(_set_video_id);
  IF _result IS NULL OR jsonb_typeof(_result) <> 'object' OR octet_length(_result::text) > 600000 THEN
    RAISE EXCEPTION 'That analysis couldn''t be saved.' USING ERRCODE = '22023';
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
  -- speeds only when calibrated and the engine called them measured or estimated
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

  SELECT r.exercise_id INTO v_ex FROM public.pl_exercise_rows r WHERE r.id = v_sv.row_id;

  INSERT INTO public.pl_set_video_analyses
    (set_video_id, client_id, exercise_id, result_id, engine, source, units, fps, reps,
     first_mcv, best_mcv, last_mcv, best_mcv_tier, velocity_loss_pct, plate_mm, result, created_by)
  VALUES
    (v_sv.id, v_sv.client_id, v_ex, v_sv.result_id, v_engine, v_source, v_units, v_fps, v_reps,
     v_first, v_best, v_last, v_tier, v_vl, v_plate, _result, (SELECT auth.uid()))
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
    result = EXCLUDED.result,
    created_by = EXCLUDED.created_by,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION public.set_video_analysis_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_analysis_save(uuid, jsonb) TO authenticated, service_role;

/** Take a set video's analysis off (to read it again from scratch, or because it read the wrong thing). */
CREATE OR REPLACE FUNCTION public.set_video_analysis_delete(_set_video_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._set_video_for_analysis(_set_video_id);
  DELETE FROM public.pl_set_video_analyses WHERE set_video_id = _set_video_id;
END
$$;
REVOKE ALL ON FUNCTION public.set_video_analysis_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_analysis_delete(uuid) TO authenticated, service_role;

-- a set video moved to another set: its analysis follows (same video, the set it really is)
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
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS set_video_analysis_follows_move ON public.pl_set_videos;
CREATE TRIGGER set_video_analysis_follows_move
  AFTER UPDATE OF result_id, row_id, deleted_at ON public.pl_set_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_video_analysis_follows_move();

SELECT public.rls_evaluate_once('pl_set_video_analyses');
