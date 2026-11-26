-- The athlete's body, read on the server for every analysed set video (Nov 26 2026).
--
-- Technique (joint angles, the skeleton, hip & knee paths) used to be read on
-- the phone only when someone opened it: a 24 MB model and a minute of the
-- phone's time, so most set videos never had one. The server's reader
-- (scripts/velocity-worker) now reads the body once the bar's read is saved,
-- with the app's own runPose, and keeps the track here (pose-pack.ts), so
-- Technique opens on it at once and the coach can see it without anyone
-- having opened anything.
--
-- `pl_set_video_poses` is both the result and its queue: one row per set
-- video, queued by the analysis being saved (`_pose_enqueue`), leased to the
-- server for 20 minutes, three tries with backoff, then failed with why. A
-- read the bar's later reads still fit (`_pose_covers`) is kept; one that no
-- longer covers the set's window is read again. Nobody but the server writes
-- it; whoever may read the set video may read its body.

-- the triggers below take a short lock on busy tables: never queue the app's reads behind it
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.pl_set_video_poses (
  set_video_id uuid PRIMARY KEY REFERENCES public.pl_set_videos(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'no_body', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  engine text,
  model text,
  delegate text,
  fps numeric,
  frame_w integer,
  frame_h integer,
  window_start numeric,
  window_end numeric,
  window_whole boolean NOT NULL DEFAULT false,
  clip_seconds numeric,
  frames integer,
  found integer,
  view text,
  side text,
  track jsonb,
  summary jsonb,
  why text,
  error text,
  compute_ms integer,
  analysis_base timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_set_video_poses_due ON public.pl_set_video_poses (available_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS pl_set_video_poses_client ON public.pl_set_video_poses (client_id);

ALTER TABLE public.pl_set_video_poses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pl_set_video_poses FROM anon, authenticated;
GRANT SELECT ON public.pl_set_video_poses TO authenticated;

DROP POLICY IF EXISTS "Set video poses: admin" ON public.pl_set_video_poses;
CREATE POLICY "Set video poses: admin" ON public.pl_set_video_poses FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
DROP POLICY IF EXISTS "Set video poses: coach" ON public.pl_set_video_poses;
CREATE POLICY "Set video poses: coach" ON public.pl_set_video_poses FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Set video poses: own" ON public.pl_set_video_poses;
CREATE POLICY "Set video poses: own" ON public.pl_set_video_poses FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

/** Whether a stored body read covers a bar read's window (pose-pack.ts `storedPoseCovers`, the same rule). */
CREATE OR REPLACE FUNCTION public._pose_covers(_p public.pl_set_video_poses, _result jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE s numeric; e numeric; want_s numeric; want_e numeric;
BEGIN
  IF _p.window_start IS NULL OR _p.window_end IS NULL OR _p.window_end <= _p.window_start THEN RETURN false; END IF;
  BEGIN
    s := (_result #>> '{window,start}')::numeric;
    e := (_result #>> '{window,end}')::numeric;
  EXCEPTION WHEN others THEN
    s := NULL; e := NULL;
  END;
  IF s IS NULL OR e IS NULL OR e <= s THEN
    want_e := CASE WHEN _p.clip_seconds > 0 THEN least(90, _p.clip_seconds) ELSE 90 END;
    RETURN _p.window_start <= 0.05 AND (_p.window_whole OR _p.window_end >= want_e - 0.3);
  END IF;
  want_s := greatest(0, s - 0.5);
  want_e := e + 0.5;
  IF _p.clip_seconds > 0 THEN want_e := least(want_e, _p.clip_seconds); END IF;
  RETURN _p.window_start <= want_s + 0.3 AND _p.window_end >= want_e - 0.3;
END
$$;
REVOKE ALL ON FUNCTION public._pose_covers(public.pl_set_video_poses, jsonb) FROM PUBLIC, anon, authenticated;

/** Queue (or queue again) a set video's body read: a new bar read with no body, or one the body no longer covers. */
CREATE OR REPLACE FUNCTION public._pose_enqueue(_video uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s public.pl_set_videos; p public.pl_set_video_poses; res jsonb;
BEGIN
  SELECT * INTO s FROM public.pl_set_videos WHERE id = _video;
  IF s.id IS NULL OR s.deleted_at IS NOT NULL OR s.storage_path IS NULL THEN RETURN; END IF;
  SELECT result INTO res FROM public.pl_set_video_analyses WHERE set_video_id = _video;
  SELECT * INTO p FROM public.pl_set_video_poses WHERE set_video_id = _video FOR UPDATE;
  IF p.set_video_id IS NULL THEN
    INSERT INTO public.pl_set_video_poses (set_video_id, client_id)
    VALUES (_video, s.client_id)
    ON CONFLICT (set_video_id) DO NOTHING;
    RETURN;
  END IF;
  -- a read underway is checked against the bar's read when it's handed back (pose_worker_commit)
  IF p.status IN ('queued', 'running') THEN RETURN; END IF;
  -- a read that still covers the set's window is kept (with no bar read there's nothing new to fit)
  IF p.status IN ('done', 'no_body') AND (res IS NULL OR public._pose_covers(p, res)) THEN RETURN; END IF;
  UPDATE public.pl_set_video_poses
     SET status = 'queued', attempts = 0, available_at = now(), lease_id = NULL, lease_until = NULL,
         error = NULL, updated_at = now()
   WHERE set_video_id = _video;
END
$$;
REVOKE ALL ON FUNCTION public._pose_enqueue(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_set_video_analysis_queue_pose()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.result IS NOT DISTINCT FROM OLD.result THEN RETURN NEW; END IF;
  PERFORM public._pose_enqueue(NEW.set_video_id);
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- the bar's read is never refused for its body's sake
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.tg_set_video_analysis_queue_pose() FROM PUBLIC, anon, authenticated;

-- created only when missing: DROP TRIGGER needs an exclusive lock on a busy table, CREATE doesn't
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_video_analysis_queue_pose' AND tgrelid = 'public.pl_set_video_analyses'::regclass) THEN
    CREATE TRIGGER set_video_analysis_queue_pose
      AFTER INSERT OR UPDATE OF result ON public.pl_set_video_analyses
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_video_analysis_queue_pose();
  END IF;
END $$;

/** A removed set video's body read goes with it, like its bar read (a track stays readable otherwise). */
CREATE OR REPLACE FUNCTION public.tg_set_video_removed_cancel_pose()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    DELETE FROM public.pl_set_video_poses WHERE set_video_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.tg_set_video_removed_cancel_pose() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_video_removed_cancel_pose' AND tgrelid = 'public.pl_set_videos'::regclass) THEN
    CREATE TRIGGER set_video_removed_cancel_pose
      AFTER UPDATE OF deleted_at ON public.pl_set_videos
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_video_removed_cancel_pose();
  END IF;
END $$;

/** Up to _limit due body reads, leased to the server for 20 minutes, with the bar's read to go by. */
CREATE OR REPLACE FUNCTION public.pose_worker_claim(_limit integer DEFAULT 1, _worker text DEFAULT NULL)
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
    SELECT p.set_video_id
      FROM public.pl_set_video_poses p
      JOIN public.pl_set_videos s ON s.id = p.set_video_id
     WHERE s.deleted_at IS NULL AND s.storage_path IS NOT NULL
       AND p.attempts < 3 AND p.available_at <= now()
       AND (p.status = 'queued' OR (p.status = 'running' AND p.lease_until < now()))
     ORDER BY p.available_at, p.created_at
     LIMIT greatest(1, least(coalesce(_limit, 1), 5))
     FOR UPDATE OF p SKIP LOCKED
  ), claimed AS (
    UPDATE public.pl_set_video_poses p
       SET status = 'running', attempts = p.attempts + 1, lease_id = gen_random_uuid(),
           lease_until = now() + interval '20 minutes', heartbeat_at = now(), error = NULL, updated_at = now(),
           analysis_base = (SELECT a.updated_at FROM public.pl_set_video_analyses a WHERE a.set_video_id = p.set_video_id)
      FROM due WHERE p.set_video_id = due.set_video_id
    RETURNING p.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'set_video_id', c.set_video_id,
           'lease_id', c.lease_id,
           'attempt', c.attempts,
           'exercise_name', coalesce(s.exercise_name, ''),
           'storage_path', s.storage_path,
           'duration_s', s.duration_s,
           'analysis', a.result,
           'analysis_base', a.updated_at)), '[]'::jsonb)
    INTO out
    FROM claimed c
    JOIN public.pl_set_videos s ON s.id = c.set_video_id
    LEFT JOIN public.pl_set_video_analyses a ON a.set_video_id = c.set_video_id;
  RETURN out;
END
$function$;
REVOKE ALL ON FUNCTION public.pose_worker_claim(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pose_worker_claim(integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.pose_worker_heartbeat(_video uuid, _lease uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._velocity_server_only();
  UPDATE public.pl_set_video_poses
     SET heartbeat_at = now(), lease_until = greatest(lease_until, now() + interval '20 minutes'), updated_at = now()
   WHERE set_video_id = _video AND lease_id = _lease AND status = 'running';
  RETURN FOUND;
END
$function$;
REVOKE ALL ON FUNCTION public.pose_worker_heartbeat(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pose_worker_heartbeat(uuid, uuid) TO service_role;

/**
 * The body's read stored. `_pose`: status ('done' | 'no_body'), engine, model,
 * delegate, fps, frame {w,h}, window {start,end,whole,duration}, frames, found,
 * view, side, track (pose-pack.ts), summary, why, compute_ms. When the bar's
 * read changed meanwhile and the window no longer fits, it's read again.
 */
CREATE OR REPLACE FUNCTION public.pose_worker_commit(_video uuid, _lease uuid, _pose jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE p public.pl_set_video_poses; s public.pl_set_videos; res jsonb; changed timestamptz; st text; num numeric;
BEGIN
  PERFORM public._velocity_server_only();
  SELECT * INTO p FROM public.pl_set_video_poses WHERE set_video_id = _video FOR UPDATE;
  IF p.set_video_id IS NULL OR p.lease_id IS DISTINCT FROM _lease OR p.status <> 'running' THEN
    RETURN jsonb_build_object('ok', false, 'why', 'lease');
  END IF;
  SELECT * INTO s FROM public.pl_set_videos WHERE id = _video;
  IF s.id IS NULL OR s.deleted_at IS NOT NULL THEN
    UPDATE public.pl_set_video_poses SET status = 'cancelled', lease_id = NULL, lease_until = NULL, updated_at = now()
     WHERE set_video_id = _video;
    RETURN jsonb_build_object('ok', false, 'why', 'removed');
  END IF;
  st := coalesce(_pose->>'status', 'done');
  IF st NOT IN ('done', 'no_body') THEN RAISE EXCEPTION 'bad status' USING ERRCODE = '22023'; END IF;
  IF st = 'done' AND (jsonb_typeof(_pose->'track') IS DISTINCT FROM 'object' OR octet_length((_pose->'track')::text) > 3000000) THEN
    RAISE EXCEPTION 'bad track' USING ERRCODE = '22023';
  END IF;
  num := NULLIF(_pose #>> '{window,duration}', '')::numeric;
  UPDATE public.pl_set_video_poses
     SET status = st,
         engine = left(_pose->>'engine', 40),
         model = left(_pose->>'model', 60),
         delegate = left(_pose->>'delegate', 8),
         fps = NULLIF(_pose->>'fps', '')::numeric,
         frame_w = NULLIF(_pose #>> '{frame,w}', '')::integer,
         frame_h = NULLIF(_pose #>> '{frame,h}', '')::integer,
         window_start = NULLIF(_pose #>> '{window,start}', '')::numeric,
         window_end = NULLIF(_pose #>> '{window,end}', '')::numeric,
         window_whole = coalesce((_pose #>> '{window,whole}')::boolean, false),
         clip_seconds = num,
         frames = NULLIF(_pose->>'frames', '')::integer,
         found = NULLIF(_pose->>'found', '')::integer,
         view = left(_pose->>'view', 12),
         side = left(_pose->>'side', 8),
         track = CASE WHEN st = 'done' THEN _pose->'track' END,
         summary = CASE WHEN st = 'done' AND jsonb_typeof(_pose->'summary') = 'object' THEN _pose->'summary' END,
         why = left(_pose->>'why', 240),
         error = NULL,
         compute_ms = greatest(0, least(coalesce(NULLIF(_pose->>'compute_ms', '')::integer, 0), 3600000)),
         lease_id = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
   WHERE set_video_id = _video
  RETURNING * INTO p;
  -- the bar was read again meanwhile and the set's window moved past this read: read the body again
  -- (only when the bar's read changed since the claim, so a window this read can't fit never loops)
  SELECT result, updated_at INTO res, changed FROM public.pl_set_video_analyses WHERE set_video_id = _video;
  IF res IS NOT NULL AND changed IS DISTINCT FROM p.analysis_base AND NOT public._pose_covers(p, res) THEN
    UPDATE public.pl_set_video_poses SET status = 'queued', attempts = 0, available_at = now(), updated_at = now()
     WHERE set_video_id = _video;
    RETURN jsonb_build_object('ok', true, 'requeued', true);
  END IF;
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.pose_worker_commit(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pose_worker_commit(uuid, uuid, jsonb) TO service_role;

/** The body read couldn't finish: tried again later (backing off), three times at most, then failed with why. */
CREATE OR REPLACE FUNCTION public.pose_worker_fail(_video uuid, _lease uuid, _reason text, _retry boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._velocity_server_only();
  UPDATE public.pl_set_video_poses
     SET status = CASE WHEN _retry AND attempts < 3 THEN 'queued' ELSE 'failed' END,
         available_at = now() + make_interval(mins => (10 * power(3, greatest(attempts - 1, 0)))::integer),
         error = left(_reason, 240), lease_id = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
   WHERE set_video_id = _video AND lease_id = _lease AND status = 'running';
END
$function$;
REVOKE ALL ON FUNCTION public.pose_worker_fail(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pose_worker_fail(uuid, uuid, text, boolean) TO service_role;

-- ── admin diagnostics: each job says where its body read stands ─────────────
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
    'pose_counts', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
                 SELECT CASE WHEN p.status = 'queued' AND p.available_at > now() THEN 'waiting_retry' ELSE p.status END k, count(*) n
                   FROM public.pl_set_video_poses p JOIN public.pl_set_videos s ON s.id = p.set_video_id
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
            'source', r.velocity_source, 'quality', r.velocity_quality, 'from_this_video', r.velocity_set_video_id = j.set_video_id) END,
        'pose', CASE WHEN p.set_video_id IS NULL THEN NULL ELSE jsonb_build_object(
            'status', p.status, 'attempts', p.attempts, 'available_at', p.available_at, 'found', p.found, 'frames', p.frames,
            'view', p.view, 'error', p.error, 'why', p.why, 'compute_ms', p.compute_ms,
            'observations', coalesce(jsonb_array_length(p.summary->'observations'), 0)) END
      ) x
        FROM public.set_velocity_jobs j
        JOIN public.pl_set_videos s ON s.id = j.set_video_id
        LEFT JOIN public.clients c ON c.id = j.client_id
        LEFT JOIN public.pl_set_video_analyses a ON a.set_video_id = j.set_video_id
        LEFT JOIN public.pl_row_results r ON r.id = s.result_id
        LEFT JOIN public.pl_set_video_poses p ON p.set_video_id = j.set_video_id
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

/** Read the body again on the server (an admin). */
CREATE OR REPLACE FUNCTION public.pose_admin_requeue(_video uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s public.pl_set_videos;
BEGIN
  IF NOT (SELECT public.has_role((SELECT auth.uid()), 'admin')) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.pl_set_videos WHERE id = _video;
  IF s.id IS NULL OR s.deleted_at IS NOT NULL THEN RETURN 'removed'; END IF;
  INSERT INTO public.pl_set_video_poses (set_video_id, client_id) VALUES (_video, s.client_id)
  ON CONFLICT (set_video_id) DO UPDATE
     SET status = 'queued', attempts = 0, available_at = now(), lease_id = NULL, lease_until = NULL, error = NULL, updated_at = now()
   WHERE public.pl_set_video_poses.status <> 'running';
  RETURN CASE WHEN EXISTS (SELECT 1 FROM public.pl_set_video_poses WHERE set_video_id = _video AND status = 'running') THEN 'running' ELSE 'queued' END;
END
$function$;
REVOKE ALL ON FUNCTION public.pose_admin_requeue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pose_admin_requeue(uuid) TO authenticated;

-- ── a stalled reader is noticed for body reads too ───────────────────────────
CREATE OR REPLACE FUNCTION public.velocity_worker_watch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE oldest timestamptz; seen timestamptz; waiting int; p_oldest timestamptz; p_waiting int;
BEGIN
  -- a read cut off on its last try (its lease ran out with no tries left) would wait as "running"
  -- forever: it's failed, with why, so it shows and can be read again
  UPDATE public.set_velocity_jobs
     SET status = 'failed', outcome = 'failed', error = 'The read was cut off on every try.',
         lease_id = NULL, lease_until = NULL, stage = NULL, finished_at = now(), updated_at = now()
   WHERE status = 'running' AND worker = 'server' AND server_attempts >= 4 AND lease_until < now();
  UPDATE public.pl_set_video_poses
     SET status = 'failed', error = 'The body read was cut off on every try.',
         lease_id = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
   WHERE status = 'running' AND attempts >= 3 AND lease_until < now();
  SELECT min(j.updated_at), count(*) INTO oldest, waiting
    FROM public.set_velocity_jobs j JOIN public.pl_set_videos s ON s.id = j.set_video_id
   WHERE s.deleted_at IS NULL AND j.enabled AND j.status = 'queued' AND j.available_at <= now();
  SELECT min(p.available_at), count(*) INTO p_oldest, p_waiting
    FROM public.pl_set_video_poses p JOIN public.pl_set_videos s ON s.id = p.set_video_id
   WHERE s.deleted_at IS NULL AND p.status = 'queued' AND p.available_at <= now();
  oldest := least(oldest, p_oldest);
  waiting := coalesce(waiting, 0) + coalesce(p_waiting, 0);
  SELECT (value::jsonb->>'last_seen')::timestamptz INTO seen FROM public.app_settings WHERE key = 'velocity_worker';
  IF waiting > 0 AND oldest < now() - interval '45 minutes' AND (seen IS NULL OR seen < now() - interval '30 minutes') THEN
    IF NOT EXISTS (SELECT 1 FROM public.support_alerts WHERE error_type = 'velocity_worker_stalled' AND status = 'open') THEN
      INSERT INTO public.support_alerts (error_type, error_message, page_route, details, status)
      VALUES ('velocity_worker_stalled',
              waiting || ' set video read(s) waiting (bar speed or body); the server reader was last seen ' || coalesce(to_char(seen, 'YYYY-MM-DD HH24:MI TZ'), 'never'),
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

-- ── every set video already read gets its body read ──────────────────────────
INSERT INTO public.pl_set_video_poses (set_video_id, client_id)
SELECT a.set_video_id, s.client_id
  FROM public.pl_set_video_analyses a
  JOIN public.pl_set_videos s ON s.id = a.set_video_id
 WHERE s.deleted_at IS NULL AND s.storage_path IS NOT NULL
ON CONFLICT (set_video_id) DO NOTHING;
