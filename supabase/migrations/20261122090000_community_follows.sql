-- Crew: Follow.
--
-- Follow is private: you see who you follow and who follows you, nobody sees
-- anyone else's lists or counts (no vanity numbers to compete on). It never
-- gates what you can see (the crew feed is club-wide, Strava-club style); it
-- powers the "Following" view, the order of Crew Stories, suggestions, and a
-- one-time "followed you" in the bell (never a push). Reads and writes only go
-- through the functions below (main-account and block aware): the tables have
-- RLS on and no policies.
--
CREATE TABLE IF NOT EXISTS public.community_follows (
  follower_id uuid NOT NULL,
  followee_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT community_follows_not_self CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS community_follows_followee_idx ON public.community_follows (followee_id, created_at DESC);
ALTER TABLE public.community_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_follows FROM anon, authenticated;


-- In the crew: an active client with app access, or staff.
CREATE OR REPLACE FUNCTION public.community_is_member(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.user_id = _user_id AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
                    AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false)
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role IN ('admin', 'coach'))
$$;

-- Who I follow and who follows me (members only; followers I've blocked are left out).
CREATE OR REPLACE FUNCTION public.community_follow_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN
    RETURN jsonb_build_object('following', '[]'::jsonb, 'followers', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'following', coalesce((SELECT jsonb_agg(f.followee_id ORDER BY f.created_at DESC) FROM public.community_follows f
                            WHERE f.follower_id = v_me AND public.community_is_member(f.followee_id)), '[]'::jsonb),
    'followers', coalesce((SELECT jsonb_agg(f.follower_id ORDER BY f.created_at DESC) FROM public.community_follows f
                            WHERE f.followee_id = v_me AND public.community_is_member(f.follower_id)
                              AND NOT public.chat_has_blocked(v_me, f.follower_id)), '[]'::jsonb));
END;
$$;

-- Follow (true) / unfollow (false). Never reveals a block: a blocked follow is
-- stored like any other, it just never notifies and the blocker never sees it.
-- "Followed you" goes to the bell once per pair, ever (re-following never pings again).
CREATE OR REPLACE FUNCTION public.community_follow(_user_id uuid, _on boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_them uuid := public.community_main_account(_user_id);
  v_rows int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_them IS NULL OR v_them = v_me OR NOT public.community_is_member(v_them) THEN
    RAISE EXCEPTION 'That account isn''t in the crew' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_on, true) THEN
    INSERT INTO public.community_follows (follower_id, followee_id) VALUES (v_me, v_them) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 AND NOT EXISTS (SELECT 1 FROM public.community_notifications n
                                   WHERE n.kind = 'follow' AND n.recipient_user_id = v_them AND n.actor_user_id = v_me) THEN
      PERFORM public.community_notify(v_them, v_me, 'follow', NULL, NULL, NULL);
    END IF;
  ELSE
    DELETE FROM public.community_follows WHERE follower_id = v_me AND followee_id = v_them;
  END IF;
  RETURN public.community_follow_state();
END;
$$;

-- Notifications: a follow has no post.
ALTER TABLE public.community_notifications ALTER COLUMN post_id DROP NOT NULL;
ALTER TABLE public.community_notifications DROP CONSTRAINT IF EXISTS community_notifications_kind_check;
ALTER TABLE public.community_notifications ADD CONSTRAINT community_notifications_kind_check
  CHECK (kind = ANY (ARRAY['reaction'::text, 'comment'::text, 'reply'::text, 'comment_like'::text, 'follow'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS community_notifications_follow_uq
  ON public.community_notifications (recipient_user_id, actor_user_id) WHERE kind = 'follow';

-- The bell: as before, plus "X started following you" (anchored on the person).
CREATE OR REPLACE FUNCTION public.community_my_notifications()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RETURN '[]'::jsonb; END IF;
  WITH n AS (
    SELECT n.*,
           CASE n.kind WHEN 'reaction' THEN 'r:' || n.post_id WHEN 'comment_like' THEN 'l:' || n.comment_id
                       WHEN 'follow' THEN 'f:' || n.actor_user_id ELSE 'c:' || n.comment_id END AS gkey,
           CASE WHEN n.kind = 'reaction' THEN n.post_id WHEN n.kind = 'follow' THEN n.actor_user_id ELSE n.comment_id END AS anchor
      FROM public.community_notifications n
      LEFT JOIN public.community_posts p ON p.id = n.post_id
      LEFT JOIN public.community_comments c ON c.id = n.comment_id
     WHERE n.recipient_user_id = v_me
       AND n.created_at > now() - interval '30 days'
       AND (CASE WHEN n.kind = 'follow'
                 THEN public.community_is_member(n.actor_user_id) AND NOT public.chat_has_blocked(v_me, n.actor_user_id)
                 ELSE p.id IS NOT NULL AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id) END)
       AND (n.comment_id IS NULL OR c.hidden_at IS NULL)
  ), g AS (
    SELECT n.gkey,
           min(n.kind) AS kind,
           (array_agg(n.anchor))[1] AS anchor,
           (array_agg(n.post_id))[1] AS post_id,
           (array_agg(n.comment_id))[1] AS comment_id,
           count(*) AS cnt,
           max(n.created_at) AS latest,
           (array_agg(n.actor_user_id ORDER BY n.created_at DESC))[1:3] AS actors,
           array_agg(DISTINCT n.emoji) FILTER (WHERE n.emoji IS NOT NULL) AS emojis
      FROM n GROUP BY n.gkey
     ORDER BY max(n.created_at) DESC
     LIMIT 60
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', g.gkey, 'kind', g.kind, 'anchor', g.anchor, 'post_id', g.post_id, 'comment_id', g.comment_id,
      'count', g.cnt, 'at', g.latest,
      'actors', (SELECT jsonb_agg(public.community_author(u.a) ORDER BY u.o) FROM unnest(g.actors) WITH ORDINALITY u(a, o)),
      'emojis', coalesce(to_jsonb(g.emojis), '[]'::jsonb),
      'snippet', (SELECT left(c.body, 90) FROM public.community_comments c WHERE c.id = g.comment_id),
      'media_type', (SELECT c.media_type FROM public.community_comments c WHERE c.id = g.comment_id),
      'win', nullif(p.win_label, ''),
      'post_kind', CASE WHEN p.kind = 'note' THEN 'post' WHEN p.locked_in_at IS NOT NULL THEN 'lockin' WHEN p.completion_id IS NOT NULL THEN 'workout' ELSE 'post' END
    ) ORDER BY g.latest DESC), '[]'::jsonb)
    INTO v_out
    FROM g LEFT JOIN public.community_posts p ON p.id = g.post_id;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.community_is_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_follow_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_follow(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_follow_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_follow(uuid, boolean) TO authenticated;

-- (An earlier draft of this file also made server-side Stories; Crew Stories
-- come from the feed itself, so those were never used and are gone.)
DROP FUNCTION IF EXISTS public.community_stories();
DROP FUNCTION IF EXISTS public.community_story_seen(text[]);
DROP TABLE IF EXISTS public.community_story_views;
