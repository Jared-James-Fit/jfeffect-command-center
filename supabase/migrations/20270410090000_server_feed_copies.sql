-- Set videos: the 720p copy for Crew made on a server, not the phone (Nov 18 2026).
--
-- An iPhone films 4K (~1.8 MB a second), so a set video goes to the coach as
-- it was and the athlete's phone then makes a 720p copy for the workout film
-- (feed copies, 20270309090000_set_video_feed_copy.sql). That copy needs the
-- app open for a minute or two after the clip lands; Jared's Monday Pull Up
-- (58.5 MB, 31 s) never got one and his film showed 5 of his 6 sets.
--
-- Now the copy is made by a video service (Mux) the moment the clip lands,
-- whether the app is open or not: the database queues a job for every set
-- video that needs one (set_video_needs_server_copy, the same rule as the
-- phone's feed copy) and wakes the feed-copies-tick hook, which hands the
-- service a short-lived link to the clip, waits for its 720p MP4, stores it
-- next to the original as <client>/set-videos/<job>-feed.mp4, checks it like
-- any upload (media_video_checks), records it (set_video_feed_copy_server),
-- brings a film already in the feed up to date, and deletes it from the
-- service. The coach chat's clip never changes.
--
-- Until the service's keys are set on the server (MUX_TOKEN_ID /
-- MUX_TOKEN_SECRET), jobs wait (looked at again hourly) and phones keep
-- making copies as before; once a job runs with the keys, app_settings
-- 'feed_copies' says so and phones leave new clips to the server, making a
-- copy themselves only for a clip still without one after 30 minutes.
-- Only clips whose film goes to Crew are sent (community_profiles.auto_post_film,
-- or a film post Shared to Crew later, workout-film.server.ts).

CREATE TABLE IF NOT EXISTS public.set_video_feed_jobs (
  set_video_id uuid PRIMARY KEY REFERENCES public.pl_set_videos(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed', 'skipped')),
  provider     text NOT NULL DEFAULT 'mux',
  asset_id     text,
  playback_id  text,
  attempts     int NOT NULL DEFAULT 0,
  error        text,
  next_at      timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS set_video_feed_jobs_due ON public.set_video_feed_jobs (next_at) WHERE status IN ('queued', 'processing');
ALTER TABLE public.set_video_feed_jobs ENABLE ROW LEVEL SECURITY;
-- server only: no policies, no grants
REVOKE ALL ON public.set_video_feed_jobs FROM anon, authenticated;

/** A set video the film needs a 720p copy of (heavier than a feed clip, short enough for a workout post). The app's needsServerCopy (server-copy.ts) is the same rule. */
CREATE OR REPLACE FUNCTION public.set_video_needs_server_copy(v public.pl_set_videos)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT v.deleted_at IS NULL
     AND v.set_index > 0
     AND v.feed_path IS NULL
     AND v.storage_path ~ ('^' || v.client_id::text || '/set-videos/[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*\.(mp4|mov|webm)$')
     AND v.storage_path !~ '-feed\.(mp4|mov|webm)$'
     AND coalesce(v.duration_s, 0) BETWEEN 0.5 AND 91.5
     AND coalesce(v.size_bytes, 0) >= 4194304
     AND (greatest(coalesce(v.width, 0), coalesce(v.height, 0)) > 1300 OR coalesce(v.size_bytes, 0) > 46137344)
$$;

/** Wake the hook for one job (pg_net sends it after commit; never fails the write that queued it). */
CREATE OR REPLACE FUNCTION public.set_video_feed_jobs_kick(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/feed-copies-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
    ),
    body := jsonb_build_object('setVideoId', _id),
    timeout_milliseconds := 120000
  );
EXCEPTION WHEN others THEN
  NULL;
END
$$;
REVOKE ALL ON FUNCTION public.set_video_feed_jobs_kick(uuid) FROM PUBLIC, anon, authenticated;

/** Queue a copy for a clip that needs one and whose film goes to Crew. Service role only (the trigger and workout-film.server.ts). */
CREATE OR REPLACE FUNCTION public.set_video_feed_job_queue(_id uuid, _force boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.pl_set_videos;
  v_new int;
BEGIN
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR NOT public.set_video_needs_server_copy(v) THEN RETURN false; END IF;
  -- Coach only: the clip stays in the coach chat and goes nowhere else (unless they Shared to Crew: _force)
  IF NOT _force AND NOT coalesce((SELECT cp.auto_post_film FROM public.community_profiles cp WHERE cp.user_id = v.uploaded_by), true) THEN
    RETURN false;
  END IF;
  INSERT INTO public.set_video_feed_jobs (set_video_id) VALUES (_id) ON CONFLICT (set_video_id) DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  IF v_new > 0 THEN PERFORM public.set_video_feed_jobs_kick(_id); END IF;
  RETURN v_new > 0;
END
$$;
REVOKE ALL ON FUNCTION public.set_video_feed_job_queue(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_video_feed_job_queue(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_set_video_feed_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.set_video_feed_job_queue(NEW.id);
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- a set video always lands; the phone's own copy is the fallback
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS set_video_feed_job ON public.pl_set_videos;
CREATE TRIGGER set_video_feed_job
  AFTER INSERT ON public.pl_set_videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_video_feed_job();

/**
 * Record a feed copy the server made. The same checks as set_video_feed_copy
 * (a feed copy's name in the clip's own folder, checked as a workout post's
 * video and owned by whoever sent the clip), for the service role only.
 */
CREATE OR REPLACE FUNCTION public.set_video_feed_copy_server(_id uuid, _path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v      public.pl_set_videos;
  c      public.media_video_checks;
  v_comp uuid;
BEGIN
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _path IS NULL OR length(_path) > 300 OR position('..' IN _path) > 0
     OR _path !~ ('^' || v.client_id::text || '/set-videos/[A-Za-z0-9_-]+-feed\.(mp4|mov|webm)$') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM public.media_video_allowed('message-attachments', _path, 90, 52428800);
  SELECT * INTO c FROM public.media_video_checks WHERE bucket = 'message-attachments' AND path = _path;
  IF c.path IS NULL OR c.owner IS DISTINCT FROM v.uploaded_by THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pl_set_videos
     SET feed_path = _path,
         feed_width = c.width,
         feed_height = c.height,
         feed_duration_s = c.duration_s,
         feed_size_bytes = c.bytes
   WHERE id = _id;

  SELECT p.completion_id INTO v_comp
    FROM public.community_posts p
    JOIN public.pl_day_completions dc ON dc.id = p.completion_id
   WHERE dc.day_id = v.day_id AND dc.client_id = v.client_id AND dc.completed_at IS NOT NULL
     AND p.locked_in_at IS NULL AND p.archived_at IS NULL
     AND jsonb_typeof(p.film) = 'array' AND jsonb_array_length(p.film) > 0
   ORDER BY dc.completed_at DESC
   LIMIT 1;

  RETURN jsonb_build_object('id', v.id, 'completion_id', v_comp, 'user_id', v.uploaded_by);
END
$$;
REVOKE ALL ON FUNCTION public.set_video_feed_copy_server(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_video_feed_copy_server(uuid, text) TO service_role;

/** Whether the server makes the feed copies (the phone then leaves new clips to it). */
CREATE OR REPLACE FUNCTION public.set_video_server_copies()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT CASE WHEN s.value ~ '^\s*\{' THEN (s.value::jsonb ->> 'server')::boolean END
       FROM public.app_settings s WHERE s.key = 'feed_copies' LIMIT 1),
    false);
$$;
REVOKE ALL ON FUNCTION public.set_video_server_copies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_server_copies() TO authenticated, service_role;

-- What's already waiting: the last two weeks' clips that need a copy (Jared's Pull Up among them).
INSERT INTO public.set_video_feed_jobs (set_video_id)
SELECT v.id
  FROM public.pl_set_videos v
 WHERE v.created_at > now() - interval '14 days'
   AND public.set_video_needs_server_copy(v)
   AND coalesce((SELECT cp.auto_post_film FROM public.community_profiles cp WHERE cp.user_id = v.uploaded_by), true)
ON CONFLICT (set_video_id) DO NOTHING;

-- Every minute while a job is due (a job waiting on the keys is due again hourly).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'feed-copies-tick';
  PERFORM cron.schedule(
    'feed-copies-tick',
    '* * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/feed-copies-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id
    WHERE EXISTS (
      SELECT 1 FROM public.set_video_feed_jobs
       WHERE status IN ('queued', 'processing') AND next_at <= now() AND created_at > now() - interval '14 days'
    );
    $cmd$
  );
END
$$;
