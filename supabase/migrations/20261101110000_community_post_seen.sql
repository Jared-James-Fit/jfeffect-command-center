-- Crew Stories: whether the viewer has seen a post (any device), from the
-- views the feed already records (community_post_views, one per viewer). The
-- story rail rings a person while any of their last day is unseen.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  IF position($r$'seen', EXISTS$r$ in def) = 0 THEN
    def := replace(def,
      $r$    'views', CASE WHEN n.author_user_id = public.community_main_account(_viewer)$r$,
      $r$    'seen', EXISTS (SELECT 1 FROM public.community_post_views sv WHERE sv.post_id = n.id AND sv.viewer_user_id = public.community_main_account(_viewer)),
    'views', CASE WHEN n.author_user_id = public.community_main_account(_viewer)$r$);
    IF position($r$'seen', EXISTS$r$ in def) = 0 THEN RAISE EXCEPTION 'community_post_json: views anchor not found'; END IF;
    EXECUTE def;
  END IF;
END $$;
