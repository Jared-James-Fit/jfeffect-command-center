-- Views on every post.
-- 1. Posts from before views were counted: anyone who reacted, commented,
--    liked a comment or voted in its poll certainly saw it, so they count
--    (at the first time they did). Never the author. Nothing is made up:
--    a post nobody interacted with stays at what's been counted since.
-- 2. Everyone sees how many views a post has; who viewed (the faces and the
--    list) stays the author's alone.
INSERT INTO public.community_post_views (post_id, viewer_user_id, viewed_at)
SELECT x.post_id, x.viewer, min(x.at)
  FROM (
    SELECT r.post_id, public.community_main_account(r.user_id) AS viewer, r.created_at AS at FROM public.community_reactions r
    UNION ALL
    SELECT c.post_id, public.community_main_account(c.author_user_id), c.created_at FROM public.community_comments c
    UNION ALL
    SELECT l.post_id, public.community_main_account(l.user_id), l.created_at FROM public.community_comment_likes l
    UNION ALL
    SELECT v.post_id, public.community_main_account(v.user_id), v.created_at FROM public.community_poll_votes v
  ) x
  JOIN public.community_posts p ON p.id = x.post_id
 WHERE x.viewer IS NOT NULL AND x.viewer IS DISTINCT FROM p.author_user_id
 GROUP BY x.post_id, x.viewer
ON CONFLICT (post_id, viewer_user_id) DO UPDATE SET viewed_at = least(public.community_post_views.viewed_at, EXCLUDED.viewed_at);

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  def := replace(def,
    $r$'views', CASE WHEN n.author_user_id = public.community_main_account(_viewer) THEN public.community_post_views_summary(n.id) END,$r$,
    $r$'views', CASE WHEN n.author_user_id = public.community_main_account(_viewer) THEN public.community_post_views_summary(n.id)
                     ELSE jsonb_build_object('count', (SELECT count(*) FROM public.community_post_views v WHERE v.post_id = n.id), 'faces', '[]'::jsonb) END,$r$);
  IF position($r$'faces', '[]'::jsonb) END$r$ in def) = 0 THEN RAISE EXCEPTION 'community_post_json: views not found'; END IF;
  EXECUTE def;
END $$;
