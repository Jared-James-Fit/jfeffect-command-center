-- A set video can move onto a warm-up too (Nov 20 2026).
--
-- The coach filmed a set, put it on the wrong exercise, and found the move
-- picker offered only working sets: set_video_move refused set 0, the
-- exercise's warm-up. Now:
--   * _set_index 0 moves the clip onto a warm-up: a logged one by its
--     pl_warmup_sets id (_warmup_id, this athlete's, on that exercise), else the
--     warm-up still to log (tied to it when it's saved, as a clip filmed on the
--     open warm-up row is: pl_warmup_sets_link_set_videos);
--   * the clip is a warm-up's or a working set's, never both (warmup_id /
--     result_id), and its coach-chat message and card follow, named "Warm-up"
--     with the warm-up's numbers like set_video_attach's, `warmup: true`;
--   * a warm-up is never in the workout's film, so a clip moved onto one leaves
--     it (and the post's own film caption with it), unless it's the only clip
--     (the film is rebuilt the next time the workout's opened);
--   * the answer says the warm-up it went to, and where it came from, warm-up
--     included, so Undo puts it back exactly.
-- Same function, one more argument with a default: every app version keeps
-- calling it with five.

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
       WHERE proname = 'set_video_move' AND pronamespace = 'public'::regnamespace
         AND pg_get_function_identity_arguments(oid) = '_id uuid, _row_id uuid, _set_index integer, _label text, _label_no_load text')
       IS DISTINCT FROM '23fbf99cbe3a6ec5dea5cc96735decdd' THEN
    RAISE EXCEPTION 'set_video_move changed since this migration was written';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.set_video_move(uuid, uuid, integer, text, text);

CREATE OR REPLACE FUNCTION public.set_video_move(
  _id uuid,
  _row_id uuid,
  _set_index integer,
  _label text DEFAULT NULL,
  _label_no_load text DEFAULT NULL,
  _warmup_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  -- 0 is the exercise's warm-up (a logged one by its pl_warmup_sets id, else the warm-up still to log)
  IF _set_index IS NULL OR _set_index NOT BETWEEN 0 AND 50 THEN
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
    -- a warm-up: the logged one named (this athlete's, on this exercise), else the one still to log
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
    -- a warm-up still to log has no numbers yet
    IF v_warmup IS NULL THEN v_label := ''; END IF;
  ELSE
    IF v.row_id = _row_id AND v.set_index = _set_index THEN
      RETURN jsonb_build_object('id', v.id, 'moved', false);
    END IF;

    -- its record when the set is logged (else the clip waits on the set, like one filmed first)
    SELECT x.id INTO v_result
      FROM public.pl_row_results x
     WHERE x.row_id = _row_id AND x.set_index = _set_index AND x.client_id = v.client_id
     ORDER BY x.updated_at DESC
     LIMIT 1;
    IF v_result IS NULL THEN v_label := ''; v_nl := ''; END IF;
    -- the set by its name in the workout ("Top set", "Backoff 2", "Set 3")
    SELECT n.set_name, n.main INTO v_name, v_main
      FROM public.pl_day_set_names(v.day_id) n
     WHERE n.row_id = _row_id AND n.set_index = _set_index;
    v_name := coalesce(v_name, 'Set ' || _set_index);
    SELECT x.normalized_kg INTO v_kg FROM public.pl_row_results x WHERE x.id = v_result;
  END IF;

  -- on a working set it's that set's record; on a warm-up, that warm-up's (never both)
  UPDATE public.pl_set_videos
     SET row_id = _row_id, result_id = v_result, warmup_id = v_warmup, set_index = _set_index,
         exercise_name = v_ex, label = v_label
   WHERE id = v.id;

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

  -- its caption on the workout's film, when that's in Crew (and the post's
  -- own caption with it, while it's still the one the film wrote); a warm-up is
  -- never in the film, so a clip moved onto one leaves it (unless it's all the
  -- film has: the film is rebuilt the next time the workout's opened)
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
$$;
REVOKE ALL ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text, uuid) TO authenticated, service_role;
