-- Views are Instagram's: whoever sees your post or story is on its Activity
-- by name. "View posts privately" is gone.
--
-- The views someone made while they had it on were promised to stay
-- nameless ("You still count as a view, without your name"), so those rows
-- keep that (community_post_views.anonymous): still counted, never named.
-- Everything from now on is named, and the switch can't come back on
-- (community_profiles_views_named).
SET lock_timeout = '3s';

ALTER TABLE public.community_post_views ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false;
UPDATE public.community_post_views v SET anonymous = true
  FROM public.community_profiles cp
 WHERE cp.user_id = v.viewer_user_id AND cp.private_views AND NOT v.anonymous;

UPDATE public.community_profiles SET private_views = false WHERE private_views;
ALTER TABLE public.community_profiles DROP CONSTRAINT IF EXISTS community_profiles_views_named;
ALTER TABLE public.community_profiles ADD CONSTRAINT community_profiles_views_named CHECK (NOT private_views);

DROP FUNCTION IF EXISTS public.community_set_private_views(boolean);

/** The views line on your own post: how many, and the three latest faces. */
CREATE OR REPLACE FUNCTION public.community_post_views_summary(_post_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM public.community_post_views v WHERE v.post_id = _post_id),
    'faces', coalesce((SELECT jsonb_agg(public.community_author(x.viewer_user_id) ORDER BY x.viewed_at DESC)
                         FROM (SELECT v.viewer_user_id, v.viewed_at FROM public.community_post_views v
                                WHERE v.post_id = _post_id AND NOT v.anonymous
                                ORDER BY v.viewed_at DESC LIMIT 3) x), '[]'::jsonb));
$$;

/** Who viewed your post (an older app's list; Activity is community_post_activity). */
CREATE OR REPLACE FUNCTION public.community_post_viewers(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_me := public.community_main_account(uid);
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.author_user_id = v_me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'count', (SELECT count(*) FROM public.community_post_views v WHERE v.post_id = _post_id),
    'viewers', coalesce((SELECT jsonb_agg(public.community_author(v.viewer_user_id) || jsonb_build_object('viewed_at', v.viewed_at) ORDER BY v.viewed_at DESC)
                           FROM public.community_post_views v
                          WHERE v.post_id = _post_id AND NOT v.anonymous), '[]'::jsonb),
    'private_count', (SELECT count(*) FROM public.community_post_views v WHERE v.post_id = _post_id AND v.anonymous),
    'me_private', false);
END;
$$;

/**
 * A post's (or a story's) Activity, for the person who posted it only:
 * views, likes, shares to stories, reposts, and the people behind them,
 * Instagram's order: who liked, shared or reposted first (newest first),
 * then everyone else who viewed (newest first). A share is named only when
 * its story is one you may see.
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
     WHERE v.post_id = _post_id AND NOT v.anonymous
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
           'people', coalesce((SELECT jsonb_agg(ranked.j ORDER BY ranked.interacted DESC NULLS LAST, ranked.seen DESC NULLS LAST) FROM ranked), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_activity(uuid) TO authenticated, service_role;
