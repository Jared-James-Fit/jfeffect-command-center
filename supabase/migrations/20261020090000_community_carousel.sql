-- Carousel posts: up to 10 photos / videos on one post (at most 3 videos, so
-- posting stays quick on a phone connection). The first one stays where it
-- always was (media_path & co: the cover, what older app versions show);
-- the rest go in extra_media, in order. Same folder rule as the cover: every
-- file has to be the poster's own upload.

ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS extra_media jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_extra_media_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_extra_media_check
  CHECK (jsonb_typeof(extra_media) = 'array' AND jsonb_array_length(extra_media) <= 9);
-- the storage read rule looks files up by path
CREATE INDEX IF NOT EXISTS community_posts_extra_media ON public.community_posts USING gin (extra_media jsonb_path_ops);

-- Whoever can see a post can see all of its slides. The lookups run inside
-- functions (see 20261019100000_storage_read_fix): this policy is part of
-- every storage read, so it must never trip over a column grant.
CREATE OR REPLACE FUNCTION public.community_post_media_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE (p.media_path = _name OR p.media_thumb_path = _name
                         OR p.extra_media @> jsonb_build_array(jsonb_build_object('path', _name))
                         OR p.extra_media @> jsonb_build_array(jsonb_build_object('thumb', _name)))
                    AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
$$;
REVOKE ALL ON FUNCTION public.community_post_media_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_media_readable(text) TO authenticated;

DROP POLICY IF EXISTS "community media read" ON storage.objects;
CREATE POLICY "community media read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'community-media' AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR public.community_post_media_readable(objects.name)
    OR public.community_comment_media_readable(objects.name)));

-- Saving a post: _extra_media NULL keeps the slides it has, an array sets
-- them ('[]' clears). Removing the media removes all of it.
DROP FUNCTION IF EXISTS public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.community_save_post(
  _completion_id uuid, _caption text DEFAULT NULL, _visibility text DEFAULT 'community', _media_action text DEFAULT 'keep',
  _media_path text DEFAULT NULL, _media_thumb_path text DEFAULT NULL, _media_type text DEFAULT NULL,
  _media_width integer DEFAULT NULL, _media_height integer DEFAULT NULL, _hide_loads boolean DEFAULT NULL,
  _extra_media jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_client uuid;
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  v_id uuid;
  v_done boolean;
  v_prefix text := uid::text || '/';
  v_extra jsonb;
  v_cover_type text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF _media_action NOT IN ('keep', 'set', 'remove') THEN RAISE EXCEPTION 'Invalid media action'; END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 2200 THEN RAISE EXCEPTION 'Caption too long'; END IF;

  SELECT pc.client_id, pc.completed_at IS NOT NULL INTO v_client, v_done
    FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
   WHERE pc.id = _completion_id AND c.user_id = uid
     AND (pc.completed_at IS NOT NULL OR pc.started_at IS NOT NULL OR pc.in_progress_at IS NOT NULL);
  IF v_client IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility = 'community' AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;

  IF _media_action = 'set' THEN
    IF _media_type NOT IN ('image', 'video') OR _media_path IS NULL
       OR left(_media_path, length(v_prefix)) <> v_prefix
       OR (_media_thumb_path IS NOT NULL AND left(_media_thumb_path, length(v_prefix)) <> v_prefix) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;

  IF _extra_media IS NOT NULL AND _media_action <> 'remove' THEN
    IF jsonb_typeof(_extra_media) <> 'array' THEN RAISE EXCEPTION 'Invalid media'; END IF;
    IF jsonb_array_length(_extra_media) > 9 THEN RAISE EXCEPTION 'Up to 10 photos or videos on a post'; END IF;
    -- only the fields the app reads, in the order given
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'path', x.e->>'path', 'thumb', nullif(x.e->>'thumb', ''), 'type', x.e->>'type',
             'width', CASE WHEN x.e->>'width' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'width')::numeric)::int END,
             'height', CASE WHEN x.e->>'height' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'height')::numeric)::int END)
           ORDER BY x.i), '[]'::jsonb)
      INTO v_extra
      FROM jsonb_array_elements(_extra_media) WITH ORDINALITY AS x(e, i);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_extra) e
                WHERE e->>'type' IS NULL OR e->>'type' NOT IN ('image', 'video')
                   OR e->>'path' IS NULL OR left(e->>'path', length(v_prefix)) <> v_prefix
                   OR (e->>'thumb' IS NOT NULL AND left(e->>'thumb', length(v_prefix)) <> v_prefix)) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;

  -- at most 3 videos on a post, cover included
  v_cover_type := CASE _media_action
                    WHEN 'set' THEN _media_type
                    WHEN 'remove' THEN NULL
                    ELSE (SELECT p.media_type FROM public.community_posts p WHERE p.completion_id = _completion_id) END;
  IF (CASE WHEN v_cover_type = 'video' THEN 1 ELSE 0 END)
     + coalesce((SELECT count(*) FROM jsonb_array_elements(coalesce(v_extra,
          CASE WHEN _media_action = 'remove' THEN '[]'::jsonb
               ELSE (SELECT p.extra_media FROM public.community_posts p WHERE p.completion_id = _completion_id) END,
          '[]'::jsonb)) e WHERE e->>'type' = 'video'), 0) > 3 THEN
    RAISE EXCEPTION 'Up to 3 videos on a post';
  END IF;

  INSERT INTO public.community_posts AS p (
    author_user_id, client_id, completion_id, caption, visibility,
    media_path, media_thumb_path, media_type, media_width, media_height, locked_in_at, hide_loads, extra_media)
  VALUES (
    uid, v_client, _completion_id, v_cap, _visibility,
    CASE WHEN _media_action = 'set' THEN _media_path END,
    CASE WHEN _media_action = 'set' THEN _media_thumb_path END,
    CASE WHEN _media_action = 'set' THEN _media_type END,
    CASE WHEN _media_action = 'set' THEN _media_width END,
    CASE WHEN _media_action = 'set' THEN _media_height END,
    CASE WHEN v_done THEN NULL ELSE now() END,
    coalesce(_hide_loads, false),
    coalesce(v_extra, '[]'::jsonb))
  ON CONFLICT ON CONSTRAINT community_posts_one_per_completion DO UPDATE SET
    caption = EXCLUDED.caption,
    visibility = EXCLUDED.visibility,
    media_path = CASE _media_action WHEN 'keep' THEN p.media_path ELSE EXCLUDED.media_path END,
    media_thumb_path = CASE _media_action WHEN 'keep' THEN p.media_thumb_path ELSE EXCLUDED.media_thumb_path END,
    media_type = CASE _media_action WHEN 'keep' THEN p.media_type ELSE EXCLUDED.media_type END,
    media_width = CASE _media_action WHEN 'keep' THEN p.media_width ELSE EXCLUDED.media_width END,
    media_height = CASE _media_action WHEN 'keep' THEN p.media_height ELSE EXCLUDED.media_height END,
    extra_media = CASE WHEN _media_action = 'remove' THEN '[]'::jsonb WHEN v_extra IS NOT NULL THEN v_extra ELSE p.extra_media END,
    hide_loads = coalesce(_hide_loads, p.hide_loads),
    edited_at = CASE WHEN p.caption IS DISTINCT FROM EXCLUDED.caption THEN now() ELSE p.edited_at END,
    archived_at = NULL,
    archived_from = NULL,
    updated_at = now()
  RETURNING p.id INTO v_id;

  -- slides but no cover: the first slide is the cover
  UPDATE public.community_posts p
     SET media_path = p.extra_media->0->>'path', media_thumb_path = p.extra_media->0->>'thumb',
         media_type = p.extra_media->0->>'type', media_width = (p.extra_media->0->>'width')::int,
         media_height = (p.extra_media->0->>'height')::int, extra_media = p.extra_media - 0
   WHERE p.id = v_id AND p.media_path IS NULL AND jsonb_array_length(p.extra_media) > 0;

  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean, jsonb) TO authenticated;

-- The post as the app gets it: now with its other slides.
CREATE OR REPLACE FUNCTION public.community_post_json(_post_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', n.id,
    'created_at', n.created_at,
    'visibility', n.visibility,
    'caption', n.caption,
    'media_path', n.media_path,
    'media_thumb_path', n.media_thumb_path,
    'media_type', n.media_type,
    'media_width', n.media_width,
    'media_height', n.media_height,
    -- slides 2..10 of a carousel (null when it's just the one)
    'extra_media', CASE WHEN jsonb_array_length(n.extra_media) > 0 THEN n.extra_media END,
    'completion_id', n.completion_id,
    'kind', n.kind,
    'series', n.series,
    'quote', n.quote,
    'quote_author', n.quote_author,
    'quote_source', n.quote_source,
    'series_data', CASE WHEN n.series IS NULL OR n.series IN ('wednesday_wins', 'sunday_recap') THEN n.series_data END,
    'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit') THEN n.series_data END,
    -- a comment someone shared as this post: live, so a deleted or hidden comment disappears from it too
    'shared_comment', CASE WHEN n.shared_comment_id IS NOT NULL THEN coalesce((
      SELECT jsonb_build_object('id', c.id, 'post_id', c.post_id, 'body', c.body, 'created_at', c.created_at,
                                'author', public.community_author(c.author_user_id),
                                'post_author', public.community_author(op.author_user_id)->>'name',
                                'media', CASE WHEN c.media_path IS NOT NULL THEN jsonb_build_object(
                                  'path', c.media_path, 'thumb', c.media_thumb_path, 'type', c.media_type,
                                  'width', c.media_width, 'height', c.media_height) END)
        FROM public.community_comments c JOIN public.community_posts op ON op.id = c.post_id
       WHERE c.id = n.shared_comment_id AND op.visibility = 'community'
         AND public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at)),
      jsonb_build_object('gone', true)) END,
    'edited_at', n.edited_at,
    'archived_at', n.archived_at,
    'archived_from', n.archived_from,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'reaction_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = n.id),
    'reactors', coalesce((SELECT jsonb_agg(x.j ORDER BY x.coach DESC, x.at DESC)
                            FROM (SELECT public.community_author(r.user_id)
                                         || jsonb_build_object('is_me', public.community_main_account(r.user_id) = public.community_main_account(_viewer)) AS j,
                                         public.community_is_coach(r.user_id) AS coach, r.created_at AS at
                                    FROM public.community_reactions r WHERE r.post_id = n.id
                                   ORDER BY public.community_is_coach(r.user_id) DESC, r.created_at DESC LIMIT 3) x), '[]'::jsonb),
    'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                    ORDER BY r.created_at)
                                   FROM public.community_reactions r
                                  WHERE r.post_id = n.id
                                    AND public.community_is_coach(r.user_id)), '[]'::jsonb),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id AND c.hidden_at IS NULL),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$$;

