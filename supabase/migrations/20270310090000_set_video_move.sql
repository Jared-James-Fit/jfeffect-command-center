-- A set video can be moved to another set of the same workout.
--
-- Nov 12 2026: Fionna filmed her last set of belt squats and the clip went on
-- her hip thrust's set 3. The only fix was removing it and filming again. Now
-- the set's video sheet has Move to another set (the clip's ⋯), and this
-- moves it in one step: the clip onto the set (its record when the set is
-- logged), its chat message relabeled ("🎥 Belt Squat · Set 3 · 65 lb × 12 @
-- RPE 8", the attachment's set details with it), and its caption on the
-- workout's film when that's already in Crew. The label is the phone's,
-- worked out from the set's own numbers like set_video_attach's.
--
-- Who can: the person who sent it, the athlete, their coach and admins (the
-- same as taking it off). The message is relabeled as the server (the login's
-- claims cleared and put back, like mark_client_signed_in): a client can't
-- change an attachment on their own message, and here only its set details
-- change. The old wording stays in the admins' edit history.

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
       SET body = left('🎥 ' || v_ex || ' · Set ' || _set_index || coalesce(' · ' || nullif(v_label, ''), ''), 200),
           attachments = (
             SELECT jsonb_agg(
                      CASE WHEN a -> 'set_video' ->> 'id' = v.id::text
                           THEN jsonb_set(a, '{set_video}', jsonb_strip_nulls(
                                  (a -> 'set_video') - 'label'
                                  || jsonb_build_object('exercise', v_ex, 'set', _set_index,
                                                        'label', nullif(v_label, ''), 'row_id', _row_id)))
                           ELSE a END
                      ORDER BY t.ord)
               FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS t(a, ord))
     WHERE m.id = v.message_id
       AND m.deleted_at IS NULL
       AND jsonb_typeof(m.attachments) = 'array';
  END IF;

  -- its caption on the workout's film, when that's in Crew
  UPDATE public.community_posts p
     SET film = (
       SELECT jsonb_agg(
                CASE WHEN f ->> 'path' LIKE '%/' || v.id::text || '%'
                     THEN f || jsonb_build_object('exercise', v_ex, 'set', _set_index,
                                                  'label', v_label, 'label_no_load', v_nl)
                     ELSE f END
                ORDER BY t.ord)
         FROM jsonb_array_elements(p.film) WITH ORDINALITY AS t(f, ord))
   WHERE p.client_id = v.client_id
     AND jsonb_typeof(p.film) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.film) f WHERE f ->> 'path' LIKE '%/' || v.id::text || '%');

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  RETURN jsonb_build_object(
    'id', v.id, 'moved', true, 'exercise', v_ex, 'set_index', _set_index, 'result_id', v_result,
    'from', jsonb_build_object('row_id', v.row_id, 'set_index', v.set_index, 'label', v.label));
END
$$;
REVOKE ALL ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_video_move(uuid, uuid, integer, text, text) TO authenticated, service_role;
