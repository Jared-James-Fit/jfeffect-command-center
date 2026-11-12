-- A set's video can be added before the set is logged.
--
-- Nov 12 2026: Jared was filming his lateral raise and the set had no camera:
-- it showed only once a set was logged (the clip hung off the set's record,
-- pl_row_results.id), while people film the set first and log it after. The
-- camera is now on every set (set-video-cell.tsx). A clip filmed before its
-- set is saved goes up with no record (result_id null) and is on the set by
-- its exercise row and set number (videoOnSet, set-videos/jobs.ts); it's tied
-- to the set's record as soon as there is one:
--
-- 1. set_video_attach finds the record itself when the set was saved while
--    the clip was uploading (the latest one for that row and set number, saved
--    in the last 18 hours);
-- 2. saving the set links any unlinked clip of it from the last 18 hours
--    (pl_row_results_link_set_videos).
-- 18 hours (UNLINKED_SET_VIDEO_MS) keeps a repeat of the workout from picking
-- up an old clip.

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'set_video_attach' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '46019e6ce9e1311f374496deaa02ab81' THEN
    RAISE EXCEPTION 'set_video_attach changed since this migration was written';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_video_attach(_client_key text, _client_id uuid, _row_id uuid, _result_id uuid, _set_index integer, _label text, _storage_path text, _thumbnail_path text, _duration numeric, _width integer, _height integer, _size bigint, _mime text, _file_key text, _transfer jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_client public.clients;
  v_role   text;
  v_prev   public.pl_set_videos;
  v_ex     text;
  v_day    uuid;
  v_title  text;
  v_label  text := left(btrim(coalesce(_label, '')), 120);
  v_thumb  text := _thumbnail_path;
  v_id     uuid;
  v_msg    uuid;
  v_body   text;
  v_result uuid := _result_id;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _client_key IS NULL OR length(_client_key) NOT BETWEEN 8 AND 80
     OR _file_key IS NULL OR length(_file_key) NOT BETWEEN 8 AND 80 THEN
    RAISE EXCEPTION 'That video couldn''t be sent. Try again.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prev FROM public.pl_set_videos WHERE client_key = _client_key;
  IF FOUND THEN
    IF v_prev.client_id <> _client_id THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'message_id', v_prev.message_id, 'existed', true,
                              'set_index', v_prev.set_index, 'exercise', v_prev.exercise_name);
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = _client_id;
  IF NOT FOUND OR coalesce(v_client.archived, false) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_client.service_tier IS DISTINCT FROM 'coaching' THEN
    RAISE EXCEPTION 'Set videos go to your coach, and this account has no coach.' USING ERRCODE = '42501';
  END IF;
  IF v_client.user_id = v_uid THEN
    v_role := 'client';
  ELSIF (SELECT public.has_role(v_uid, 'admin'::public.app_role)) OR _client_id IN (SELECT public.coached_client_ids()) THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prev FROM public.pl_set_videos
   WHERE client_id = _client_id AND file_key = _file_key AND deleted_at IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_prev.id, 'message_id', v_prev.message_id, 'existed', true,
                              'set_index', v_prev.set_index, 'exercise', v_prev.exercise_name);
  END IF;

  IF _set_index IS NULL OR _set_index NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'That set isn''t in this workout any more.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(nullif(btrim(r.exercise_name_override), ''), e.name, 'Exercise'), r.day_id, d.title
    INTO v_ex, v_day, v_title
    FROM public.pl_exercise_rows r
    JOIN public.pl_days d   ON d.id = r.day_id
    JOIN public.pl_weeks w  ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    LEFT JOIN public.exercises e ON e.id = r.exercise_id
   WHERE r.id = _row_id AND b.client_id = _client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That set isn''t in this workout any more.' USING ERRCODE = '22023';
  END IF;
  IF _result_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.pl_row_results x
        WHERE x.id = _result_id AND x.row_id = _row_id AND x.client_id = _client_id) THEN
    RAISE EXCEPTION 'That set isn''t in this workout any more.' USING ERRCODE = '22023';
  END IF;
  -- Filmed before the set was saved: the set's record if it has one now.
  IF v_result IS NULL THEN
    SELECT x.id INTO v_result
      FROM public.pl_row_results x
     WHERE x.row_id = _row_id AND x.set_index = _set_index AND x.client_id = _client_id
       AND x.updated_at > now() - interval '18 hours'
     ORDER BY x.updated_at DESC
     LIMIT 1;
  END IF;

  IF _storage_path IS NULL OR _storage_path NOT LIKE _client_id::text || '/set-videos/%' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_thumb IS NOT NULL AND v_thumb NOT LIKE _client_id::text || '/set-videos/%' THEN v_thumb := NULL; END IF;
  PERFORM public.media_video_allowed('message-attachments', _storage_path, 600, 209715200);

  BEGIN
    INSERT INTO public.pl_set_videos
      (client_id, uploaded_by, row_id, day_id, result_id, set_index, exercise_name, workout_title, label,
       storage_path, thumbnail_path, duration_s, width, height, size_bytes, mime, transfer, file_key, client_key)
    VALUES
      (_client_id, v_uid, _row_id, v_day, v_result, _set_index, v_ex, v_title, v_label,
       _storage_path, v_thumb, _duration, _width, _height, _size, left(_mime, 60), _transfer, _file_key, _client_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_prev FROM public.pl_set_videos
     WHERE client_key = _client_key
        OR storage_path = _storage_path
        OR (client_id = _client_id AND file_key = _file_key AND deleted_at IS NULL)
     ORDER BY created_at
     LIMIT 1;
    RETURN jsonb_build_object('id', v_prev.id, 'message_id', v_prev.message_id, 'existed', true,
                              'set_index', v_prev.set_index, 'exercise', v_prev.exercise_name);
  END;

  v_body := left('🎥 ' || v_ex || ' · Set ' || _set_index || coalesce(' · ' || nullif(v_label, ''), ''), 200);
  INSERT INTO public.messages
    (client_id, sender_id, sender_role, body, attachments, message_type, delivery_status, sent_at, read_by_client_at, read_by_admin_at)
  VALUES (
    _client_id, v_uid, v_role, v_body,
    jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type', 'video', 'url', '',
      'storage_path', _storage_path,
      'thumbnail_storage_path', v_thumb,
      'name', 'Set ' || _set_index || ' video',
      'size', _size, 'mime', left(_mime, 60), 'duration', _duration,
      'width', _width, 'height', _height,
      'transfer', _transfer,
      'set_video', jsonb_strip_nulls(jsonb_build_object(
        'id', v_id, 'exercise', v_ex, 'set', _set_index, 'label', nullif(v_label, ''),
        'workout', v_title, 'day_id', v_day, 'row_id', _row_id))))),
    'Set Video', 'sent', now(),
    CASE WHEN v_role = 'client' THEN now() END,
    CASE WHEN v_role = 'admin' THEN now() END)
  RETURNING id INTO v_msg;
  UPDATE public.pl_set_videos SET message_id = v_msg WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'message_id', v_msg, 'existed', false,
                            'set_index', _set_index, 'exercise', v_ex);
END
$function$;

REVOKE ALL ON FUNCTION public.set_video_attach(text, uuid, uuid, uuid, integer, text, text, text, numeric, integer, integer, bigint, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_attach(text, uuid, uuid, uuid, integer, text, text, text, numeric, integer, integer, bigint, text, text, jsonb) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS pl_set_videos_unlinked_idx
  ON public.pl_set_videos (row_id, set_index)
  WHERE result_id IS NULL AND deleted_at IS NULL;

-- Saving a set ties to it any clip filmed of it before it was saved.
CREATE OR REPLACE FUNCTION public.pl_row_results_link_set_videos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.pl_set_videos v
     SET result_id = NEW.id
   WHERE v.row_id = NEW.row_id
     AND v.set_index = NEW.set_index
     AND v.client_id = NEW.client_id
     AND v.result_id IS NULL
     AND v.deleted_at IS NULL
     AND v.created_at > now() - interval '18 hours';
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.pl_row_results_link_set_videos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pl_row_results_link_set_videos ON public.pl_row_results;
CREATE TRIGGER pl_row_results_link_set_videos
  AFTER INSERT ON public.pl_row_results
  FOR EACH ROW EXECUTE FUNCTION public.pl_row_results_link_set_videos();
