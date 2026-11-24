-- What a story was made with (Nov 23 2026): its colour filter ("Cool",
-- "Cinematic") and its template ("Game Day"), shown as a quiet line under the
-- poster's name in the story viewer, Instagram's filter attribution. Kept as
-- the story's metadata, never drawn into the picture, and only when the poster
-- left it on (the camera's "Show the filter's name" choice: hidden, no row).
--
-- One row a story, written only by community_story_look_set (the story's own
-- author, a story only, within its first hour); read only through
-- community_story_looks_for, which answers only for stories the caller can
-- see (the same rule as the feed: community_post_visible, blocks either way).
-- The table itself is closed to clients (RLS on, no policies, no grants).

CREATE TABLE IF NOT EXISTS public.community_story_looks (
  post_id uuid PRIMARY KEY REFERENCES public.community_posts(id) ON DELETE CASCADE,
  colour_key text,
  colour_label text,
  template_key text,
  template_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_story_looks_some CHECK (colour_label IS NOT NULL OR template_label IS NOT NULL),
  CONSTRAINT community_story_looks_sizes CHECK (
    coalesce(char_length(colour_key), 0) <= 40 AND coalesce(char_length(colour_label), 0) <= 40
    AND coalesce(char_length(template_key), 0) <= 60 AND coalesce(char_length(template_label), 0) <= 48
  )
);

ALTER TABLE public.community_story_looks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_story_looks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_story_looks TO service_role;

COMMENT ON TABLE public.community_story_looks IS
  'A story''s colour filter and template names for the viewer''s attribution line. Written by community_story_look_set (author, own story), read by community_story_looks_for (visible stories only). No client policies.';

/** Puts (or takes off, both names null) the attribution on the caller's own story. */
CREATE OR REPLACE FUNCTION public.community_story_look_set(
  _post_id uuid,
  _colour_key text DEFAULT NULL,
  _colour_label text DEFAULT NULL,
  _template_key text DEFAULT NULL,
  _template_label text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_cl text := nullif(btrim(left(coalesce(_colour_label, ''), 40)), '');
  v_tl text := nullif(btrim(left(coalesce(_template_label, ''), 48)), '');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_posts p
     WHERE p.id = _post_id
       AND p.story_only
       AND p.author_user_id = public.community_main_account(uid)
       AND p.created_at > now() - interval '1 hour'
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_cl IS NULL AND v_tl IS NULL THEN
    DELETE FROM public.community_story_looks WHERE post_id = _post_id;
    RETURN;
  END IF;
  INSERT INTO public.community_story_looks (post_id, colour_key, colour_label, template_key, template_label)
  VALUES (
    _post_id,
    CASE WHEN v_cl IS NULL THEN NULL ELSE nullif(btrim(left(coalesce(_colour_key, ''), 40)), '') END,
    v_cl,
    CASE WHEN v_tl IS NULL THEN NULL ELSE nullif(btrim(left(coalesce(_template_key, ''), 60)), '') END,
    v_tl
  )
  ON CONFLICT (post_id) DO UPDATE
    SET colour_key = EXCLUDED.colour_key,
        colour_label = EXCLUDED.colour_label,
        template_key = EXCLUDED.template_key,
        template_label = EXCLUDED.template_label;
END;
$$;
REVOKE ALL ON FUNCTION public.community_story_look_set(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_story_look_set(uuid, text, text, text, text) TO authenticated, service_role;

/** The attribution for the stories the caller can see, of the ones asked for (at most 200 a call). */
CREATE OR REPLACE FUNCTION public.community_story_looks_for(_post_ids uuid[])
RETURNS TABLE (post_id uuid, colour_key text, colour_label text, template_key text, template_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT l.post_id, l.colour_key, l.colour_label, l.template_key, l.template_label
    FROM public.community_story_looks l
    JOIN public.community_posts p ON p.id = l.post_id
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND l.post_id = ANY ((_post_ids)[1:200])
     AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
     AND (public.community_is_staff((SELECT auth.uid())) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()));
$$;
REVOKE ALL ON FUNCTION public.community_story_looks_for(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_story_looks_for(uuid[]) TO authenticated, service_role;
