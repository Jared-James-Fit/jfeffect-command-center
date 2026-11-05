-- The Crew feed leads with what's new to you (community.ts `feedCursorOf`,
-- community.queries.ts `useRankedFeed`).
--
-- The feed was newest first. A visit reads about one post (63% of visits see
-- one new post, under 3 in 10 reach the third), so anything that slid below a
-- post you'd already seen was never seen: over the 14 days to Nov 5 there
-- were 41 feed posts, 8 of them by members, and most people missed most of
-- those 8 under the coach's automated posts.
--
-- community_feed_ranked pages the feed in two parts, against one moment
-- (`seen_before`: when this visit started, sent by the app and carried in the
-- cursor so every page and every refetch of the visit agrees):
--   1. new to you: posts from the last 7 days you hadn't seen before that
--      moment (community_post_views, the first time a post was on your
--      screen), and your own posts from the last 12 hours, ranked: newer
--      first (a point a day), a post someone wrote (not an automated one) up
--      a point and another if you follow each other either way, Wins and the
--      Recap (they name the crew) up half, today's daily picture a quarter,
--      what the crew liked and commented before the moment (log), and your
--      own just-made post on top;
--   2. everything else, newest first (by where a repost put it), after the
--      "You're all caught up" line.
-- Story-only posts and Pulses (auto_shared) are never in it (they're the story
-- rail's, which keeps reading community_feed). Visibility, blocks and
-- reposts are community_feed's exactly. community_feed itself is unchanged,
-- so older builds, the story rail, Home's deck and profiles read as before.

CREATE OR REPLACE FUNCTION public.community_feed_ranked(_limit integer DEFAULT 5, _cursor jsonb DEFAULT NULL, _seen_before timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_staff boolean := public.community_is_staff(auth.uid());
  lim int := least(greatest(coalesce(_limit, 5), 1), 30);
  v_seen timestamptz := least(coalesce(nullif(_cursor->>'seen_before', '')::timestamptz, _seen_before, now()), now());
  v_phase text := CASE WHEN _cursor->>'phase' = 'rest' THEN 'rest' ELSE 'fresh' END;
  v_score numeric := nullif(_cursor->>'score', '')::numeric;
  v_at timestamptz := nullif(_cursor->>'at', '')::timestamptz;
  v_id uuid := coalesce(nullif(_cursor->>'id', '')::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
  v_rows jsonb;
  v_fresh_total int;
  v_rest boolean;
  v_n int;
  v_last jsonb;
  v_next jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;

  WITH blocked AS (SELECT public.community_blocked_authors() AS id),
  followed AS (SELECT public.community_followed_authors() AS id),
  fans AS (SELECT f.follower_id AS id FROM public.community_follows f WHERE f.followee_id = v_me),
  -- reposts this viewer may see: community_feed's rule exactly
  seen_reposts AS (
    SELECT r.user_id, r.post_id, r.created_at
      FROM public.community_reposts r
      JOIN public.community_posts rp ON rp.id = r.post_id
      LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
     WHERE (v_staff OR r.user_id NOT IN (SELECT id FROM blocked))
       AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT id FROM followed))
       AND NOT public.chat_has_blocked(rp.author_user_id, r.user_id)
       AND NOT public.chat_has_blocked(r.user_id, rp.author_user_id)
       AND public.community_is_member(r.user_id)
  ),
  bumped AS (SELECT sr.post_id, max(sr.created_at) AS at FROM seen_reposts sr GROUP BY sr.post_id),
  -- the feed's posts (never a story or a Pulse), visibility and blocks as community_feed
  cand AS (
    SELECT p.id, p.author_user_id, p.series, greatest(p.created_at, coalesce(b.at, p.created_at)) AS at
      FROM public.community_posts p
      LEFT JOIN bumped b ON b.post_id = p.id
     WHERE (p.visibility = 'community'
            OR (p.visibility = 'coach' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
            OR (p.visibility = 'followers' AND (p.author_user_id = uid OR v_staff OR p.author_user_id IN (SELECT id FROM followed)))
            OR (p.visibility = 'close_friends' AND (p.author_user_id = uid OR v_staff
                                                    OR p.author_user_id IN (SELECT public.community_close_friend_authors()))))
       AND p.archived_at IS NULL
       AND NOT p.story_only
       AND NOT coalesce(p.auto_shared, false)
       AND (v_staff OR p.author_user_id NOT IN (SELECT id FROM blocked))
  ),
  -- new to you: the last 7 days, not on your screen before the moment; your own from the last 12 hours
  marked AS (
    SELECT c.*,
           CASE WHEN c.author_user_id IN (uid, v_me) THEN c.at > v_seen - interval '12 hours'
                ELSE c.at > v_seen - interval '7 days'
                     AND NOT EXISTS (SELECT 1 FROM public.community_post_views v
                                      WHERE v.post_id = c.id AND v.viewer_user_id = v_me AND v.viewed_at < v_seen)
           END AS fresh
      FROM cand c
  ),
  scored AS (
    SELECT m.id, m.at, m.fresh, m.author_user_id,
           CASE WHEN m.fresh THEN round((
               -- newer first: a point a day (one made after the moment counts as brand new)
               - greatest(extract(epoch FROM (v_seen - m.at)), 0) / 86400.0
               -- the post you just made leads
               + CASE WHEN m.author_user_id IN (uid, v_me) THEN 3 ELSE 0 END
               -- someone's own post over an automated one, more so when you follow each other either way
               + CASE WHEN m.series IS NULL THEN 1 ELSE 0 END
               + CASE WHEN m.series IS NULL AND m.author_user_id NOT IN (uid, v_me)
                           AND (m.author_user_id IN (SELECT id FROM followed) OR m.author_user_id IN (SELECT id FROM fans)) THEN 1 ELSE 0 END
               -- the posts that name the crew, and the morning's picture
               + CASE WHEN m.series IN ('wednesday_wins', 'sunday_recap') THEN 0.5 WHEN m.series = 'daily_visual' THEN 0.25 ELSE 0 END
               -- what the crew liked and talked about before the moment
               + 0.4 * ln(1
                   + (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r
                       WHERE r.post_id = m.id AND r.created_at < v_seen AND r.user_id NOT IN (uid, v_me))
                   + 2 * (SELECT count(*) FROM public.community_comments cm
                           WHERE cm.post_id = m.id AND cm.hidden_at IS NULL AND cm.created_at < v_seen AND cm.author_user_id NOT IN (uid, v_me)))
             )::numeric, 4) END AS score
      FROM marked m
  ),
  -- nothing new on the first page: straight to everything else
  phase AS (
    SELECT CASE WHEN v_phase = 'fresh' AND _cursor IS NULL AND NOT EXISTS (SELECT 1 FROM scored WHERE fresh) THEN 'rest' ELSE v_phase END AS ph
  ),
  pick AS (
    SELECT s.*, ph.ph FROM scored s CROSS JOIN phase ph
     WHERE CASE WHEN ph.ph = 'fresh' THEN s.fresh AND (v_score IS NULL OR (s.score, s.id) < (v_score, v_id))
                ELSE NOT s.fresh AND (v_at IS NULL OR (s.at, s.id) < (v_at, v_id)) END
     ORDER BY CASE WHEN ph.ph = 'fresh' THEN s.score END DESC NULLS LAST,
              CASE WHEN ph.ph = 'rest' THEN s.at END DESC NULLS LAST,
              s.id DESC
     LIMIT lim + 1
  )
  SELECT (SELECT count(*) FROM scored WHERE fresh),
         EXISTS (SELECT 1 FROM scored WHERE NOT fresh),
         (SELECT jsonb_agg(jsonb_build_object('id', k.id, 'at', k.at, 'fresh', k.fresh, 'score', k.score, 'author', k.author_user_id, 'phase', k.ph)
                           ORDER BY CASE WHEN k.ph = 'fresh' THEN k.score END DESC NULLS LAST,
                                    CASE WHEN k.ph = 'rest' THEN k.at END DESC NULLS LAST, k.id DESC)
            FROM pick k)
    INTO v_fresh_total, v_rest, v_rows;

  v_n := coalesce(jsonb_array_length(v_rows), 0);
  IF v_n > lim THEN
    v_last := v_rows->(lim - 1);
    v_next := CASE WHEN v_last->>'phase' = 'fresh'
                   THEN jsonb_build_object('phase', 'fresh', 'seen_before', v_seen, 'score', v_last->'score', 'id', v_last->'id')
                   ELSE jsonb_build_object('phase', 'rest', 'seen_before', v_seen, 'at', v_last->'at', 'id', v_last->'id') END;
  ELSIF coalesce(v_rows->0->>'phase', v_phase) = 'fresh' AND v_rest THEN
    -- the new posts are done: next comes everything else, from the top
    v_next := jsonb_build_object('phase', 'rest', 'seen_before', v_seen);
  END IF;

  RETURN jsonb_build_object(
    'posts', coalesce((
      SELECT jsonb_agg(public.community_post_json((e->>'id')::uuid, uid)
                       || jsonb_build_object(
                            'feed_at', e->'at',
                            'fresh', e->'fresh',
                            -- who reposted it, people you follow first, then you, then the newest (community_feed's)
                            'reposted_by', (SELECT jsonb_agg(public.community_author(x.user_id)
                                                             || jsonb_build_object('note', x.note, 'at', x.created_at, 'is_me', x.user_id = v_me)
                                                             ORDER BY x.rk, x.created_at DESC)
                                              FROM (SELECT r.user_id, r.note, r.created_at,
                                                           CASE WHEN r.user_id IN (SELECT public.community_followed_authors()) THEN 0 WHEN r.user_id = v_me THEN 1 ELSE 2 END AS rk
                                                      FROM public.community_reposts r
                                                      LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
                                                     WHERE r.post_id = (e->>'id')::uuid
                                                       AND (v_staff OR r.user_id NOT IN (SELECT public.community_blocked_authors()))
                                                       AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT public.community_followed_authors()))
                                                       AND NOT public.chat_has_blocked((e->>'author')::uuid, r.user_id)
                                                       AND NOT public.chat_has_blocked(r.user_id, (e->>'author')::uuid)
                                                       AND public.community_is_member(r.user_id)
                                                     ORDER BY rk, r.created_at DESC LIMIT 3) x),
                            'reposters_count', (SELECT count(*) FROM public.community_reposts r
                                                  LEFT JOIN public.community_profiles cp ON cp.user_id = r.user_id
                                                 WHERE r.post_id = (e->>'id')::uuid
                                                   AND (v_staff OR r.user_id NOT IN (SELECT public.community_blocked_authors()))
                                                   AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT public.community_followed_authors()))
                                                   AND NOT public.chat_has_blocked((e->>'author')::uuid, r.user_id)
                                                   AND NOT public.chat_has_blocked(r.user_id, (e->>'author')::uuid)
                                                   AND public.community_is_member(r.user_id)))
                       ORDER BY t.n)
        FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) WITH ORDINALITY t(e, n)
       WHERE t.n <= lim), '[]'::jsonb),
    'has_more', v_next IS NOT NULL,
    'cursor', v_next,
    'seen_before', v_seen,
    'fresh_total', CASE WHEN _cursor IS NULL THEN v_fresh_total END);
END;
$$;

REVOKE ALL ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz) TO authenticated;
