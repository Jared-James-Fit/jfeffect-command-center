-- Post views. A view is one person once per post (their community account,
-- so a coach's two logins count once), recorded when the post was on screen
-- (half of it, two seconds) or opened. Never your own posts.
-- Who viewed is the author's to see, nobody else's: the feed carries a count
-- and three faces only on your own posts. Anyone can view privately: they
-- still count, but aren't named.
CREATE TABLE IF NOT EXISTS public.community_post_views (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, viewer_user_id)
);
CREATE INDEX IF NOT EXISTS community_post_views_recent_idx ON public.community_post_views (post_id, viewed_at DESC);
-- only through the functions below
ALTER TABLE public.community_post_views ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS private_views boolean NOT NULL DEFAULT false;

-- Batched from the feed (at most 50 a call). Posts you can't see are skipped.
CREATE OR REPLACE FUNCTION public.community_mark_viewed(_post_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
  n integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _post_ids IS NULL OR NOT public.can_view_community() THEN RETURN 0; END IF;
  v_me := public.community_main_account(uid);
  INSERT INTO public.community_post_views (post_id, viewer_user_id)
  SELECT p.id, v_me
    FROM public.community_posts p
   WHERE p.id = ANY (_post_ids[1:50])
     AND p.archived_at IS NULL
     AND p.author_user_id IS DISTINCT FROM v_me
     AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
  ON CONFLICT (post_id, viewer_user_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.community_mark_viewed(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_mark_viewed(uuid[]) TO authenticated;

-- For the feed: on your own post, how many and the three latest (named) viewers.
CREATE OR REPLACE FUNCTION public.community_post_views_summary(_post_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM public.community_post_views v WHERE v.post_id = _post_id),
    'faces', coalesce((SELECT jsonb_agg(public.community_author(x.viewer_user_id) ORDER BY x.viewed_at DESC)
                         FROM (SELECT v.viewer_user_id, v.viewed_at FROM public.community_post_views v
                                LEFT JOIN public.community_profiles cp ON cp.user_id = v.viewer_user_id
                               WHERE v.post_id = _post_id AND NOT coalesce(cp.private_views, false)
                               ORDER BY v.viewed_at DESC LIMIT 3) x), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.community_post_views_summary(uuid) FROM public, anon, authenticated;

-- The list (tap the count): the post's author only.
CREATE OR REPLACE FUNCTION public.community_post_viewers(_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
                           LEFT JOIN public.community_profiles cp ON cp.user_id = v.viewer_user_id
                          WHERE v.post_id = _post_id AND NOT coalesce(cp.private_views, false)), '[]'::jsonb),
    'private_count', (SELECT count(*) FROM public.community_post_views v
                        JOIN public.community_profiles cp ON cp.user_id = v.viewer_user_id
                       WHERE v.post_id = _post_id AND cp.private_views),
    'me_private', coalesce((SELECT cp.private_views FROM public.community_profiles cp WHERE cp.user_id = v_me), false));
END;
$function$;
REVOKE ALL ON FUNCTION public.community_post_viewers(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_post_viewers(uuid) TO authenticated;

-- View posts privately (you still count, unnamed).
CREATE OR REPLACE FUNCTION public.community_set_private_views(_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_me := public.community_main_account(uid);
  INSERT INTO public.community_profiles (user_id, private_views) VALUES (v_me, coalesce(_on, false))
  ON CONFLICT (user_id) DO UPDATE SET private_views = EXCLUDED.private_views, updated_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.community_set_private_views(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.community_set_private_views(boolean) TO authenticated;

-- The feed carries views on your own posts only.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  def := replace(def,
    $r$    'is_mine', n.author_user_id = public.community_main_account(_viewer),$r$,
    $r$    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'views', CASE WHEN n.author_user_id = public.community_main_account(_viewer) THEN public.community_post_views_summary(n.id) END,$r$);
  IF position('community_post_views_summary' in def) = 0 THEN RAISE EXCEPTION 'community_post_json: is_mine not found'; END IF;
  EXECUTE def;
END $$;
