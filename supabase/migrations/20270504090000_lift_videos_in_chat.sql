-- Lift videos sent in the coach chat get the same bar path and speed as set
-- videos (Nov 22 2026).
--
-- A client's video in their coach chat (sent from the + menu, the camera or
-- the library, "Last set comp bench") becomes a lift video: a pl_set_videos
-- row with origin 'chat' that points at the message it's already in. Nothing
-- new is posted and the client's own words are never rewritten; the message's
-- attachment gains `set_video` (the same key a set video's card has), so the
-- chat shows the read under it and the analysis, the move picker and the
-- velocity logging all work as they do for a set video.
--
--   * linked to a set when the phone (or the coach) is sure which one it is
--     (the caption, when the set was logged, the rep count); else kept on no
--     set with its best guess (`suggest`) for one tap to confirm, and never
--     on a set it isn't sure of;
--   * never in the workout's film in Crew and never given a feed copy: the
--     client sent it to their coach, not to the crew;
--   * taking it off a set (the logger's sheet) leaves the chat message as it
--     is; "Not a lift" takes the read away and leaves the video in the chat.
-- Rollback: docs/rollback/2026-11-22-lift-videos-in-chat-rollback.sql

ALTER TABLE public.pl_set_videos
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'set';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_set_videos_origin_check') THEN
    ALTER TABLE public.pl_set_videos
      ADD CONSTRAINT pl_set_videos_origin_check CHECK (origin IN ('set', 'chat'));
  END IF;
END $$;
-- a chat video not on a set yet has no set number (the checks on set_index pass on NULL)
ALTER TABLE public.pl_set_videos ALTER COLUMN set_index DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_set_videos_set_needs_index') THEN
    ALTER TABLE public.pl_set_videos
      ADD CONSTRAINT pl_set_videos_set_needs_index CHECK (origin = 'chat' OR set_index IS NOT NULL);
  END IF;
END $$;

-- never a feed copy (and so never the film's) for a chat video
CREATE OR REPLACE FUNCTION public.set_video_needs_server_copy(v pl_set_videos)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT v.deleted_at IS NULL
     AND v.origin = 'set'
     AND v.set_index > 0
     AND v.feed_path IS NULL
     AND v.storage_path ~ ('^' || v.client_id::text || '/set-videos/[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*\.(mp4|mov|webm)$')
     AND v.storage_path !~ '-feed\.(mp4|mov|webm)$'
     AND coalesce(v.duration_s, 0) BETWEEN 0.5 AND 91.5
     AND coalesce(v.size_bytes, 0) >= 4194304
     AND (greatest(coalesce(v.width, 0), coalesce(v.height, 0)) > 1300 OR coalesce(v.size_bytes, 0) > 46137344)
$function$;

/** Writes a message's attachment as the server (a client can't change an attachment on their own message). */
CREATE OR REPLACE FUNCTION public._chat_lift_set_attachment(_message_id uuid, _path text, _set_video jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.messages m
     SET attachments = (
       SELECT jsonb_agg(
                CASE WHEN a ->> 'storage_path' = _path AND a ->> 'type' = 'video'
                     THEN CASE WHEN _set_video IS NULL THEN a - 'set_video'
                               ELSE jsonb_set(a, '{set_video}', jsonb_strip_nulls(_set_video)) END
                     ELSE a END
                ORDER BY t.ord)
         FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS t(a, ord))
   WHERE m.id = _message_id
     AND m.deleted_at IS NULL
     AND jsonb_typeof(m.attachments) = 'array';
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
END
$$;
REVOKE ALL ON FUNCTION public._chat_lift_set_attachment(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

/**
 * Make a client's chat video a lift video (once; a second call returns the
 * first). On a set only when one is named (`_row_id` + `_set_index`): the
 * caller is sure. Otherwise on no set, with the workout it's from when known
 * (`_day_id`) and the set it's probably from (`_suggest`, shown for one tap).
 * The athlete, their coach or an admin; only the athlete's own videos.
 */
CREATE OR REPLACE FUNCTION public.chat_video_lift(
  _message_id uuid,
  _storage_path text,
  _row_id uuid DEFAULT NULL,
  _set_index integer DEFAULT NULL,
  _day_id uuid DEFAULT NULL,
  _label text DEFAULT NULL,
  _how text DEFAULT 'auto',
  _suggest jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_msg    public.messages;
  v_client public.clients;
  v_att    jsonb;
  v_prev   public.pl_set_videos;
  v_day    uuid;
  v_ex     text;
  v_title  text;
  v_result uuid;
  v_name   text;
  v_label  text := left(btrim(coalesce(_label, '')), 120);
  v_how    text := CASE WHEN _how IN ('auto', 'athlete', 'coach') THEN _how ELSE 'auto' END;
  v_id     uuid;
  v_sug    jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_msg FROM public.messages WHERE id = _message_id;
  IF NOT FOUND OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message isn''t in the chat any more.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_client FROM public.clients WHERE id = v_msg.client_id;
  IF NOT FOUND OR coalesce(v_client.archived, false) OR v_client.service_tier IS DISTINCT FROM 'coaching' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  -- only the athlete's own videos are their lifts
  IF v_msg.sender_id IS DISTINCT FROM v_client.user_id THEN
    RAISE EXCEPTION 'Only a video the athlete sent can be read as their lift.' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_client.user_id = v_uid
          OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))
          OR v_msg.client_id IN (SELECT public.coached_client_ids())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT a INTO v_att
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_msg.attachments) = 'array' THEN v_msg.attachments ELSE '[]'::jsonb END) a
   WHERE a ->> 'storage_path' = _storage_path AND a ->> 'type' = 'video'
   LIMIT 1;
  IF v_att IS NULL OR _storage_path NOT LIKE v_client.id::text || '/%' THEN
    RAISE EXCEPTION 'That video isn''t in this message.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prev FROM public.pl_set_videos WHERE storage_path = _storage_path;
  IF FOUND AND v_prev.deleted_at IS NULL THEN
    RETURN jsonb_build_object('id', v_prev.id, 'existed', true, 'linked', v_prev.row_id IS NOT NULL AND v_prev.set_index IS NOT NULL);
  END IF;

  -- the set, when one is named: one of this athlete's workouts
  IF _row_id IS NOT NULL THEN
    IF _set_index IS NULL OR _set_index NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'That set isn''t in this workout.' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(nullif(btrim(r.exercise_name_override), ''), e.name, 'Exercise'), r.day_id, d.title
      INTO v_ex, v_day, v_title
      FROM public.pl_exercise_rows r
      JOIN public.pl_days d   ON d.id = r.day_id
      JOIN public.pl_weeks w  ON w.id = d.week_id
      JOIN public.pl_blocks b ON b.id = w.block_id
      LEFT JOIN public.exercises e ON e.id = r.exercise_id
     WHERE r.id = _row_id AND b.client_id = v_client.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That set isn''t in this workout.' USING ERRCODE = '22023';
    END IF;
    SELECT x.id INTO v_result
      FROM public.pl_row_results x
     WHERE x.row_id = _row_id AND x.set_index = _set_index AND x.client_id = v_client.id
     ORDER BY x.updated_at DESC
     LIMIT 1;
    SELECT n.set_name INTO v_name FROM public.pl_day_set_names(v_day) n
     WHERE n.row_id = _row_id AND n.set_index = _set_index;
    v_name := coalesce(v_name, 'Set ' || _set_index);
    IF v_result IS NULL THEN v_label := ''; END IF;
  ELSIF _day_id IS NOT NULL THEN
    SELECT d.id, d.title INTO v_day, v_title
      FROM public.pl_days d
      JOIN public.pl_weeks w  ON w.id = d.week_id
      JOIN public.pl_blocks b ON b.id = w.block_id
     WHERE d.id = _day_id AND b.client_id = v_client.id;
    v_label := '';
  END IF;
  -- a guess is only ever a set of that same workout
  IF _suggest IS NOT NULL AND v_day IS NOT NULL AND _row_id IS NULL
     AND (_suggest ->> 'set')::text ~ '^[0-9]+$'
     AND EXISTS (SELECT 1 FROM public.pl_exercise_rows r WHERE r.id::text = _suggest ->> 'row_id' AND r.day_id = v_day) THEN
    v_sug := jsonb_build_object(
      'row_id', _suggest ->> 'row_id',
      'set', least(50, greatest(1, (_suggest ->> 'set')::int)),
      'exercise', left(coalesce(_suggest ->> 'exercise', ''), 80),
      'set_name', left(coalesce(_suggest ->> 'set_name', ''), 40));
  END IF;

  IF v_prev.id IS NOT NULL THEN
    -- taken off as "not a lift" before: the same row, read again
    UPDATE public.pl_set_videos
       SET deleted_at = NULL, row_id = _row_id, day_id = v_day, result_id = v_result, warmup_id = NULL,
           set_index = CASE WHEN _row_id IS NULL THEN NULL ELSE _set_index END,
           exercise_name = v_ex, workout_title = v_title, label = v_label
     WHERE id = v_prev.id
    RETURNING id INTO v_id;
  ELSE
    BEGIN
      INSERT INTO public.pl_set_videos
        (client_id, uploaded_by, row_id, day_id, result_id, set_index, exercise_name, workout_title, label,
         storage_path, thumbnail_path, duration_s, width, height, size_bytes, mime, transfer,
         file_key, client_key, message_id, origin)
      VALUES
        (v_client.id, v_client.user_id, _row_id, v_day, v_result,
         CASE WHEN _row_id IS NULL THEN NULL ELSE _set_index END,
         v_ex, v_title, v_label,
         _storage_path, v_att ->> 'thumbnail_storage_path',
         CASE WHEN (v_att ->> 'duration') ~ '^[0-9]+(\.[0-9]+)?$' THEN round((v_att ->> 'duration')::numeric, 3) END,
         CASE WHEN (v_att ->> 'width') ~ '^[0-9]+$' THEN (v_att ->> 'width')::int END,
         CASE WHEN (v_att ->> 'height') ~ '^[0-9]+$' THEN (v_att ->> 'height')::int END,
         CASE WHEN (v_att ->> 'size') ~ '^[0-9]+$' THEN (v_att ->> 'size')::bigint END,
         left(v_att ->> 'mime', 60),
         CASE WHEN jsonb_typeof(v_att -> 'transfer') = 'object' THEN v_att -> 'transfer' END,
         'chat:' || md5(_storage_path), 'chat:' || _message_id::text || ':' || md5(_storage_path),
         _message_id, 'chat')
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_prev FROM public.pl_set_videos WHERE storage_path = _storage_path;
      RETURN jsonb_build_object('id', v_prev.id, 'existed', true, 'linked', v_prev.row_id IS NOT NULL AND v_prev.set_index IS NOT NULL);
    END;
  END IF;

  PERFORM public._chat_lift_set_attachment(_message_id, _storage_path, jsonb_build_object(
    'id', v_id, 'origin', 'chat', 'linked', _row_id IS NOT NULL, 'how', v_how,
    'exercise', v_ex, 'set', CASE WHEN _row_id IS NULL THEN NULL ELSE _set_index END,
    'set_name', v_name, 'label', nullif(v_label, ''), 'workout', v_title,
    'day_id', v_day, 'row_id', _row_id, 'suggest', v_sug));
  RETURN jsonb_build_object('id', v_id, 'existed', false, 'linked', _row_id IS NOT NULL);
END
$$;
REVOKE ALL ON FUNCTION public.chat_video_lift(uuid, text, uuid, integer, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_video_lift(uuid, text, uuid, integer, uuid, text, text, jsonb) TO authenticated, service_role;

/** "Not a lift": the read comes off, the video stays in the chat as it was. */
CREATE OR REPLACE FUNCTION public.chat_video_unlift(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v     public.pl_set_videos;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF v.origin <> 'chat' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT (v.uploaded_by = v_uid
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v.client_id AND c.user_id = v_uid)
          OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))
          OR v.client_id IN (SELECT public.coached_client_ids())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  -- the analysis goes with it (set_video_analysis_follows_move) and so does any velocity it logged
  UPDATE public.pl_set_videos SET deleted_at = now() WHERE id = v.id;
  IF v.message_id IS NOT NULL THEN
    PERFORM public._chat_lift_set_attachment(v.message_id, v.storage_path, NULL);
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.chat_video_unlift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_video_unlift(uuid) TO authenticated, service_role;

-- Taking a chat video off its set leaves the message alone (a set video's
-- message is the app's own and goes with it, as before).
CREATE OR REPLACE FUNCTION public.set_video_remove(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v     public.pl_set_videos;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF NOT (v.uploaded_by = v_uid
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v.client_id AND c.user_id = v_uid)
          OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))
          OR (v.origin = 'chat' AND v.client_id IN (SELECT public.coached_client_ids()))) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v.origin = 'chat' THEN
    -- off the set, still read, still in the chat
    UPDATE public.pl_set_videos
       SET row_id = NULL, result_id = NULL, warmup_id = NULL, set_index = NULL, label = ''
     WHERE id = v.id;
    IF v.message_id IS NOT NULL THEN
      PERFORM public._chat_lift_set_attachment(v.message_id, v.storage_path, jsonb_build_object(
        'id', v.id, 'origin', 'chat', 'linked', false, 'how', 'athlete',
        'workout', v.workout_title, 'day_id', v.day_id));
    END IF;
    RETURN;
  END IF;
  UPDATE public.pl_set_videos SET deleted_at = now() WHERE id = _id;
  IF v.message_id IS NOT NULL THEN
    UPDATE public.messages
       SET deleted_at = now(), body = '', attachments = '[]'::jsonb
     WHERE id = v.message_id AND deleted_at IS NULL;
  END IF;
END
$function$;

-- Moving a video between sets of its workout (and a chat video onto its first
-- set): a chat video's message keeps the client's own words.
CREATE OR REPLACE FUNCTION public.set_video_move(_id uuid, _row_id uuid, _set_index integer, _label text DEFAULT NULL::text, _label_no_load text DEFAULT NULL::text, _warmup_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v        public.pl_set_videos;
  v_owner  uuid;
  v_ex     text;
  v_result uuid;
  v_label  text := left(btrim(coalesce(_label, '')), 120);
  v_nl     text := left(btrim(coalesce(_label_no_load, '')), 120);
  v_claims text;
  v_sub    text;
  v_name   text;
  v_main   boolean;
  v_kg     numeric;
  v_warmup uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That video isn''t on a set any more.' USING ERRCODE = '22023';
  END IF;
  SELECT c.user_id INTO v_owner FROM public.clients c WHERE c.id = v.client_id;
  IF NOT (v.uploaded_by = v_uid
          OR v_owner = v_uid
          OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))
          OR v.client_id IN (SELECT public.coached_client_ids())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v.day_id IS NULL THEN
    RAISE EXCEPTION 'That video isn''t from a workout.' USING ERRCODE = '22023';
  END IF;
  -- 0 is the exercise's warm-up (a logged one by its pl_warmup_sets id, else the warm-up still to log)
  IF _set_index IS NULL OR _set_index NOT BETWEEN 0 AND 50 OR (v.origin = 'chat' AND _set_index = 0) THEN
    RAISE EXCEPTION 'That set isn''t in this workout.' USING ERRCODE = '22023';
  END IF;

  -- the set it goes to: one of this workout's exercises
  SELECT coalesce(nullif(btrim(r.exercise_name_override), ''), e.name, 'Exercise')
    INTO v_ex
    FROM public.pl_exercise_rows r
    LEFT JOIN public.exercises e ON e.id = r.exercise_id
   WHERE r.id = _row_id AND r.day_id = v.day_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That set isn''t in this workout.' USING ERRCODE = '22023';
  END IF;
  IF _set_index = 0 THEN
    IF _warmup_id IS NOT NULL THEN
      SELECT w.id INTO v_warmup
        FROM public.pl_warmup_sets w
       WHERE w.id = _warmup_id AND w.row_id = _row_id AND w.client_id = v.client_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That warm-up isn''t in this workout any more.' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v.row_id = _row_id AND v.set_index = 0 AND v.warmup_id IS NOT DISTINCT FROM v_warmup THEN
      RETURN jsonb_build_object('id', v.id, 'moved', false);
    END IF;
    v_result := NULL;
    v_name := 'Warm-up';
    v_main := false;
    v_nl := '';
    IF v_warmup IS NULL THEN v_label := ''; END IF;
  ELSE
    IF v.row_id = _row_id AND v.set_index = _set_index THEN
      RETURN jsonb_build_object('id', v.id, 'moved', false);
    END IF;
    SELECT x.id INTO v_result
      FROM public.pl_row_results x
     WHERE x.row_id = _row_id AND x.set_index = _set_index AND x.client_id = v.client_id
     ORDER BY x.updated_at DESC
     LIMIT 1;
    IF v_result IS NULL THEN v_label := ''; v_nl := ''; END IF;
    SELECT n.set_name, n.main INTO v_name, v_main
      FROM public.pl_day_set_names(v.day_id) n
     WHERE n.row_id = _row_id AND n.set_index = _set_index;
    v_name := coalesce(v_name, 'Set ' || _set_index);
    SELECT x.normalized_kg INTO v_kg FROM public.pl_row_results x WHERE x.id = v_result;
  END IF;

  UPDATE public.pl_set_videos
     SET row_id = _row_id, result_id = v_result, warmup_id = v_warmup, set_index = _set_index,
         exercise_name = v_ex, label = v_label
   WHERE id = v.id;

  IF v.origin = 'chat' THEN
    IF v.message_id IS NOT NULL THEN
      PERFORM public._chat_lift_set_attachment(v.message_id, v.storage_path, jsonb_build_object(
        'id', v.id, 'origin', 'chat', 'linked', true,
        'how', CASE WHEN v.client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = v_uid) THEN 'athlete' ELSE 'coach' END,
        'exercise', v_ex, 'set', _set_index, 'set_name', v_name, 'label', nullif(v_label, ''),
        'workout', v.workout_title, 'day_id', v.day_id, 'row_id', _row_id));
    END IF;
    RETURN jsonb_build_object(
      'id', v.id, 'moved', true, 'exercise', v_ex, 'set_index', _set_index, 'set_name', v_name, 'result_id', v_result,
      'warmup_id', NULL,
      'from', jsonb_build_object('row_id', v.row_id, 'set_index', v.set_index, 'label', v.label, 'warmup_id', NULL));
  END IF;

  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF v.message_id IS NOT NULL THEN
    UPDATE public.messages m
       SET body = left(v_ex || ' · ' || v_name || coalesce(' · ' || nullif(v_label, ''), ''), 200),
           attachments = (
             SELECT jsonb_agg(
                      CASE WHEN a -> 'set_video' ->> 'id' = v.id::text
                           THEN jsonb_set(jsonb_set(a, '{set_video}', jsonb_strip_nulls(
                                  (a -> 'set_video') - 'label' - 'warmup'
                                  || jsonb_build_object('exercise', v_ex, 'set', _set_index, 'set_name', v_name,
                                                        'label', nullif(v_label, ''), 'row_id', _row_id,
                                                        'warmup', CASE WHEN _set_index = 0 THEN true END))),
                                '{name}', to_jsonb(v_name || ' video'))
                           ELSE a END
                      ORDER BY t.ord)
               FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS t(a, ord))
     WHERE m.id = v.message_id
       AND m.deleted_at IS NULL
       AND jsonb_typeof(m.attachments) = 'array';
  END IF;

  WITH moved AS (
    SELECT p.id, p.caption, coalesce(p.hide_loads, false) AS hide, p.film AS old_film,
           (SELECT jsonb_agg(
                     CASE WHEN f ->> 'path' LIKE '%/' || v.id::text || '%'
                          THEN f || jsonb_build_object('exercise', v_ex, 'set', _set_index, 'set_name', v_name,
                                                       'main', coalesce(v_main, false), 'kg', v_kg,
                                                       'label', v_label, 'label_no_load', v_nl)
                          ELSE f END
                     ORDER BY t.ord)
              FROM jsonb_array_elements(p.film) WITH ORDINALITY AS t(f, ord)
             WHERE _set_index > 0 OR NOT (f ->> 'path' LIKE '%/' || v.id::text || '%')) AS new_film
      FROM public.community_posts p
     WHERE p.client_id = v.client_id
       AND jsonb_typeof(p.film) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.film) f WHERE f ->> 'path' LIKE '%/' || v.id::text || '%')
  )
  UPDATE public.community_posts p
     SET film = m.new_film,
         caption = CASE WHEN m.caption IS NOT DISTINCT FROM public.film_caption(m.old_film, m.hide)
                        THEN public.film_caption(m.new_film, m.hide)
                        ELSE m.caption END
    FROM moved m
   WHERE p.id = m.id
     AND m.new_film IS NOT NULL;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  RETURN jsonb_build_object(
    'id', v.id, 'moved', true, 'exercise', v_ex, 'set_index', _set_index, 'set_name', v_name, 'result_id', v_result,
    'warmup_id', v_warmup,
    'from', jsonb_build_object('row_id', v.row_id, 'set_index', v.set_index, 'label', v.label, 'warmup_id', v.warmup_id));
END
$function$;

NOTIFY pgrst, 'reload schema';
