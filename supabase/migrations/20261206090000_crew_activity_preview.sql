-- Crew's notification bubble: when someone opens the app with activity they
-- haven't been shown yet, a small bubble rises from the heart with what's new
-- (likes, comments, follows), then folds back into a red dot.
--
-- "Shown yet" is kept on the server, one row per login in notification_state
-- (kind 'crew_preview', source_id 'activity', read_at = when the bubble last
-- showed), written with the existing notif_mark_read. So it never replays on
-- another phone, and nothing new is fetched to know it: every line of
-- community_my_notifications now carries `fresh`, how many of its
-- notifications came after both that preview and the line's own read time.
-- The bubble shows when any unread line has fresh > 0.
CREATE OR REPLACE FUNCTION public.community_my_notifications()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_previewed timestamptz := (SELECT s.read_at FROM public.notification_state s
                               WHERE s.user_id = auth.uid() AND s.kind = 'crew_preview' AND s.source_id = 'activity');
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RETURN '[]'::jsonb; END IF;
  WITH n AS (
    SELECT n.*,
           CASE n.kind WHEN 'reaction' THEN 'r:' || n.post_id WHEN 'comment_like' THEN 'l:' || n.comment_id
                       WHEN 'follow_request' THEN 'q:' || n.actor_user_id WHEN 'follow' THEN 'f:' || n.actor_user_id ELSE 'c:' || n.comment_id END AS gkey,
           CASE WHEN n.kind = 'reaction' THEN n.post_id WHEN n.kind IN ('follow', 'follow_request') THEN n.actor_user_id ELSE n.comment_id END AS anchor
      FROM public.community_notifications n
      LEFT JOIN public.community_posts p ON p.id = n.post_id
      LEFT JOIN public.community_comments c ON c.id = n.comment_id
     WHERE n.recipient_user_id = v_me
       AND n.created_at > now() - interval '30 days'
       AND (CASE WHEN n.kind IN ('follow', 'follow_request')
                 THEN public.community_is_member(n.actor_user_id) AND NOT public.chat_has_blocked(v_me, n.actor_user_id)
                      AND (n.kind = 'follow' OR EXISTS (SELECT 1 FROM public.community_follow_requests fr
                                                          WHERE fr.requester_id = n.actor_user_id AND fr.target_id = v_me))
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
  ), f AS (
    -- new since the last bubble and since this line was last read
    SELECT g.gkey, count(x.*) AS fresh
      FROM g
      LEFT JOIN public.notification_state rs
        ON rs.user_id = auth.uid() AND rs.kind = 'community' AND rs.source_id = g.anchor::text
      LEFT JOIN n x
        ON x.gkey = g.gkey
       AND x.created_at > greatest(coalesce(v_previewed, '-infinity'::timestamptz), coalesce(rs.read_at, '-infinity'::timestamptz))
     GROUP BY g.gkey
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', g.gkey, 'kind', g.kind, 'anchor', g.anchor, 'post_id', g.post_id, 'comment_id', g.comment_id,
      'count', g.cnt, 'at', g.latest, 'fresh', coalesce(f.fresh, 0),
      'actors', (SELECT jsonb_agg(public.community_author(u.a) ORDER BY u.o) FROM unnest(g.actors) WITH ORDINALITY u(a, o)),
      'emojis', coalesce(to_jsonb(g.emojis), '[]'::jsonb),
      'snippet', (SELECT left(c.body, 90) FROM public.community_comments c WHERE c.id = g.comment_id),
      'media_type', (SELECT c.media_type FROM public.community_comments c WHERE c.id = g.comment_id),
      'win', nullif(p.win_label, ''),
      'post_thumb', coalesce(p.media_thumb_path, CASE WHEN p.media_type = 'image' THEN p.media_path END),
      'post_media', p.media_type,
      'post_text', CASE WHEN p.media_path IS NULL AND p.kind = 'note' THEN nullif(left(btrim(coalesce(p.caption, '')), 40), '') END,
      'post_kind', CASE WHEN p.kind = 'note' THEN 'post' WHEN p.locked_in_at IS NOT NULL THEN 'lockin' WHEN p.completion_id IS NOT NULL THEN 'workout' ELSE 'post' END
    ) ORDER BY g.latest DESC), '[]'::jsonb)
    INTO v_out
    FROM g
    LEFT JOIN f ON f.gkey = g.gkey
    LEFT JOIN public.community_posts p ON p.id = g.post_id;
  RETURN v_out;
END;
$function$;
