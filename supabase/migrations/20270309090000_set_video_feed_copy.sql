-- Set videos: a 720p copy for Crew.
--
-- A set video goes to the coach exactly as the phone can send it fastest,
-- which for an iPhone's 4K clip is the original (its encoder can't shrink
-- 4K in time, render.ts encodeTooSlow): ~50 MB for 30 seconds, about five
-- times what the feed needs, and half of them over a workout post's 50 MB,
-- so they never made the athlete's film at all.
--
-- Once the coach has the clip, the athlete's phone makes a 720p copy of the
-- same selection in the background (set-videos/uploader.ts, feed copy),
-- uploads it next to the original in the coach chat's folder
-- (<client>/set-videos/<job>-feed.<ext>), has the server check it as a
-- workout post's video (90 s, 50 MB) and records it here. The workout film
-- (workout-film.functions.ts) is made from the copy when there is one; the
-- coach chat's clip never changes. A copy that couldn't be made changes
-- nothing: the film uses the original as before.

ALTER TABLE public.pl_set_videos
  ADD COLUMN IF NOT EXISTS feed_path       text,
  ADD COLUMN IF NOT EXISTS feed_width      int,
  ADD COLUMN IF NOT EXISTS feed_height     int,
  ADD COLUMN IF NOT EXISTS feed_duration_s numeric(10,3),
  ADD COLUMN IF NOT EXISTS feed_size_bytes bigint;

/**
 * Record a set video's feed copy. Only the person who sent the set video,
 * only a file in that client's set-videos folder named as a feed copy, and
 * only once the server has checked it as a workout post's video. Returns the
 * finished workout whose film is already in the feed, so the app can bring
 * that post up to date (null otherwise: a film posted later uses the copy).
 */
CREATE OR REPLACE FUNCTION public.set_video_feed_copy(_id uuid, _path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v      public.pl_set_videos;
  c      public.media_video_checks;
  v_comp uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR v.deleted_at IS NOT NULL OR v.uploaded_by <> v_uid THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _path IS NULL OR length(_path) > 300 OR position('..' IN _path) > 0
     OR _path !~ ('^' || v.client_id::text || '/set-videos/[A-Za-z0-9_-]+-feed\.(mp4|mov|webm)$') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  -- checked, unchanged since, and a workout post's length and size
  PERFORM public.media_video_allowed('message-attachments', _path, 90, 52428800);
  SELECT * INTO c FROM public.media_video_checks WHERE bucket = 'message-attachments' AND path = _path;
  IF c.path IS NULL OR c.owner IS DISTINCT FROM v_uid THEN
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

  RETURN jsonb_build_object('id', v.id, 'completion_id', v_comp);
END
$$;
REVOKE ALL ON FUNCTION public.set_video_feed_copy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_feed_copy(uuid, text) TO authenticated, service_role;
