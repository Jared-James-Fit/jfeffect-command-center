-- Crew's Following tab, read on the server (Nov 17 2026).
--
-- The Crew feed has two looks, TikTok's: Crew (everyone) and Following (the
-- people you follow, what they repost, and you). Following used to filter the
-- crew's ranked pages on the phone, so someone following two people who rarely
-- post read page after page of everyone else's posts to find theirs.
-- community_feed_ranked now takes `_following`: the same feed (the same
-- moment, ranking, visibility, blocks and paging) narrowed to people's own
-- posts (never an automated one: a lesson, the daily series, Wins, the Recap,
-- a holiday, a birthday post; the app's `isAutoPost`) that are yours, by
-- someone you follow, a collab with someone you follow
-- (`community_post_collab_ids`), or reposted by you or someone you follow
-- (the app's `inFollowingFeed`). The automated posts stay Crew's: 50 of the 84
-- feed posts were automated and 13 of the 14 people who follow anyone follow
-- the coach, so with them Following was the Crew feed less a few posts. It
-- defaults to false, so every app already installed calls the crew feed
-- exactly as before.
--
-- The function body is the live one (20270131090000_feed_new_first.sql and
-- what followed it), with only `v_following`, the `followed_collabs` CTE and
-- the `_following` condition on `cand` added. Adding a parameter changes the signature, so the
-- old one is dropped first (CREATE OR REPLACE would leave two functions and
-- PostgREST couldn't tell which to call).

DROP FUNCTION IF EXISTS public.community_feed_ranked(integer, jsonb, timestamptz);

CREATE OR REPLACE FUNCTION public.community_feed_ranked(
  _limit integer DEFAULT 5,
  _cursor jsonb DEFAULT NULL,
  _seen_before timestamptz DEFAULT NULL,
  _following boolean DEFAULT false
)
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
  v_following boolean := coalesce(_following, false);
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
  -- Following only: posts someone you follow is a collaborator on (the app's `collaborators`)
  followed_collabs AS (
    SELECT DISTINCT m.post_id
      FROM public.community_post_mentions m
     WHERE v_following
       AND m.removed_at IS NULL
       AND m.user_id IN (SELECT id FROM followed)
       AND m.user_id = ANY (public.community_post_collab_ids(m.post_id))
  ),
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
       -- Following: people's own posts (no automated ones), yours, someone you follow's, a collab
       -- with them, or reposted by you or them
       AND (NOT v_following
            OR (p.series IS NULL AND p.series_data -> 'birthday' IS NULL
                AND (p.author_user_id IN (uid, v_me)
                     OR p.author_user_id IN (SELECT id FROM followed)
                     OR p.id IN (SELECT post_id FROM followed_collabs)
                     OR p.id IN (SELECT sr.post_id FROM seen_reposts sr
                                  WHERE sr.user_id = v_me OR sr.user_id IN (SELECT id FROM followed)))))
  ),
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
               - greatest(extract(epoch FROM (v_seen - m.at)), 0) / 86400.0
               + CASE WHEN m.author_user_id IN (uid, v_me) THEN 3 ELSE 0 END
               + CASE WHEN m.series IS NULL THEN 1 ELSE 0 END
               + CASE WHEN m.series IS NULL AND m.author_user_id NOT IN (uid, v_me)
                           AND (m.author_user_id IN (SELECT id FROM followed) OR m.author_user_id IN (SELECT id FROM fans)) THEN 1 ELSE 0 END
               + CASE WHEN m.series IN ('wednesday_wins', 'sunday_recap') THEN 0.5 WHEN m.series = 'daily_visual' THEN 0.25 ELSE 0 END
               + 0.4 * ln(1
                   + (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r
                       WHERE r.post_id = m.id AND r.created_at < v_seen AND r.user_id NOT IN (uid, v_me))
                   + 2 * (SELECT count(*) FROM public.community_comments cm
                           WHERE cm.post_id = m.id AND cm.hidden_at IS NULL AND cm.created_at < v_seen AND cm.author_user_id NOT IN (uid, v_me)))
             )::numeric, 4) END AS score
      FROM marked m
  ),
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
    v_next := jsonb_build_object('phase', 'rest', 'seen_before', v_seen);
  END IF;

  RETURN jsonb_build_object(
    'posts', coalesce((
      SELECT jsonb_agg(public.community_post_json((e->>'id')::uuid, uid)
                       || jsonb_build_object(
                            'feed_at', e->'at',
                            'fresh', e->'fresh',
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

REVOKE ALL ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz, boolean) TO authenticated, service_role;
