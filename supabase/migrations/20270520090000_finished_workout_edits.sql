-- A finished workout edited after Finish (Nov 23 2026): a set video on a set
-- whose numbers changed says the new numbers. Its coach-chat card (and, for a
-- set video, the message's words), and its caption on the workout's film in
-- Crew (and the post's own caption while it's still the one the film wrote),
-- are rewritten with the set's name in the workout as it is now (a heavier
-- back-off can make it the top set). The same reading and the same writes as
-- set_video_move, without moving anything; the labels are worked out by the
-- app from the set's own numbers (filmLabels(filmSetValues(...))).
--
-- Called by syncFinishedWorkout (workout-completion.functions.ts) through the
-- caller's own login: the athlete, the one who sent it, their coach or an
-- admin. Nothing changes and nothing is written when it already says this.
-- A video sent in the coach chat keeps the athlete's own words; only its card
-- changes. A warm-up's clip (set 0) is never relabelled here.

CREATE OR REPLACE FUNCTION public.set_video_relabel(_id uuid, _label text, _label_no_load text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v        public.pl_set_videos;
  v_owner  uuid;
  v_label  text := left(btrim(coalesce(_label, '')), 120);
  v_nl     text := left(btrim(coalesce(_label_no_load, '')), 120);
  v_name   text;
  v_main   boolean;
  v_kg     numeric;
  v_old_name text;
  v_film_stale boolean;
  v_claims text;
  v_sub    text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.pl_set_videos WHERE id = _id;
  IF NOT FOUND OR v.deleted_at IS NOT NULL OR v.result_id IS NULL OR coalesce(v.set_index, 0) < 1 OR v.day_id IS NULL THEN
    RETURN jsonb_build_object('id', _id, 'changed', false);
  END IF;
  SELECT c.user_id INTO v_owner FROM public.clients c WHERE c.id = v.client_id;
  IF NOT (v.uploaded_by = v_uid
          OR v_owner = v_uid
          OR (SELECT public.has_role(v_uid, 'admin'::public.app_role))
          OR v.client_id IN (SELECT public.coached_client_ids())) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT n.set_name, n.main INTO v_name, v_main
    FROM public.pl_day_set_names(v.day_id) n
   WHERE n.row_id = v.row_id AND n.set_index = v.set_index;
  v_name := coalesce(v_name, 'Set ' || v.set_index);
  SELECT x.normalized_kg INTO v_kg FROM public.pl_row_results x WHERE x.id = v.result_id;

  -- what the card says now
  SELECT a -> 'set_video' ->> 'set_name' INTO v_old_name
    FROM public.messages m, jsonb_array_elements(CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) a
   WHERE m.id = v.message_id AND a -> 'set_video' ->> 'id' = v.id::text
   LIMIT 1;
  SELECT EXISTS (
    SELECT 1
      FROM public.community_posts p, jsonb_array_elements(CASE WHEN jsonb_typeof(p.film) = 'array' THEN p.film ELSE '[]'::jsonb END) f
     WHERE p.client_id = v.client_id
       AND jsonb_typeof(p.film) = 'array'
       AND f ->> 'path' LIKE '%/' || v.id::text || '%'
       AND (coalesce(f ->> 'label', '') <> v_label
            OR coalesce(f ->> 'label_no_load', '') <> v_nl
            OR coalesce(f ->> 'set_name', '') <> v_name
            OR (f ->> 'kg')::numeric IS DISTINCT FROM v_kg)
  ) INTO v_film_stale;

  IF coalesce(v.label, '') = v_label
     AND (v.message_id IS NULL OR v_old_name IS NULL OR v_old_name = v_name)
     AND NOT v_film_stale THEN
    RETURN jsonb_build_object('id', v.id, 'changed', false);
  END IF;

  UPDATE public.pl_set_videos SET label = v_label WHERE id = v.id;

  -- the rest is written as the server (a client can't change an attachment on
  -- their own message, and a coach can't change the athlete's)
  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF v.message_id IS NOT NULL THEN
    UPDATE public.messages m
       SET body = CASE WHEN v.origin = 'chat' THEN m.body
                       ELSE left(coalesce(v.exercise_name, 'Exercise') || ' · ' || v_name || coalesce(' · ' || nullif(v_label, ''), ''), 200) END,
           attachments = (
             SELECT jsonb_agg(
                      CASE WHEN a -> 'set_video' ->> 'id' = v.id::text
                           THEN jsonb_set(a, '{set_video}', jsonb_strip_nulls(
                                  (a -> 'set_video') - 'label'
                                  || jsonb_build_object('set_name', v_name, 'label', nullif(v_label, ''))))
                           ELSE a END
                      ORDER BY t.ord)
               FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS t(a, ord))
     WHERE m.id = v.message_id
       AND m.deleted_at IS NULL
       AND jsonb_typeof(m.attachments) = 'array';
  END IF;

  WITH relabelled AS (
    SELECT p.id, p.caption, coalesce(p.hide_loads, false) AS hide, p.film AS old_film,
           (SELECT jsonb_agg(
                     CASE WHEN f ->> 'path' LIKE '%/' || v.id::text || '%'
                          THEN f || jsonb_build_object('set_name', v_name, 'main', coalesce(v_main, false), 'kg', v_kg,
                                                       'label', v_label, 'label_no_load', v_nl)
                          ELSE f END
                     ORDER BY t.ord)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.film) = 'array' THEN p.film ELSE '[]'::jsonb END) WITH ORDINALITY AS t(f, ord)) AS new_film
      FROM public.community_posts p
     WHERE p.client_id = v.client_id
       AND jsonb_typeof(p.film) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.film) = 'array' THEN p.film ELSE '[]'::jsonb END) f WHERE f ->> 'path' LIKE '%/' || v.id::text || '%')
  )
  UPDATE public.community_posts p
     SET film = r.new_film,
         caption = CASE WHEN r.caption IS NOT DISTINCT FROM public.film_caption(r.old_film, r.hide)
                        THEN public.film_caption(r.new_film, r.hide)
                        ELSE r.caption END
    FROM relabelled r
   WHERE p.id = r.id
     AND r.new_film IS NOT NULL;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  RETURN jsonb_build_object('id', v.id, 'changed', true, 'set_name', v_name, 'label', v_label);
END
$$;
REVOKE ALL ON FUNCTION public.set_video_relabel(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_relabel(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
