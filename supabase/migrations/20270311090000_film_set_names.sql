-- Set videos and workout film: every set says what it is, with no emoji.
--
-- Nov 13 2026: on Jared's Thursday film the paused bench read "Set 1 · 255 lb"
-- and then "Set 1 · 245 lb": his top set and his first backoff are two rows of
-- the same exercise ("Primary Bench", "Primary Bench Backoff"), each counting
-- its sets from 1, so the film and the coach chat never said which was the
-- top set. The captions also carried a 🎥 and the post's own caption repeated
-- the workout's name ("Thursday — Secondary Squat + Primary Bench · 9 sets on
-- film 🎥"), which the post's screen already shows.
--
-- 1. pl_day_set_names(day): every set of a workout by its name in it:
--    "Top set" / "Top set 2", "Backoff" / "Backoff 3", else "Set N". A row is a
--    backoff when the coach called it one (its purpose label, or notes that
--    start "Backoff"), a top set when called one or when it comes before a
--    backoff of the same exercise; with nothing said, a 1-set row followed by
--    one more row of the same exercise is a top set and its backoffs, unless
--    what was logged says the second was heavier (production: 1-set rows
--    followed by more sets of the same lift were heavier first 90%+ of the
--    time). Numbers run across the rows of one exercise, in workout order,
--    so the same exercise split over two rows never says "Set 1" twice.
--    `main` says the row is one of the workout's main lifts (a primary /
--    secondary / tertiary… label, or a competition lift or variation).
-- 2. film_caption(film, hide): a film post's own caption, from its slides:
--    the best set (heaviest) of each main lift filmed, at most three, else of
--    the first two exercises: "High Bar Squat 365 lb × 6 · 1ct Paused Bench
--    255 lb × 4" (names only on a post that hides weights).
-- 3. set_video_attach / set_video_move write "High Bar Squat · Top set · 335
--    lb × 6 @ RPE 5" (no emoji) and keep the set's name on the attachment and
--    the film's slide; a move keeps the post's caption in step while it's
--    still the film's own.
-- 4. Hiding or showing weights on a film post swaps the caption the film wrote
--    for the matching one (a caption they wrote themselves stays theirs).
-- 5. The film posts and set video messages already out get the same: each
--    slide its set name, the film's own caption the new one, each message's
--    words without the 🎥 (a relabel the system wrote, so no "edited" copy).

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'set_video_attach' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM 'dc6d7741562bdfd265b62e3852e87e71' THEN
    RAISE EXCEPTION 'set_video_attach changed since this migration was written';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'set_video_move' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '8ea93a134e72cc4edeae569b8c038ff5' THEN
    RAISE EXCEPTION 'set_video_move changed since this migration was written';
  END IF;
END $$;

-- 1. Every set of a workout by its name in it.
CREATE OR REPLACE FUNCTION public.pl_day_set_names(_day uuid)
RETURNS TABLE (row_id uuid, set_index integer, set_name text, main boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH r AS (
    SELECT r.id, r.sort_order,
           coalesce(r.exercise_id::text, nullif(lower(btrim(r.exercise_name_override)), ''), r.id::text) AS ex_key,
           greatest(coalesce(r.sets, 0), coalesce((SELECT max(x.set_index) FROM public.pl_row_results x WHERE x.row_id = r.id), 0), 1) AS n_sets,
           coalesce(r.sets, 0) AS planned,
           (SELECT max(x.normalized_kg) FROM public.pl_row_results x WHERE x.row_id = r.id) AS top_kg,
           CASE
             WHEN coalesce(r.purpose_label, '') ~* 'back\s*-?\s*off' OR coalesce(r.notes, '') ~* '^\s*back\s*-?\s*offs?\M' THEN 'backoff'
             WHEN coalesce(r.purpose_label, '') ~* '\mtop\s*sets?\M' OR coalesce(r.notes, '') ~* '^\s*top\s*sets?\M' THEN 'top'
           END AS said,
           (coalesce(r.purpose_label, '') ~* '\m(primary|secondary|tertiary|quaternary|competition|limiter|main)\M'
             OR (nullif(btrim(r.purpose_label), '') IS NULL
                 AND (coalesce(e.is_competition_lift, false)
                      OR e.competition_lift_type IS NOT NULL
                      OR e.exercise_category IN ('competition', 'variation')))) AS main
      FROM public.pl_exercise_rows r
      LEFT JOIN public.exercises e ON e.id = r.exercise_id
     WHERE r.day_id = _day
  ), g AS (
    SELECT r.*,
           row_number() OVER (PARTITION BY r.ex_key ORDER BY r.sort_order, r.id) AS pos,
           count(*) OVER (PARTITION BY r.ex_key) AS rows_in,
           count(r.said) OVER (PARTITION BY r.ex_key) AS said_in,
           min(r.sort_order) FILTER (WHERE r.said = 'backoff') OVER (PARTITION BY r.ex_key) AS first_backoff
      FROM r
  ), g2 AS (
    SELECT g.*,
           max(g.top_kg) FILTER (WHERE g.pos = 1) OVER (PARTITION BY g.ex_key) AS kg1,
           max(g.top_kg) FILTER (WHERE g.pos = 2) OVER (PARTITION BY g.ex_key) AS kg2,
           max(g.planned) FILTER (WHERE g.pos = 1) OVER (PARTITION BY g.ex_key) AS planned1
      FROM g
  ), roled AS (
    SELECT g2.*,
           CASE
             WHEN g2.said IS NOT NULL THEN g2.said
             WHEN g2.first_backoff IS NOT NULL AND g2.sort_order < g2.first_backoff THEN 'top'
             WHEN g2.said_in = 0 AND g2.rows_in = 2 AND g2.planned1 = 1
                  AND NOT (g2.kg1 IS NOT NULL AND g2.kg2 IS NOT NULL AND g2.kg2 > g2.kg1)
               THEN CASE WHEN g2.pos = 1 THEN 'top' ELSE 'backoff' END
           END AS role
      FROM g2
  ), sets AS (
    SELECT roled.id AS row_id, s.n AS set_index, roled.role, roled.main, roled.ex_key, roled.sort_order
      FROM roled
      CROSS JOIN LATERAL generate_series(1, roled.n_sets) AS s(n)
  ), numbered AS (
    SELECT sets.*,
           row_number() OVER (PARTITION BY sets.ex_key, sets.role ORDER BY sets.sort_order, sets.set_index) AS k,
           count(*) OVER (PARTITION BY sets.ex_key, sets.role) AS of_k
      FROM sets
  )
  SELECT n.row_id,
         n.set_index::integer,
         CASE n.role
           WHEN 'top' THEN CASE WHEN n.of_k = 1 THEN 'Top set' ELSE 'Top set ' || n.k END
           WHEN 'backoff' THEN CASE WHEN n.of_k = 1 THEN 'Backoff' ELSE 'Backoff ' || n.k END
           -- plain sets count on across the rows of one exercise, never "Set 1" twice
           ELSE 'Set ' || n.k
         END,
         coalesce(n.main, false)
    FROM numbered n
$$;
REVOKE ALL ON FUNCTION public.pl_day_set_names(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pl_day_set_names(uuid) TO service_role;

-- One set's name (the chat message's words).
CREATE OR REPLACE FUNCTION public.pl_set_name(_row_id uuid, _set_index integer)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT n.set_name
       FROM public.pl_day_set_names((SELECT r.day_id FROM public.pl_exercise_rows r WHERE r.id = _row_id)) n
      WHERE n.row_id = _row_id AND n.set_index = _set_index),
    'Set ' || _set_index)
$$;
REVOKE ALL ON FUNCTION public.pl_set_name(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pl_set_name(uuid, integer) TO service_role;

-- 2. A film post's own caption, from its slides.
CREATE OR REPLACE FUNCTION public.film_caption(_film jsonb, _hide boolean DEFAULT false)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH s AS (
    SELECT t.ord,
           btrim(t.f ->> 'exercise') AS ex,
           coalesce((t.f ->> 'main')::boolean, false) AS main,
           CASE WHEN (t.f ->> 'kg') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (t.f ->> 'kg')::numeric END AS kg,
           btrim(regexp_replace(coalesce(t.f ->> 'label', ''), '\s*@.*$', '')) AS work
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_film) = 'array' THEN _film ELSE '[]'::jsonb END)
           WITH ORDINALITY AS t(f, ord)
     WHERE coalesce(btrim(t.f ->> 'exercise'), '') NOT IN ('', 'Set')
  ), ex AS (
    SELECT s.ex, min(s.ord) AS first_ord, bool_or(s.main) AS main FROM s GROUP BY s.ex
  ), pick AS (
    SELECT ex.ex, ex.first_ord,
           row_number() OVER (ORDER BY ex.first_ord) AS rn
      FROM ex
     WHERE ex.main OR NOT EXISTS (SELECT 1 FROM ex e2 WHERE e2.main)
  ), best AS (
    SELECT DISTINCT ON (s.ex) s.ex, s.work
      FROM s
     ORDER BY s.ex, s.kg DESC NULLS LAST, s.ord
  )
  SELECT coalesce(string_agg(
           CASE WHEN coalesce(_hide, false) OR b.work = '' THEN p.ex ELSE p.ex || ' ' || b.work END,
           ' · ' ORDER BY p.first_ord), '')
    FROM pick p
    JOIN best b ON b.ex = p.ex
   WHERE p.rn <= CASE WHEN EXISTS (SELECT 1 FROM ex WHERE ex.main) THEN 3 ELSE 2 END
$$;

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

  -- the set by its name in the workout ("Top set", "Backoff 2", "Set 3"), no emoji
  v_name := public.pl_set_name(_row_id, _set_index);
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

CREATE OR REPLACE FUNCTION public.set_video_move(
  _id uuid,
  _row_id uuid,
  _set_index integer,
  _label text DEFAULT NULL,
  _label_no_load text DEFAULT NULL
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
  IF _set_index IS NULL OR _set_index NOT BETWEEN 1 AND 50 THEN
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

  UPDATE public.pl_set_videos
     SET row_id = _row_id, result_id = v_result, set_index = _set_index,
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
                                  (a -> 'set_video') - 'label'
                                  || jsonb_build_object('exercise', v_ex, 'set', _set_index, 'set_name', v_name,
                                                        'label', nullif(v_label, ''), 'row_id', _row_id))),
                                '{name}', to_jsonb(v_name || ' video'))
                           ELSE a END
                      ORDER BY t.ord)
               FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS t(a, ord))
     WHERE m.id = v.message_id
       AND m.deleted_at IS NULL
       AND jsonb_typeof(m.attachments) = 'array';
  END IF;

  -- its caption on the workout's film, when that's in Crew (and the post's
  -- own caption with it, while it's still the one the film wrote)
  WITH moved AS (
    SELECT p.id, p.caption, coalesce(p.hide_loads, false) AS hide, p.film AS old_film,
           (SELECT jsonb_agg(
                     CASE WHEN f ->> 'path' LIKE '%/' || v.id::text || '%'
                          THEN f || jsonb_build_object('exercise', v_ex, 'set', _set_index, 'set_name', v_name,
                                                       'main', coalesce(v_main, false), 'kg', v_kg,
                                                       'label', v_label, 'label_no_load', v_nl)
                          ELSE f END
                     ORDER BY t.ord)
              FROM jsonb_array_elements(p.film) WITH ORDINALITY AS t(f, ord)) AS new_film
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
   WHERE p.id = m.id;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  RETURN jsonb_build_object(
    'id', v.id, 'moved', true, 'exercise', v_ex, 'set_index', _set_index, 'set_name', v_name, 'result_id', v_result,
    'from', jsonb_build_object('row_id', v.row_id, 'set_index', v.set_index, 'label', v.label));
END
$$;
REVOKE ALL ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text) TO authenticated, service_role;

-- 4. Hiding or showing weights swaps the film's own caption for the matching one.
CREATE OR REPLACE FUNCTION public.community_posts_film_caption_weights()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_was text;
BEGIN
  IF NEW.hide_loads IS DISTINCT FROM OLD.hide_loads AND jsonb_typeof(NEW.film) = 'array' THEN
    v_was := public.film_caption(OLD.film, coalesce(OLD.hide_loads, false));
    IF v_was <> '' AND coalesce(NEW.caption, '') = v_was THEN
      NEW.caption := public.film_caption(NEW.film, coalesce(NEW.hide_loads, false));
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.community_posts_film_caption_weights() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_posts_film_caption_weights ON public.community_posts;
CREATE TRIGGER community_posts_film_caption_weights
  BEFORE UPDATE OF hide_loads ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.community_posts_film_caption_weights();

-- 5a. The film posts already out: each slide its set's name, main lift and
-- weight (and, for a clip moved by hand before Move existed, the exercise and
-- set it's on now), and the film's own caption the new one.
WITH s AS (
  SELECT p.id AS post_id, t.ord, t.f,
         (regexp_match(t.f ->> 'path', '/film/[^/]+/([0-9a-f-]{36})'))[1]::uuid AS vid
    FROM public.community_posts p
    CROSS JOIN LATERAL jsonb_array_elements(p.film) WITH ORDINALITY AS t(f, ord)
   WHERE jsonb_typeof(p.film) = 'array'
), named AS (
  SELECT s.post_id, s.ord,
         s.f
         || CASE WHEN v.id IS NOT NULL AND v.deleted_at IS NULL AND nullif(btrim(v.label), '') IS NOT NULL
                      AND (coalesce(v.exercise_name, '') <> coalesce(s.f ->> 'exercise', '')
                           OR v.set_index::text <> coalesce(s.f ->> 'set', ''))
                 THEN jsonb_strip_nulls(jsonb_build_object(
                        'exercise', nullif(btrim(v.exercise_name), ''),
                        'set', v.set_index,
                        'label', btrim(v.label),
                        'label_no_load',
                          CASE WHEN btrim(v.label) ~ '×\s*1(\s|$)' THEN regexp_replace(btrim(v.label), '^[^×]*×\s*1', '1 rep')
                               WHEN btrim(v.label) ~ '×\s*[0-9]+' THEN regexp_replace(btrim(v.label), '^[^×]*×\s*([0-9]+)', '\1 reps')
                          END))
                 ELSE '{}'::jsonb END
         || jsonb_strip_nulls(jsonb_build_object('set_name', n.set_name, 'main', n.main, 'kg', x.normalized_kg)) AS f
    FROM s
    LEFT JOIN public.pl_set_videos v ON v.id = s.vid
    LEFT JOIN LATERAL (
      SELECT d.set_name, d.main FROM public.pl_day_set_names(v.day_id) d
       WHERE d.row_id = v.row_id AND d.set_index = v.set_index
    ) n ON true
    LEFT JOIN public.pl_row_results x ON x.id = v.result_id
), agg AS (
  SELECT named.post_id, jsonb_agg(named.f ORDER BY named.ord) AS film FROM named GROUP BY named.post_id
)
UPDATE public.community_posts p
   SET film = agg.film,
       caption = CASE WHEN coalesce(p.caption, '') = '' OR p.caption ~ '^(?:(.*) · )?[0-9]+ sets? on film 🎥$'
                      THEN public.film_caption(agg.film, coalesce(p.hide_loads, false))
                      ELSE p.caption END
  FROM agg
 WHERE p.id = agg.post_id;

-- 5b. The set video messages already sent: their words without the 🎥, the
-- set by its name (a relabel the system wrote: no "edited" copy is kept).
ALTER TABLE public.messages DISABLE TRIGGER messages_keep_history;
WITH m AS (
  SELECT msg.id, v.id AS vid,
         coalesce(n.set_name, 'Set ' || v.set_index) AS set_name,
         left(coalesce(nullif(btrim(v.exercise_name), ''), 'Exercise') || ' · ' || coalesce(n.set_name, 'Set ' || v.set_index)
              || coalesce(' · ' || nullif(btrim(v.label), ''), ''), 200) AS body
    FROM public.messages msg
    JOIN public.pl_set_videos v ON v.message_id = msg.id
    LEFT JOIN LATERAL (
      SELECT d.set_name FROM public.pl_day_set_names(v.day_id) d
       WHERE d.row_id = v.row_id AND d.set_index = v.set_index
    ) n ON true
   WHERE msg.message_type = 'Set Video'
     AND msg.deleted_at IS NULL
     AND jsonb_typeof(msg.attachments) = 'array'
)
UPDATE public.messages msg
   SET body = m.body,
       attachments = (
         SELECT jsonb_agg(
                  CASE WHEN a -> 'set_video' ->> 'id' = m.vid::text
                       THEN jsonb_set(jsonb_set(a, '{set_video,set_name}', to_jsonb(m.set_name)),
                                      '{name}', to_jsonb(m.set_name || ' video'))
                       ELSE a END
                  ORDER BY t.ord)
           FROM jsonb_array_elements(msg.attachments) WITH ORDINALITY AS t(a, ord))
  FROM m
 WHERE msg.id = m.id;
ALTER TABLE public.messages ENABLE TRIGGER messages_keep_history;
