-- A warm-up can carry a video for the coach, like a working set.
--
-- Nov 16 2026: the coach wanted the last warm-up open on the card (no tap to
-- expand it) and filmable the same way working sets are. A warm-up lives in
-- pl_warmup_sets, not pl_row_results, so its clip is set_index 0 on its
-- exercise row:
--   * warmup_id is the warm-up it's on (pl_warmup_sets.id), the way result_id
--     is a working set's record; a clip filmed on the open warm-up row before
--     it was saved has none yet and is tied to it when the warm-up is saved
--     (pl_warmup_sets_link_set_videos), or by set_video_attach when it was
--     saved while the clip was uploading (both within 18 hours, like sets);
--   * set_video_attach takes the warm-up's id in _result_id when _set_index is
--     0 (no new signature, so every app version keeps calling the same
--     function), names it "Warm-up" in the coach chat and never ties it to a
--     working set's record;
--   * a clip moved onto a working set (set_video_move) stops being a warm-up's:
--     the BEFORE trigger clears warmup_id whenever set_index > 0.
-- Warm-up clips are never in the workout's film (the film reads clips on a
-- logged set's record, result_id) and never get a feed copy.

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'set_video_attach' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '33d279823e45d6891be6068762c529cc' THEN
    RAISE EXCEPTION 'set_video_attach changed since this migration was written';
  END IF;
END $$;

ALTER TABLE public.pl_set_videos
  ADD COLUMN IF NOT EXISTS warmup_id uuid REFERENCES public.pl_warmup_sets(id) ON DELETE SET NULL;

ALTER TABLE public.pl_set_videos DROP CONSTRAINT IF EXISTS pl_set_videos_set_index_check;
ALTER TABLE public.pl_set_videos
  ADD CONSTRAINT pl_set_videos_set_index_check CHECK (set_index BETWEEN 0 AND 50);
-- a warm-up's clip is never on a working set's record, and only a warm-up's clip has a warm-up
ALTER TABLE public.pl_set_videos DROP CONSTRAINT IF EXISTS pl_set_videos_warmup_shape;
ALTER TABLE public.pl_set_videos
  ADD CONSTRAINT pl_set_videos_warmup_shape CHECK (
    (set_index = 0 AND result_id IS NULL) OR (set_index > 0 AND warmup_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS pl_set_videos_warmup ON public.pl_set_videos (warmup_id) WHERE warmup_id IS NOT NULL;

-- Moved onto a working set: no longer a warm-up's clip.
CREATE OR REPLACE FUNCTION public.pl_set_videos_warmup_follows_set()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.set_index > 0 THEN NEW.warmup_id := NULL; END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.pl_set_videos_warmup_follows_set() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pl_set_videos_warmup_follows_set ON public.pl_set_videos;
CREATE TRIGGER pl_set_videos_warmup_follows_set
  BEFORE INSERT OR UPDATE OF set_index, warmup_id ON public.pl_set_videos
  FOR EACH ROW EXECUTE FUNCTION public.pl_set_videos_warmup_follows_set();

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
  v_warmup uuid;
  v_name   text;
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

  -- 0 is the exercise's warm-up (its pl_warmup_sets id rides in _result_id)
  IF _set_index IS NULL OR _set_index NOT BETWEEN 0 AND 50 THEN
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

  IF _set_index = 0 THEN
    v_result := NULL;
    IF _result_id IS NOT NULL THEN
      SELECT w.id INTO v_warmup FROM public.pl_warmup_sets w
       WHERE w.id = _result_id AND w.row_id = _row_id AND w.client_id = _client_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That warm-up isn''t in this workout any more.' USING ERRCODE = '22023';
      END IF;
    ELSE
      SELECT w.id INTO v_warmup
        FROM public.pl_warmup_sets w
       WHERE w.row_id = _row_id AND w.client_id = _client_id
         AND w.created_at > now() - interval '18 hours'
         AND NOT EXISTS (SELECT 1 FROM public.pl_set_videos x WHERE x.warmup_id = w.id AND x.deleted_at IS NULL)
       ORDER BY w.created_at DESC
       LIMIT 1;
    END IF;
  ELSE
    IF _result_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.pl_row_results x
          WHERE x.id = _result_id AND x.row_id = _row_id AND x.client_id = _client_id) THEN
      RAISE EXCEPTION 'That set isn''t in this workout any more.' USING ERRCODE = '22023';
    END IF;
    IF v_result IS NULL THEN
      SELECT x.id INTO v_result
        FROM public.pl_row_results x
       WHERE x.row_id = _row_id AND x.set_index = _set_index AND x.client_id = _client_id
         AND x.updated_at > now() - interval '18 hours'
       ORDER BY x.updated_at DESC
       LIMIT 1;
    END IF;
  END IF;

  IF _storage_path IS NULL OR _storage_path NOT LIKE _client_id::text || '/set-videos/%' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_thumb IS NOT NULL AND v_thumb NOT LIKE _client_id::text || '/set-videos/%' THEN v_thumb := NULL; END IF;
  PERFORM public.media_video_allowed('message-attachments', _storage_path, 600, 209715200);

  BEGIN
    INSERT INTO public.pl_set_videos
      (client_id, uploaded_by, row_id, day_id, result_id, warmup_id, set_index, exercise_name, workout_title, label,
       storage_path, thumbnail_path, duration_s, width, height, size_bytes, mime, transfer, file_key, client_key)
    VALUES
      (_client_id, v_uid, _row_id, v_day, v_result, v_warmup, _set_index, v_ex, v_title, v_label,
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

  v_name := CASE WHEN _set_index = 0 THEN 'Warm-up' ELSE public.pl_set_name(_row_id, _set_index) END;
  v_body := left(v_ex || ' · ' || v_name || coalesce(' · ' || nullif(v_label, ''), ''), 200);
  INSERT INTO public.messages
    (client_id, sender_id, sender_role, body, attachments, message_type, delivery_status, sent_at, read_by_client_at, read_by_admin_at)
  VALUES (
    _client_id, v_uid, v_role, v_body,
    jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'type', 'video', 'url', '',
      'storage_path', _storage_path,
      'thumbnail_storage_path', v_thumb,
      'name', v_name || ' video',
      'size', _size, 'mime', left(_mime, 60), 'duration', _duration,
      'width', _width, 'height', _height,
      'transfer', _transfer,
      'set_video', jsonb_strip_nulls(jsonb_build_object(
        'id', v_id, 'exercise', v_ex, 'set', _set_index, 'set_name', v_name, 'label', nullif(v_label, ''),
        'workout', v_title, 'day_id', v_day, 'row_id', _row_id,
        'warmup', CASE WHEN _set_index = 0 THEN true END))))),
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

-- Saving a warm-up ties to it the clip filmed on the open warm-up row before it
-- was saved (the oldest such clip from the last 18 hours: one per warm-up).
CREATE OR REPLACE FUNCTION public.pl_warmup_sets_link_set_videos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.pl_set_videos v
     SET warmup_id = NEW.id
   WHERE v.id = (
     SELECT x.id FROM public.pl_set_videos x
      WHERE x.row_id = NEW.row_id
        AND x.set_index = 0
        AND x.client_id = NEW.client_id
        AND x.warmup_id IS NULL
        AND x.deleted_at IS NULL
        AND x.created_at > now() - interval '18 hours'
      ORDER BY x.created_at
      LIMIT 1);
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.pl_warmup_sets_link_set_videos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pl_warmup_sets_link_set_videos ON public.pl_warmup_sets;
CREATE TRIGGER pl_warmup_sets_link_set_videos
  AFTER INSERT ON public.pl_warmup_sets
  FOR EACH ROW EXECUTE FUNCTION public.pl_warmup_sets_link_set_videos();
