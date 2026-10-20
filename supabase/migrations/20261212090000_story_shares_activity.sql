-- Instagram's "Add to your story" and the poster's Activity.
--
-- Add to your story: a post (yours, or one shared with the whole crew) goes on
-- your story as a card you can write on. The story is a story like any other
-- (a 9:16 picture, 24h, the crew or Close friends); shared_post_id is the post
-- it shares, so "View post" opens it for whoever may see it. Stories (and
-- automatic workout stories) can't be shared again, and nobody else's post
-- that isn't crew-wide can be, so a share never reaches people the post
-- wasn't for.
--
-- Activity: the poster's own view of a post or story: views, likes, shares
-- to stories and reposts, with one list of people (those who liked, shared
-- or reposted first, then everyone who viewed). People who view privately are
-- counted, not named, as in Views.
SET lock_timeout = '3s';

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS shared_post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS community_posts_shared_idx ON public.community_posts (shared_post_id, created_at DESC) WHERE shared_post_id IS NOT NULL;

/** Why _viewer can't add this post to their story, or null when they can. */
CREATE OR REPLACE FUNCTION public.community_share_refusal(_post_id uuid, _viewer uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p.id IS NULL OR p.archived_at IS NOT NULL THEN 'Post not found'
    WHEN coalesce(p.story_only, false) OR coalesce(p.auto_shared, false) THEN 'A story can''t be added to another story'
    WHEN p.author_user_id = public.community_main_account(_viewer) THEN NULL
    WHEN p.visibility <> 'community' THEN 'Only posts shared with the whole crew can be added to your story'
  END
    FROM (SELECT 1) one LEFT JOIN public.community_posts p ON p.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_share_refusal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_share_refusal(uuid, uuid) TO service_role;

/** The post a story shares, for the signed-in person: who posted it, or null when they can't see it. */
CREATE OR REPLACE FUNCTION public.community_shared_post_json(_post_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('id', p.id, 'author', public.community_author(p.author_user_id), 'kind', p.kind, 'series', p.series)
    FROM public.community_posts p
   WHERE _post_id IS NOT NULL AND p.id = _post_id AND p.archived_at IS NULL
     AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
     AND (public.community_is_staff(auth.uid()) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))
$$;
REVOKE ALL ON FUNCTION public.community_shared_post_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_shared_post_json(uuid) TO service_role;

-- A post carries the post it shares (its own second object: the first is at Postgres's 100-argument limit).
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_post_json(uuid,uuid)'::regprocedure);
  v_old text := '''can_repost'', public.community_repost_refusal(n.id, _viewer) IS NULL)';
  v_new text := '''can_repost'', public.community_repost_refusal(n.id, _viewer) IS NULL,'
             || E'\n    ''shared_post'', public.community_shared_post_json(n.shared_post_id))';
BEGIN
  IF position('community_shared_post_json' IN v_def) > 0 THEN RETURN; END IF; -- already patched
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'community_post_json: can_repost anchor not found'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

-- Posting: a story can share a post (_shared_post_id). Replaces the 4-argument version, so a call never has two to pick from.
DROP FUNCTION IF EXISTS public.community_create_post(text, jsonb, text, boolean);
CREATE OR REPLACE FUNCTION public.community_create_post(_caption text DEFAULT NULL::text, _media jsonb DEFAULT NULL::jsonb, _visibility text DEFAULT 'community'::text, _story boolean DEFAULT false, _shared_post_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_author uuid;
  v_client uuid;
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  v_media jsonb;
  v_id uuid;
  v_why text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'followers', 'close_friends', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF _visibility IN ('community', 'followers', 'close_friends') AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 1200 THEN RAISE EXCEPTION 'Keep it to 1200 characters'; END IF;
  v_media := public.community_clean_media(_media, uid);
  IF v_cap IS NULL AND jsonb_array_length(v_media) = 0 THEN RAISE EXCEPTION 'Add a photo or write something'; END IF;
  IF coalesce(_story, false) AND jsonb_array_length(v_media) = 0 THEN RAISE EXCEPTION 'A story needs a photo or a clip'; END IF;
  IF coalesce(_story, false) AND _visibility NOT IN ('community', 'followers', 'close_friends') THEN
    RAISE EXCEPTION 'A story is for the crew or Close friends';
  END IF;
  IF _shared_post_id IS NOT NULL THEN
    IF NOT coalesce(_story, false) THEN RAISE EXCEPTION 'A post is shared to your story'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                    WHERE p.id = _shared_post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
                      AND (public.community_is_staff(uid) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))) THEN
      RAISE EXCEPTION 'Post not found';
    END IF;
    v_why := public.community_share_refusal(_shared_post_id, uid);
    IF v_why IS NOT NULL THEN RAISE EXCEPTION '%', v_why; END IF;
  END IF;
  v_author := public.community_main_account(uid);
  SELECT c.id INTO v_client FROM public.clients c WHERE c.user_id = v_author LIMIT 1;
  IF v_client IS NULL AND NOT public.community_is_coach(uid) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.community_posts p WHERE p.author_user_id = v_author AND p.kind = 'note' AND p.created_at > now() - interval '1 day') >= 25 THEN
    RAISE EXCEPTION 'That''s a lot of posts today. Try again tomorrow.';
  END IF;
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, story_only, shared_post_id)
  VALUES (v_author, v_client, 'note', _visibility, v_cap, coalesce(_story, false), _shared_post_id)
  RETURNING id INTO v_id;
  IF jsonb_array_length(v_media) > 0 THEN PERFORM public.community_apply_media(v_id, v_media); END IF;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_create_post(text, jsonb, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_create_post(text, jsonb, text, boolean, uuid) TO authenticated, service_role;

/**
 * A post's (or a story's) activity, for the person who posted it only:
 * views, likes, shares to stories, reposts, and the people behind them
 * (who liked, shared or reposted first, newest first; then who viewed).
 * Private viewers are counted, not named; a share whose story you can't see
 * is counted, not named.
 */
CREATE OR REPLACE FUNCTION public.community_post_activity(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
  v_out jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_me := public.community_main_account(uid);
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.author_user_id = v_me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  WITH v AS (
    SELECT v.viewer_user_id AS user_id, max(v.viewed_at) AS viewed_at
      FROM public.community_post_views v
      LEFT JOIN public.community_profiles cp ON cp.user_id = v.viewer_user_id
     WHERE v.post_id = _post_id AND NOT coalesce(cp.private_views, false)
     GROUP BY 1
  ), r AS (
    SELECT DISTINCT ON (r.user_id) r.user_id, r.emoji, r.created_at
      FROM public.community_reactions r WHERE r.post_id = _post_id
     ORDER BY r.user_id, r.created_at DESC
  ), s AS (
    SELECT DISTINCT ON (sp.author_user_id) sp.author_user_id AS user_id, sp.created_at, sp.id
      FROM public.community_posts sp
     WHERE sp.shared_post_id = _post_id AND sp.archived_at IS NULL
       AND public.community_post_visible(sp.visibility, sp.author_user_id, sp.client_id)
     ORDER BY sp.author_user_id, sp.created_at DESC
  ), rp AS (
    SELECT rp.user_id, rp.created_at FROM public.community_reposts rp WHERE rp.post_id = _post_id
  ), people AS (
    SELECT u.user_id FROM (SELECT user_id FROM v UNION SELECT user_id FROM r UNION SELECT user_id FROM s UNION SELECT user_id FROM rp) u
     WHERE public.community_main_account(u.user_id) IS DISTINCT FROM v_me
  ), ranked AS (
    SELECT public.community_author(pe.user_id)
             || jsonb_strip_nulls(jsonb_build_object('viewed_at', v.viewed_at, 'reaction', r.emoji, 'reacted_at', r.created_at,
                                                     'shared_at', s.created_at, 'share_id', s.id, 'reposted_at', rp.created_at)) AS j,
           greatest(r.created_at, s.created_at, rp.created_at) AS interacted,
           v.viewed_at AS seen
      FROM people pe
      LEFT JOIN v ON v.user_id = pe.user_id
      LEFT JOIN r ON r.user_id = pe.user_id
      LEFT JOIN s ON s.user_id = pe.user_id
      LEFT JOIN rp ON rp.user_id = pe.user_id
     ORDER BY greatest(r.created_at, s.created_at, rp.created_at) DESC NULLS LAST, v.viewed_at DESC NULLS LAST
     LIMIT 500
  )
  SELECT jsonb_build_object(
           'views', (SELECT count(*) FROM public.community_post_views x WHERE x.post_id = _post_id),
           'likes', (SELECT count(*) FROM public.community_reactions x WHERE x.post_id = _post_id),
           'shares', (SELECT count(*) FROM public.community_posts x WHERE x.shared_post_id = _post_id AND x.archived_at IS NULL),
           'reposts', (SELECT count(*) FROM rp),
           'people', coalesce((SELECT jsonb_agg(ranked.j ORDER BY ranked.interacted DESC NULLS LAST, ranked.seen DESC NULLS LAST) FROM ranked), '[]'::jsonb),
           'private_count', (SELECT count(*) FROM public.community_post_views x
                               JOIN public.community_profiles cp ON cp.user_id = x.viewer_user_id
                              WHERE x.post_id = _post_id AND cp.private_views),
           'me_private', coalesce((SELECT cp.private_views FROM public.community_profiles cp WHERE cp.user_id = v_me), false))
    INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_activity(uuid) TO authenticated, service_role;
