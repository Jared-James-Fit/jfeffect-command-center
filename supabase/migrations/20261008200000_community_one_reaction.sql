-- One reaction: 🔥. A crew of ~16 reads better as "🔥 5" than four split
-- counts, it's one tap with no choosing (double-tap already gives it), and
-- the point is seeing WHO gave it, so posts now carry the first few people
-- and there's a full list.

-- The one reaction that existed under the old set becomes 🔥 so counts add up.
UPDATE public.community_reactions SET emoji = 'fire' WHERE emoji IS DISTINCT FROM 'fire';

-- Older app versions may still send heart/muscle/clap; every reaction is 🔥 now.
CREATE OR REPLACE FUNCTION public.community_react(_post_id uuid, _emoji text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF _emoji IS NULL OR _emoji = '' THEN
    DELETE FROM public.community_reactions WHERE post_id = _post_id AND user_id = uid;
  ELSE
    IF _emoji NOT IN ('fire', 'muscle', 'clap', 'heart') THEN RAISE EXCEPTION 'Invalid reaction'; END IF;
    INSERT INTO public.community_reactions (post_id, user_id, emoji) VALUES (_post_id, uid, 'fire')
    ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = 'fire';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_react(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_react(uuid, text) TO authenticated;

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
    'completion_id', n.completion_id,
    'kind', n.kind,
    'series', n.series,
    'quote', n.quote,
    'quote_author', n.quote_author,
    'quote_source', n.quote_source,
    'series_data', n.series_data,
    'edited_at', n.edited_at,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    -- "Hide my weights": loads are removed for everyone but the author.
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'reaction_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = n.id),
    -- who gave it 🔥, for "🔥 from Jared, Vicky and 3 others": coaches first, then newest
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
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_post_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Everyone who gave a post 🔥 (only for people who can see the post).
CREATE OR REPLACE FUNCTION public.community_post_reactors(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(r.user_id),
             'is_me', public.community_main_account(r.user_id) = public.community_main_account(uid),
             'created_at', r.created_at)
           ORDER BY public.community_is_coach(r.user_id) DESC, r.created_at DESC)
      FROM public.community_reactions r WHERE r.post_id = _post_id), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_reactors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_reactors(uuid) TO authenticated;
