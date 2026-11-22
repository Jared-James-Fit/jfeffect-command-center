-- Film notes on a set video: a coach's (or the athlete's own) marks on one
-- moment of the clip, drawn over the original footage, never into it.
--
-- A note is a time in the clip (s), the shapes drawn there (lines, arrows,
-- circles in shares of the frame, or a joint picked on the athlete's body,
-- which then follows the joint as the clip plays), a comment, and the coach
-- chat message it went out in. The video file itself is never touched.
--   * read: exactly who can see the set video (the athlete, their coach,
--     admins), the same three policies as pl_set_videos;
--   * written only through lift_video_note_save / _sent / _remove, by the
--     athlete, their coach or an admin (_set_video_for_analysis), tied to the
--     set video's own client (never taken from the caller); a note is edited,
--     hidden or removed only by whoever wrote it (or an admin);
--   * removing the set video removes its notes (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS public.lift_video_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_video_id  uuid NOT NULL REFERENCES public.pl_set_videos(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL,
  t             numeric(9,3) NOT NULL CHECK (t >= 0 AND t < 3600),
  shapes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  body          text NOT NULL DEFAULT '' CHECK (char_length(body) <= 1000),
  -- the overlays that were on when it was drawn (so the athlete opens it the same way)
  layers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_id    uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  hidden_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lift_video_notes_shapes_array CHECK (jsonb_typeof(shapes) = 'array' AND jsonb_array_length(shapes) <= 40),
  CONSTRAINT lift_video_notes_layers_object CHECK (jsonb_typeof(layers) = 'object')
);

CREATE INDEX IF NOT EXISTS lift_video_notes_video ON public.lift_video_notes (set_video_id, t);
CREATE INDEX IF NOT EXISTS lift_video_notes_client ON public.lift_video_notes (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lift_video_notes_message ON public.lift_video_notes (message_id);

ALTER TABLE public.lift_video_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lift_video_notes FROM anon, authenticated;
GRANT SELECT ON public.lift_video_notes TO authenticated;
GRANT ALL ON public.lift_video_notes TO service_role;

DROP POLICY IF EXISTS "Film notes: own" ON public.lift_video_notes;
CREATE POLICY "Film notes: own" ON public.lift_video_notes
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Film notes: coach" ON public.lift_video_notes;
CREATE POLICY "Film notes: coach" ON public.lift_video_notes
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Film notes: admin" ON public.lift_video_notes;
CREATE POLICY "Film notes: admin" ON public.lift_video_notes
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

/** The shapes a note may hold: lines, arrows, circles (two points in shares of the frame) and joints. */
CREATE OR REPLACE FUNCTION public._lift_video_note_shapes_ok(_shapes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_typeof(_shapes) = 'array'
     AND jsonb_array_length(_shapes) <= 40
     AND octet_length(_shapes::text) <= 20000
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(_shapes) e
        WHERE jsonb_typeof(e) <> 'object'
           OR coalesce(e->>'kind', '') NOT IN ('line', 'arrow', 'circle', 'joint')
           OR (e->>'kind' = 'joint' AND NOT ((e->>'j') ~ '^[0-9]{1,2}$' AND (e->>'j')::int < 33))
           OR (e->>'kind' <> 'joint' AND NOT (
                 jsonb_typeof(e->'a') = 'array' AND jsonb_array_length(e->'a') = 2
             AND jsonb_typeof(e->'b') = 'array' AND jsonb_array_length(e->'b') = 2
             AND jsonb_typeof(e->'a'->0) = 'number' AND jsonb_typeof(e->'a'->1) = 'number'
             AND jsonb_typeof(e->'b'->0) = 'number' AND jsonb_typeof(e->'b'->1) = 'number'))
     )
$$;
REVOKE ALL ON FUNCTION public._lift_video_note_shapes_ok(jsonb) FROM PUBLIC, anon, authenticated;

/**
 * Add a note (_id null) or change one the caller wrote. Returns its id.
 * The set video's own client goes on it; the caller is its author.
 */
CREATE OR REPLACE FUNCTION public.lift_video_note_save(
  _id uuid,
  _set_video_id uuid,
  _t numeric,
  _shapes jsonb,
  _body text,
  _layers jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sv  public.pl_set_videos;
  v_id  uuid;
BEGIN
  v_sv := public._set_video_for_analysis(_set_video_id);
  IF _t IS NULL OR _t < 0 OR _t >= 3600 THEN
    RAISE EXCEPTION 'That moment isn''t in the video.' USING ERRCODE = '22023';
  END IF;
  IF NOT public._lift_video_note_shapes_ok(coalesce(_shapes, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'Those marks couldn''t be saved.' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(_body, '')) > 1000 THEN
    RAISE EXCEPTION 'Keep the comment under 1,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(_layers, '{}'::jsonb)) <> 'object' OR octet_length(coalesce(_layers, '{}'::jsonb)::text) > 2000 THEN
    RAISE EXCEPTION 'That note couldn''t be saved.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(coalesce(_shapes, '[]'::jsonb)) = 0 AND btrim(coalesce(_body, '')) = '' THEN
    RAISE EXCEPTION 'Draw something or write a comment first.' USING ERRCODE = '22023';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.lift_video_notes (set_video_id, client_id, author_id, t, shapes, body, layers)
    VALUES (v_sv.id, v_sv.client_id, v_uid, round(_t, 3), coalesce(_shapes, '[]'::jsonb),
            btrim(coalesce(_body, '')), coalesce(_layers, '{}'::jsonb))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  UPDATE public.lift_video_notes
     SET t = round(_t, 3),
         shapes = coalesce(_shapes, '[]'::jsonb),
         body = btrim(coalesce(_body, '')),
         layers = coalesce(_layers, '{}'::jsonb),
         updated_at = now()
   WHERE id = _id
     AND set_video_id = v_sv.id
     AND (author_id = v_uid OR (SELECT public.has_role(v_uid, 'admin'::public.app_role)))
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Only whoever wrote that note can change it.' USING ERRCODE = '42501';
  END IF;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION public.lift_video_note_save(uuid, uuid, numeric, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lift_video_note_save(uuid, uuid, numeric, jsonb, text, jsonb) TO authenticated;

/** The chat message a note went out in (the author's own message in that client's chat). */
CREATE OR REPLACE FUNCTION public.lift_video_note_sent(_id uuid, _message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n   public.lift_video_notes;
BEGIN
  SELECT * INTO v_n FROM public.lift_video_notes WHERE id = _id;
  IF NOT FOUND OR v_n.author_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = _message_id AND m.client_id = v_n.client_id AND m.sender_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.lift_video_notes SET message_id = _message_id, updated_at = now() WHERE id = _id;
END
$$;
REVOKE ALL ON FUNCTION public.lift_video_note_sent(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lift_video_note_sent(uuid, uuid) TO authenticated;

/** Hide or show a note (the author or an admin), or remove it for good (_delete). */
CREATE OR REPLACE FUNCTION public.lift_video_note_remove(_id uuid, _hide boolean DEFAULT NULL, _delete boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ok  boolean;
BEGIN
  SELECT (n.author_id = v_uid OR (SELECT public.has_role(v_uid, 'admin'::public.app_role)))
    INTO v_ok FROM public.lift_video_notes n WHERE n.id = _id;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'Only whoever wrote that note can change it.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_delete, false) THEN
    DELETE FROM public.lift_video_notes WHERE id = _id;
  ELSIF _hide IS NOT NULL THEN
    UPDATE public.lift_video_notes
       SET hidden_at = CASE WHEN _hide THEN now() ELSE NULL END, updated_at = now()
     WHERE id = _id;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.lift_video_note_remove(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lift_video_note_remove(uuid, boolean, boolean) TO authenticated;

SELECT public.rls_evaluate_once('lift_video_notes');
