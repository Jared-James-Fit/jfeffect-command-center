-- Set videos: a video of one logged set, for the coach.
--
-- A coaching client (or their coach, logging with them) films or picks a clip
-- on a set in the workout logger. It uploads straight to the coach chat's own
-- bucket (message-attachments, the client's folder: the chat's existing
-- access rules), the server checks it (media_video_checks), and then ONE call
-- (set_video_attach) records the set's video and posts it to the coach chat
-- as a normal video message, in the same transaction. So:
--   * the video is tied to the logged set itself (pl_row_results.id), which
--     keeps its id when an earlier set is removed and later sets move up;
--   * a retry (the answer lost on a bad connection, the app reopened) is the
--     same call with the same client_key: it returns the first row and message,
--     never a second message;
--   * the same clip picked again is recognised by its file_key and is never a
--     second upload or message while the first is still there;
--   * removing the video takes its chat message down too, and deleting the
--     message (unsend, an admin's delete) takes the video off the set.
-- The chat message is an ordinary video (type 'video', no special kind) with a
-- `set_video` object saying which set it is, so every existing chat path
-- (bubbles, the viewer, replies, previews, pushes) handles it as it is.

CREATE TABLE IF NOT EXISTS public.pl_set_videos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  uploaded_by     uuid NOT NULL,
  -- the exercise in the workout, and the logged set (kept when the program changes: footage is never lost)
  row_id          uuid REFERENCES public.pl_exercise_rows(id) ON DELETE SET NULL,
  day_id          uuid REFERENCES public.pl_days(id) ON DELETE SET NULL,
  result_id       uuid REFERENCES public.pl_row_results(id) ON DELETE SET NULL,
  -- the set as it was when the video went (what the coach's card says)
  set_index       int NOT NULL CHECK (set_index BETWEEN 1 AND 50),
  exercise_name   text,
  workout_title   text,
  label           text NOT NULL DEFAULT '',
  -- the file
  storage_path    text NOT NULL,
  thumbnail_path  text,
  duration_s      numeric(10,3),
  width           int,
  height          int,
  size_bytes      bigint,
  mime            text,
  -- what the phone did (compressed or sent as is, timings): for diagnosing real devices
  transfer        jsonb,
  file_key        text NOT NULL,
  client_key      text NOT NULL,
  message_id      uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS pl_set_videos_client_key ON public.pl_set_videos (client_key);
CREATE UNIQUE INDEX IF NOT EXISTS pl_set_videos_storage_path ON public.pl_set_videos (storage_path);
CREATE UNIQUE INDEX IF NOT EXISTS pl_set_videos_live_file ON public.pl_set_videos (client_id, file_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pl_set_videos_day ON public.pl_set_videos (day_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pl_set_videos_result ON public.pl_set_videos (result_id);
CREATE INDEX IF NOT EXISTS pl_set_videos_message ON public.pl_set_videos (message_id);

ALTER TABLE public.pl_set_videos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pl_set_videos FROM anon, authenticated;
GRANT SELECT ON public.pl_set_videos TO authenticated;
GRANT ALL ON public.pl_set_videos TO service_role;

-- Read: the athlete, their coach, admins (the same people who see the chat).
-- Writes only through the functions below.
DROP POLICY IF EXISTS "Set videos: own" ON public.pl_set_videos;
CREATE POLICY "Set videos: own" ON public.pl_set_videos
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Set videos: coach" ON public.pl_set_videos;
CREATE POLICY "Set videos: coach" ON public.pl_set_videos
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Set videos: admin" ON public.pl_set_videos;
CREATE POLICY "Set videos: admin" ON public.pl_set_videos
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

/**
 * Record a set's video and post it to the coach chat, once. Called after the
 * upload landed and the server checked it (verifyVideoUploadFn). Returns
 * {id, message_id, existed}: existed = this upload (client_key) or this clip
 * (file_key) was already recorded, and nothing new was made.
 */
CREATE OR REPLACE FUNCTION public.set_video_attach(
  _client_key     text,
  _client_id      uuid,
  _row_id         uuid,
  _result_id      uuid,
  _set_index      int,
  _label          text,
  _storage_path   text,
  _thumbnail_path text,
  _duration       numeric,
  _width          int,
  _height         int,
  _size           bigint,
  _mime           text,
  _file_key       text,
  _transfer       jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _client_key IS NULL OR length(_client_key) NOT BETWEEN 8 AND 80
     OR _file_key IS NULL OR length(_file_key) NOT BETWEEN 8 AND 80 THEN
    RAISE EXCEPTION 'That video couldn''t be sent. Try again.' USING ERRCODE = '22023';
  END IF;

  -- the same upload again (its answer was lost, or the app reopened): what was made the first time
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
    -- their coach, logging the session with them: the video comes from the coach
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  -- the same clip picked again while it's still on a set: one upload, one message
  SELECT * INTO v_prev FROM public.pl_set_videos
   WHERE client_id = _client_id AND file_key = _file_key AND deleted_at IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_prev.id, 'message_id', v_prev.message_id, 'existed', true,
                              'set_index', v_prev.set_index, 'exercise', v_prev.exercise_name);
  END IF;

  -- the set: an exercise in this client's own program, and (when logged) its set
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

  -- the file: this client's folder, and a video the server checked and that fits a coach chat
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
      (_client_id, v_uid, _row_id, v_day, _result_id, _set_index, v_ex, v_title, v_label,
       _storage_path, v_thumb, _duration, _width, _height, _size, left(_mime, 60), _transfer, _file_key, _client_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- two sends of the same video at once: the other one made it
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
$$;
REVOKE ALL ON FUNCTION public.set_video_attach(text, uuid, uuid, uuid, int, text, text, text, numeric, int, int, bigint, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_attach(text, uuid, uuid, uuid, int, text, text, text, numeric, int, int, bigint, text, text, jsonb) TO authenticated, service_role;

/**
 * Take a set's video off: the set and its chat message alike (the message
 * goes the way any "delete for everyone" does, so an admin still has the
 * copy in message_deletions). The uploader, the athlete and admins.
 */
CREATE OR REPLACE FUNCTION public.set_video_remove(_id uuid)
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
  IF NOT (v.uploaded_by = v_uid
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v.client_id AND c.user_id = v_uid)
          OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.pl_set_videos SET deleted_at = now() WHERE id = _id;
  IF v.message_id IS NOT NULL THEN
    UPDATE public.messages
       SET deleted_at = now(), body = '', attachments = '[]'::jsonb
     WHERE id = v.message_id AND deleted_at IS NULL;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.set_video_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_remove(uuid) TO authenticated, service_role;

-- A set video follows its chat message: unsent or deleted there, gone from the set too.
CREATE OR REPLACE FUNCTION public.tg_set_video_follow_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.pl_set_videos SET deleted_at = now() WHERE message_id = OLD.id AND deleted_at IS NULL;
    RETURN OLD;
  END IF;
  UPDATE public.pl_set_videos SET deleted_at = NEW.deleted_at WHERE message_id = NEW.id AND deleted_at IS NULL;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.tg_set_video_follow_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_video_follow_message_unsent ON public.messages;
CREATE TRIGGER set_video_follow_message_unsent
  AFTER UPDATE OF deleted_at ON public.messages
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.tg_set_video_follow_message();

-- BEFORE: the message_id foreign key clears itself after the delete, so the link is read first.
DROP TRIGGER IF EXISTS set_video_follow_message_deleted ON public.messages;
CREATE TRIGGER set_video_follow_message_deleted
  BEFORE DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_video_follow_message();

SELECT public.rls_evaluate_once('pl_set_videos');
