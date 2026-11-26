-- Bar speed read on the server, whatever the athlete does next (Nov 26 2026).
--
-- Why: Dwayne Gordon's set videos never got a speed. The read ran only on a
-- phone with the app open: his Nov 25 squat set 1 was cut off three times as
-- he left the app ("Paused; resume when the app is open") and, with its three
-- attempts spent, sat `failed` for good; set 2 and his benches were read but
-- the phone wasn't sure of the plate (he films squats front-on: the plates are
-- edge-on stacks, never circles) and stopped at "needs a look". Across
-- production 25 of the 35 barbell set videos had no speed, five of them jobs
-- frozen at `running` / `failed` with their attempts spent and nothing to ever
-- pick them up again.
--
-- Now a server worker (scripts/velocity-worker, GitHub Actions, authenticated
-- to /api/public/hooks/velocity-worker by GitHub's OIDC token) reads every
-- eligible set video: the phone's own pipeline in headless Chromium, then the
-- any-angle estimate (src/lib/lift-analysis/estimate.ts). A phone can still read
-- a fresh upload first, but leaving the app no longer spends an attempt, and a
-- read the phone isn't sure of is handed to the server instead of stopping.
--
-- Rules kept: a speed typed in (velocity_source 'device') is never overwritten;
-- an athlete's or coach's own read (source 'tap'), an excluded read, and a read
-- already on the set are never replaced; every change is in set_velocity_history.

-- ── what the server keeps on a job ───────────────────────────────────────────
ALTER TABLE public.set_velocity_jobs
  ADD COLUMN IF NOT EXISTS server_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worker text,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome text;

-- a read the server made has no signed-in author
ALTER TABLE public.pl_set_video_analyses ALTER COLUMN created_by DROP NOT NULL;

-- ── the server may read and store any set video (service role only) ─────────
CREATE OR REPLACE FUNCTION public._set_video_for_analysis(_set_video_id uuid)
RETURNS pl_set_videos
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sv  public.pl_set_videos;
BEGIN
  IF v_uid IS NULL AND coalesce((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sv FROM public.pl_set_videos WHERE id = _set_video_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That video isn''t on a set any more.' USING ERRCODE = '22023'; END IF;
  IF v_uid IS NOT NULL AND NOT (
       EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_sv.client_id AND c.user_id = v_uid)
       OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))
       OR v_sv.client_id IN (SELECT public.coached_client_ids())
     ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN v_sv;
END
$function$;

-- ── which reads the server may replace (pure) ────────────────────────────────
-- Nothing, an unsure read, a read that wasn't logged: yes. A person's own read
-- (a ring they confirmed: source 'tap'), an excluded read, or a read whose speed
-- is on the set: never.
CREATE OR REPLACE FUNCTION public._velocity_server_may_read(_video uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.pl_set_video_analyses a
     WHERE a.set_video_id = _video
       AND (a.source = 'tap' OR a.excluded OR (a.status = 'done' AND a.velocity_accepted
            AND EXISTS (SELECT 1 FROM public.pl_row_results r WHERE r.velocity_set_video_id = _video)))
  )
$$;
REVOKE ALL ON FUNCTION public._velocity_server_may_read(uuid) FROM PUBLIC, anon, authenticated;

-- ── a phone: only fresh uploads, and leaving the app never spends an attempt ─
CREATE OR REPLACE FUNCTION public.velocity_job_claim(_video uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s public.pl_set_videos; j public.set_velocity_jobs;
BEGIN
  s := public._set_video_for_analysis(_video);
  PERFORM public._velocity_enqueue(_video);
  UPDATE public.set_velocity_jobs
     SET status = 'running', attempts = attempts + 1, worker = 'device', stage = NULL,
         lease_id = gen_random_uuid(), lease_until = now() + interval '2 minutes',
         claimed_by = (SELECT auth.uid()), started_at = now(), updated_at = now(),
         analysis_base = (SELECT updated_at FROM public.pl_set_video_analyses WHERE set_video_id = _video)
   WHERE set_video_id = _video AND enabled AND attempts < 3 AND server_attempts = 0
     AND coalesce(outcome, '') <> 'device_unsure'
     AND created_at > now() - interval '6 hours'
     AND available_at <= now()
     AND (status = 'queued' OR (status = 'running' AND lease_until < now()))
  RETURNING * INTO j;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(j) || jsonb_build_object('storage_path', s.storage_path);
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_job_claim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_job_claim(uuid) TO authenticated;

-- the app went to the background: the job goes back for the server, the try not counted
CREATE OR REPLACE FUNCTION public.velocity_job_release(_video uuid, _lease uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._set_video_for_analysis(_video);
  UPDATE public.set_velocity_jobs
     SET status = 'queued', attempts = greatest(attempts - 1, 0), lease_id = NULL, lease_until = NULL,
         available_at = now(), stage = NULL, updated_at = now(), error = NULL
   WHERE set_video_id = _video AND lease_id = _lease AND claimed_by = (SELECT auth.uid()) AND status = 'running';
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_job_release(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_job_release(uuid, uuid) TO authenticated;

-- a phone's failure is the server's to try, not the end
CREATE OR REPLACE FUNCTION public.velocity_job_fail(_video uuid, _lease uuid, _reason text, _retry boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._set_video_for_analysis(_video);
  UPDATE public.set_velocity_jobs
     SET status = 'queued', available_at = now(), error = left(_reason, 160),
         lease_id = NULL, lease_until = NULL, stage = NULL, updated_at = now()
   WHERE set_video_id = _video AND lease_id = _lease AND claimed_by = (SELECT auth.uid()) AND status = 'running';
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_job_fail(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_job_fail(uuid, uuid, text, boolean) TO authenticated, service_role;

-- a phone's automatic read that didn't put a speed on the set goes to the server
CREATE OR REPLACE FUNCTION public.velocity_analysis_commit(_video uuid, _result jsonb, _lease uuid DEFAULT NULL, _expected timestamptz DEFAULT NULL, _compute_ms integer DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE j public.set_velocity_jobs; a public.pl_set_video_analyses; logged boolean;
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
             error = 'A newer reviewed read was kept', outcome = 'kept_existing'
       WHERE set_video_id = _video;
      RETURN false;
    END IF;
  ELSIF a.updated_at IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'This analysis changed. Open it again before saving.';
  END IF;
  PERFORM public._velocity_analysis_store(_video, _result);
  UPDATE public.pl_set_video_analyses SET reviewed = (_lease IS NULL), excluded = false WHERE set_video_id = _video;
  PERFORM public._apply_video_velocity(_video);
  logged := EXISTS (SELECT 1 FROM public.pl_row_results r WHERE r.velocity_set_video_id = _video);
  UPDATE public.set_velocity_jobs
     SET status = CASE
                    WHEN logged THEN 'done'
                    -- an automatic read the phone wasn't sure of: the server reads it (any angle, no app open)
                    WHEN _lease IS NOT NULL AND server_attempts < 4 THEN 'queued'
                    WHEN coalesce(_result->>'status', 'done') <> 'done' THEN 'needs_review'
                    WHEN coalesce(_result->>'units', 'px') <> 'mm' THEN 'needs_calibration'
                    ELSE 'done' END,
         outcome = CASE WHEN logged THEN 'logged' WHEN _lease IS NOT NULL THEN 'device_unsure' ELSE 'saved' END,
         available_at = now(),
         finished_at = now(), compute_ms = greatest(0, least(_compute_ms, 120000)),
         lease_id = NULL, lease_until = NULL, error = NULL, stage = NULL, updated_at = now()
   WHERE set_video_id = _video;
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_analysis_commit(uuid, jsonb, uuid, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_analysis_commit(uuid, jsonb, uuid, timestamptz, integer) TO authenticated, service_role;

-- Retry (the analysis screen): the server tries again from scratch too
CREATE OR REPLACE FUNCTION public.velocity_job_retry(_video uuid, _enabled boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._set_video_for_analysis(_video);
  PERFORM public._velocity_enqueue(_video);
  UPDATE public.set_velocity_jobs
     SET enabled = _enabled, status = CASE WHEN _enabled THEN 'queued' ELSE 'skipped' END,
         attempts = 0, server_attempts = 0, available_at = now(), lease_id = NULL, lease_until = NULL,
         error = NULL, stage = NULL, outcome = CASE WHEN _enabled THEN 'requeued' ELSE 'turned_off' END, updated_at = now()
   WHERE set_video_id = _video;
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_job_retry(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_job_retry(uuid, boolean) TO authenticated, service_role;

-- ── the server worker (service role only) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._velocity_server_only()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' AND (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public._velocity_server_only() FROM PUBLIC, anon, authenticated;

/** Up to _limit due jobs, leased to the server for 20 minutes, with what reading them needs. */
CREATE OR REPLACE FUNCTION public.velocity_worker_claim(_limit integer DEFAULT 1, _worker text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE out jsonb;
BEGIN
  PERFORM public._velocity_server_only();
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('velocity_worker', jsonb_build_object('last_seen', now(), 'worker', left(coalesce(_worker, ''), 80))::text, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  WITH due AS (
    SELECT j.set_video_id
      FROM public.set_velocity_jobs j
      JOIN public.pl_set_videos s ON s.id = j.set_video_id
     WHERE j.enabled AND s.deleted_at IS NULL AND s.set_index > 0
       AND j.server_attempts < 4 AND j.available_at <= now()
       AND (j.status = 'queued' OR (j.status = 'running' AND j.lease_until < now()))
       AND public._velocity_server_may_read(j.set_video_id)
     ORDER BY j.available_at, j.created_at
     LIMIT greatest(1, least(coalesce(_limit, 1), 5))
     FOR UPDATE OF j SKIP LOCKED
  ), claimed AS (
    UPDATE public.set_velocity_jobs j
       SET status = 'running', server_attempts = j.server_attempts + 1, worker = 'server', stage = 'claimed',
           lease_id = gen_random_uuid(), lease_until = now() + interval '20 minutes', claimed_by = NULL,
           started_at = now(), heartbeat_at = now(), updated_at = now(), error = NULL,
           analysis_base = (SELECT updated_at FROM public.pl_set_video_analyses a WHERE a.set_video_id = j.set_video_id)
      FROM due WHERE j.set_video_id = due.set_video_id
    RETURNING j.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'set_video_id', c.set_video_id,
           'lease_id', c.lease_id,
           'attempt', c.server_attempts,
           'exercise_name', c.exercise_name,
           'storage_path', s.storage_path,
           'duration_s', s.duration_s,
           'set_index', s.set_index,
           'has_set', s.result_id IS NOT NULL,
           'reps', r.actual_reps,
           'load_kg', r.actual_load_kg,
           'bodyweight', coalesce(r.is_bodyweight, false))), '[]'::jsonb)
    INTO out
    FROM claimed c
    JOIN public.pl_set_videos s ON s.id = c.set_video_id
    LEFT JOIN public.pl_row_results r ON r.id = s.result_id;
  RETURN out;
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_worker_claim(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.velocity_worker_claim(integer, text) TO service_role;

/** Still reading: the lease kept, the stage shown to admins. */
CREATE OR REPLACE FUNCTION public.velocity_worker_heartbeat(_video uuid, _lease uuid, _stage text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._velocity_server_only();
  UPDATE public.set_velocity_jobs
     SET stage = left(_stage, 40), heartbeat_at = now(), lease_until = greatest(lease_until, now() + interval '20 minutes'), updated_at = now()
   WHERE set_video_id = _video AND lease_id = _lease AND status = 'running' AND worker = 'server';
  RETURN FOUND;
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_worker_heartbeat(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.velocity_worker_heartbeat(uuid, uuid, text) TO service_role;

/**
 * The server's read stored, its speed put on the set by the usual rule, the job
 * closed with what happened. A person's own read that appeared meanwhile is kept.
 */
CREATE OR REPLACE FUNCTION public.velocity_worker_commit(_video uuid, _lease uuid, _result jsonb, _compute_ms integer DEFAULT NULL, _outcome text DEFAULT NULL, _message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE j public.set_velocity_jobs; a public.pl_set_video_analyses; s public.pl_set_videos; r public.pl_row_results; logged boolean;
BEGIN
  PERFORM public._velocity_server_only();
  PERFORM pg_advisory_xact_lock(hashtextextended(_video::text, 9));
  SELECT * INTO j FROM public.set_velocity_jobs WHERE set_video_id = _video FOR UPDATE;
  IF NOT FOUND OR j.lease_id IS DISTINCT FROM _lease OR j.status <> 'running' OR j.worker IS DISTINCT FROM 'server' THEN
    RETURN jsonb_build_object('ok', false, 'why', 'lease');
  END IF;
  SELECT * INTO s FROM public.pl_set_videos WHERE id = _video;
  IF s.id IS NULL OR s.deleted_at IS NOT NULL THEN
    UPDATE public.set_velocity_jobs SET status = 'cancelled', lease_id = NULL, lease_until = NULL, stage = NULL, updated_at = now(), outcome = 'removed'
     WHERE set_video_id = _video;
    RETURN jsonb_build_object('ok', false, 'why', 'removed');
  END IF;
  SELECT * INTO a FROM public.pl_set_video_analyses WHERE set_video_id = _video;
  IF a.id IS NOT NULL AND (a.updated_at IS DISTINCT FROM j.analysis_base OR NOT public._velocity_server_may_read(_video)) THEN
    UPDATE public.set_velocity_jobs SET status = 'done', lease_id = NULL, lease_until = NULL, stage = NULL, finished_at = now(),
           updated_at = now(), outcome = 'kept_existing', error = 'A newer read was kept'
     WHERE set_video_id = _video;
    RETURN jsonb_build_object('ok', true, 'logged', false, 'kept', true);
  END IF;
  PERFORM public._velocity_analysis_store(_video, _result);
  UPDATE public.pl_set_video_analyses SET reviewed = false WHERE set_video_id = _video;
  PERFORM public._apply_video_velocity(_video);
  SELECT * INTO r FROM public.pl_row_results WHERE id = s.result_id;
  logged := r.id IS NOT NULL AND r.velocity_set_video_id = _video;
  UPDATE public.set_velocity_jobs
     SET status = CASE WHEN logged OR (r.id IS NOT NULL AND r.velocity_source = 'device') THEN 'done' ELSE 'needs_review' END,
         outcome = left(coalesce(CASE WHEN logged THEN coalesce(r.velocity_quality, 'logged')
                                      WHEN r.velocity_source = 'device' THEN 'typed_speed_kept' END,
                                 _outcome, 'no_reading'), 60),
         error = CASE WHEN logged THEN NULL ELSE left(_message, 240) END,
         finished_at = now(), compute_ms = greatest(0, least(coalesce(_compute_ms, 0), 3600000)),
         lease_id = NULL, lease_until = NULL, stage = NULL, updated_at = now()
   WHERE set_video_id = _video;
  RETURN jsonb_build_object('ok', true, 'logged', logged, 'value', CASE WHEN logged THEN r.mean_concentric_velocity_mps END,
                            'quality', CASE WHEN logged THEN r.velocity_quality END);
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_worker_commit(uuid, uuid, jsonb, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.velocity_worker_commit(uuid, uuid, jsonb, integer, text, text) TO service_role;

/** The read couldn't finish: tried again later (backing off), four times at most, then failed with why. */
CREATE OR REPLACE FUNCTION public.velocity_worker_fail(_video uuid, _lease uuid, _reason text, _retry boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._velocity_server_only();
  UPDATE public.set_velocity_jobs
     SET status = CASE WHEN _retry AND server_attempts < 4 THEN 'queued' ELSE 'failed' END,
         available_at = now() + make_interval(mins => (5 * power(3, greatest(server_attempts - 1, 0)))::integer),
         error = left(_reason, 240), outcome = CASE WHEN _retry AND server_attempts < 4 THEN 'retrying' ELSE 'failed' END,
         lease_id = NULL, lease_until = NULL, stage = NULL, finished_at = now(), updated_at = now()
   WHERE set_video_id = _video AND lease_id = _lease AND status = 'running' AND worker = 'server';
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_worker_fail(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.velocity_worker_fail(uuid, uuid, text, boolean) TO service_role;

-- ── front-on reads: the plates' height is the ruler, their width a thickness ─
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
  err numeric; ratio numeric; scale_rel numeric; picked uuid; confirmed boolean; scale_ok boolean; view text;
  num CONSTANT text := '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$';
BEGIN
  SELECT * INTO s FROM public.pl_set_videos WHERE id = _set_video_id;
  UPDATE public.pl_row_results
     SET mean_concentric_velocity_mps = NULL, velocity_source = NULL, velocity_set_video_id = NULL,
         velocity_quality = NULL, velocity_uncertainty = NULL
   WHERE velocity_set_video_id = _set_video_id AND velocity_source = 'video'
     AND (s.id IS NULL OR s.deleted_at IS NOT NULL OR s.result_id IS DISTINCT FROM id);
  IF s.id IS NULL OR s.result_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.pl_row_results WHERE id = s.result_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
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
    view := coalesce(raw#>>'{plate,view}', 'side');
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
         -- front-on (plates edge-on): the width is the stack's thickness, never an angle
         OR (view <> 'front' AND ratio < (CASE WHEN view = 'turned' THEN 0.6 ELSE 0.75 END))
         OR coalesce(raw#>'{quality,notes}', '[]'::jsonb) ? 'camera_moved'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(raw#>'{track,lost}', '[]'::jsonb)) g
                     WHERE (g->>'end') ~ num AND (g->>'start') ~ num
                       AND (g->>'end')::numeric - (g->>'start')::numeric > 1.5)
         OR (r.actual_reps IS NOT NULL AND abs(r.actual_reps - nr) > 1)
         OR NOT (v > 0 AND v <= 3.5)
         OR u / v > 0.35 THEN
        v := NULL;
      ELSE
        -- a read the server estimated (any angle) is an estimate, whatever its margin
        tier := CASE WHEN raw#>>'{velocity,tier}' = 'measured' AND nm = nr AND u / v <= 0.08
                          AND r.actual_reps IS NOT DISTINCT FROM nr
                          AND NOT (coalesce(raw#>'{quality,notes}', '[]'::jsonb) ? 'estimated_track')
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

-- ── admins: see what's pending, done and failed, and send one back ───────────
CREATE OR REPLACE FUNCTION public.velocity_admin_overview(_limit integer DEFAULT 150)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE out jsonb;
BEGIN
  IF NOT ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'worker', (SELECT value::jsonb || jsonb_build_object('updated_at', updated_at) FROM public.app_settings WHERE key = 'velocity_worker'),
    'counts', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
                 SELECT CASE WHEN j.status = 'queued' AND j.available_at > now() THEN 'waiting_retry' ELSE j.status END k, count(*) n
                   FROM public.set_velocity_jobs j JOIN public.pl_set_videos s ON s.id = j.set_video_id
                  WHERE s.deleted_at IS NULL GROUP BY 1) c),
    'oldest_queued', (SELECT min(j.updated_at) FROM public.set_velocity_jobs j JOIN public.pl_set_videos s ON s.id = j.set_video_id
                       WHERE s.deleted_at IS NULL AND j.enabled AND j.status = 'queued' AND j.available_at <= now()),
    'jobs', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'set_video_id', j.set_video_id, 'client_id', j.client_id,
        'athlete', trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
        'exercise', j.exercise_name, 'set_index', s.set_index, 'origin', s.origin,
        'created_at', s.created_at, 'status', j.status, 'enabled', j.enabled, 'worker', j.worker,
        'stage', j.stage, 'outcome', j.outcome, 'error', j.error,
        'attempts', j.attempts, 'server_attempts', j.server_attempts,
        'available_at', j.available_at, 'heartbeat_at', j.heartbeat_at, 'finished_at', j.finished_at,
        'compute_ms', j.compute_ms,
        'analysis', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
            'status', a.status, 'engine', a.engine, 'source', a.source, 'units', a.units, 'reps', a.reps,
            'accepted', a.velocity_accepted, 'set_mcv', a.set_mcv, 'excluded', a.excluded,
            'why', a.result->>'why', 'reasons', a.result#>'{velocity,reasons}', 'view', a.result#>>'{plate,view}') END,
        'set', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
            'reps', r.actual_reps, 'load_kg', r.actual_load_kg, 'velocity', r.mean_concentric_velocity_mps,
            'source', r.velocity_source, 'quality', r.velocity_quality, 'from_this_video', r.velocity_set_video_id = j.set_video_id) END
      ) x
        FROM public.set_velocity_jobs j
        JOIN public.pl_set_videos s ON s.id = j.set_video_id
        LEFT JOIN public.clients c ON c.id = j.client_id
        LEFT JOIN public.pl_set_video_analyses a ON a.set_video_id = j.set_video_id
        LEFT JOIN public.pl_row_results r ON r.id = s.result_id
       WHERE s.deleted_at IS NULL
       ORDER BY s.created_at DESC
       LIMIT greatest(1, least(coalesce(_limit, 150), 500))
    ) t)
  ) INTO out;
  RETURN out;
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_admin_overview(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_admin_overview(integer) TO authenticated;

/** Read again on the server (an admin): never over a person's own read or a speed already on the set. */
CREATE OR REPLACE FUNCTION public.velocity_admin_requeue(_video uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (SELECT public.has_role((SELECT auth.uid()), 'admin')) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM public._velocity_enqueue(_video);
  IF NOT public._velocity_server_may_read(_video) THEN RETURN 'kept'; END IF;
  UPDATE public.set_velocity_jobs
     SET enabled = true, status = 'queued', server_attempts = 0, attempts = least(attempts, 3), available_at = now(),
         lease_id = NULL, lease_until = NULL, error = NULL, outcome = 'requeued', stage = NULL, updated_at = now()
   WHERE set_video_id = _video AND status <> 'running';
  RETURN CASE WHEN FOUND THEN 'queued' ELSE 'running' END;
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_admin_requeue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.velocity_admin_requeue(uuid) TO authenticated;

-- ── nothing waits unseen: a stalled worker raises one alert ──────────────────
CREATE OR REPLACE FUNCTION public.velocity_worker_watch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE oldest timestamptz; seen timestamptz; waiting int;
BEGIN
  SELECT min(j.updated_at), count(*) INTO oldest, waiting
    FROM public.set_velocity_jobs j JOIN public.pl_set_videos s ON s.id = j.set_video_id
   WHERE s.deleted_at IS NULL AND j.enabled AND j.status = 'queued' AND j.available_at <= now();
  SELECT (value::jsonb->>'last_seen')::timestamptz INTO seen FROM public.app_settings WHERE key = 'velocity_worker';
  IF waiting > 0 AND oldest < now() - interval '45 minutes' AND (seen IS NULL OR seen < now() - interval '30 minutes') THEN
    IF NOT EXISTS (SELECT 1 FROM public.support_alerts WHERE error_type = 'velocity_worker_stalled' AND status = 'open') THEN
      INSERT INTO public.support_alerts (error_type, error_message, page_route, details, status)
      VALUES ('velocity_worker_stalled',
              waiting || ' set video(s) waiting for bar speed; the server reader was last seen ' || coalesce(to_char(seen, 'YYYY-MM-DD HH24:MI TZ'), 'never'),
              '/admin/settings/velocity',
              jsonb_build_object('waiting', waiting, 'oldest', oldest, 'last_seen', seen), 'open');
    END IF;
  ELSE
    UPDATE public.support_alerts SET status = 'resolved', resolved_at = now(), updated_at = now()
     WHERE error_type = 'velocity_worker_stalled' AND status = 'open';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.velocity_worker_watch() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('velocity-worker-watch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'velocity-worker-watch');
  PERFORM cron.schedule('velocity-worker-watch', '13,43 * * * *', 'SELECT public.velocity_worker_watch();');
END $$;

-- ── every barbell press variation is a lift to read (exercise.ts analysableExercise) ─
-- "Close-Grip Block Press", "Board Press", "Incline Press" named no rule, so their
-- set videos were never read.
CREATE OR REPLACE FUNCTION public._velocity_analysable(_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN coalesce(trim(_name), '') = '' THEN false
    -- no plate to follow (src/lib/lift-analysis/exercise.ts NOT_A_BAR)
    WHEN lower(_name) ~ '\m(dumbbells?|db|cables?|bands?|kettlebells?|kb|bodyweight|pull[ -]?ups?|chin[ -]?ups?|dips?|push[ -]?ups?|planks?|carry|carries|sled|treadmill|bike|walk|run|running|leg press|hack squat|pendulum|belt squat|lat pull|pulldown|curl machine|pec deck|leg extension|leg curl|calf raise machine|landmine)\M' THEN false
    WHEN lower(_name) ~ '\mmachine\M' AND lower(_name) !~ '\msmith\M' THEN false
    ELSE lower(_name) ~ '\m(barbell|smith|trap bar|ez bar|larsen|spoto|floor press|pin press|block press|board press|close[ -]?grip press|jerks?|deadlifts?|dl|rack pulls?|block pulls?|deficit pulls?|cleans?|snatch(es)?|high pulls?|rows?|pendlay|overhead press|ohp|military press|push press|strict press|z press|hip thrusts?|glute bridges?|shrugs?|squats?|bench|rdls?|sldl|romanian|good mornings?|stiff[ -]?leg)\M'
      OR lower(_name) ~ '\m(incline|decline)\M.*\mpress\M|\mpress\M.*\m(incline|decline)\M'
  END
$function$;

-- ── catch up: every barbell set video in the last 60 days with no speed ─────
DO $$
DECLARE v uuid;
BEGIN
  -- a job for every set video that never had one
  FOR v IN SELECT s.id FROM public.pl_set_videos s
            WHERE s.deleted_at IS NULL AND s.set_index > 0 AND s.created_at > now() - interval '60 days'
              AND NOT EXISTS (SELECT 1 FROM public.set_velocity_jobs j WHERE j.set_video_id = s.id)
  LOOP
    PERFORM public._velocity_enqueue(v);
  END LOOP;
END $$;

UPDATE public.set_velocity_jobs j
   SET enabled = true, status = 'queued', available_at = now(), server_attempts = 0,
       lease_id = NULL, lease_until = NULL, error = NULL, outcome = 'backfill', stage = NULL, updated_at = now()
  FROM public.pl_set_videos s
 WHERE s.id = j.set_video_id AND s.deleted_at IS NULL AND s.set_index > 0
   AND s.created_at > now() - interval '60 days' AND coalesce(s.duration_s, 0) <= 120
   AND public._velocity_analysable(j.exercise_name)
   AND j.status IN ('queued', 'running', 'failed', 'needs_review', 'needs_calibration', 'skipped')
   -- a phone's own "turn automatic reading off" stays off
   AND (j.enabled OR (j.status = 'skipped' AND j.attempts = 0 AND j.updated_at <= j.created_at + interval '2 seconds'))
   AND public._velocity_server_may_read(j.set_video_id)
   -- safe to run again: what the server has already read isn't read again
   AND j.worker IS DISTINCT FROM 'server';

SELECT public.rls_evaluate_once('set_velocity_jobs');
