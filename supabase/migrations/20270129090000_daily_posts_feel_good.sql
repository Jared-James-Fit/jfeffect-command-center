-- Daily posts that make the crew glad they opened the app (daily-visuals.ts):
-- every day now has a content pillar (realization, humour, community,
-- insight, challenge), a crowd (beginners, lifestyle, serious lifters,
-- everyone) and a mood, all in its concept, and the learning counts what
-- people actually do with a post: a real comment (a reply, or more than a
-- few words) and a share (to a story, or a repost) count beside likes, saves
-- and stopping on it. Same access as before: the server only.

CREATE OR REPLACE FUNCTION public.community_daily_visual_stats(_days int DEFAULT 120)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH staff AS (SELECT s AS user_id FROM public.community_staff_people() s WHERE s IS NOT NULL)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day', v.day, 'theme', v.theme, 'audience', v.audience, 'style', v.style, 'format', v.format, 'topic', v.topic,
           'pillar', v.concept->>'pillar', 'crowd', v.concept->>'crowd', 'mood', v.concept->>'mood',
           'line', coalesce(nullif(btrim(v.coach_line), ''), v.ai_line, ''), 'shot', v.shot,
           'viewers', (SELECT count(DISTINCT pv.viewer_user_id) FROM public.community_post_views pv
                        WHERE pv.post_id = v.post_id AND pv.viewer_user_id NOT IN (SELECT user_id FROM staff)),
           'likers', (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r
                       WHERE r.post_id = v.post_id AND r.user_id NOT IN (SELECT user_id FROM staff)),
           'commenters', (SELECT count(DISTINCT c.author_user_id) FROM public.community_comments c
                           WHERE c.post_id = v.post_id AND c.hidden_at IS NULL AND c.author_user_id NOT IN (SELECT user_id FROM staff)),
           'meaningful', (SELECT count(DISTINCT c.author_user_id) FROM public.community_comments c
                           WHERE c.post_id = v.post_id AND c.hidden_at IS NULL AND c.author_user_id NOT IN (SELECT user_id FROM staff)
                             AND (c.parent_id IS NOT NULL OR array_length(regexp_split_to_array(btrim(coalesce(c.body, '')), '\s+'), 1) >= 5)),
           'savers', (SELECT count(DISTINCT s.user_id) FROM public.community_saves s
                       WHERE s.post_id = v.post_id AND s.user_id NOT IN (SELECT user_id FROM staff)),
           'sharers', (SELECT count(DISTINCT u) FROM (
                         SELECT rp.user_id AS u FROM public.community_reposts rp
                          WHERE rp.post_id = v.post_id AND rp.user_id NOT IN (SELECT user_id FROM staff)
                         UNION
                         SELECT sp.author_user_id FROM public.community_posts sp
                          WHERE sp.shared_post_id = v.post_id AND sp.author_user_id NOT IN (SELECT user_id FROM staff)) shared),
           'reached', (SELECT count(*) FROM public.community_post_attention x
                        WHERE x.post_id = v.post_id AND x.viewer_user_id NOT IN (SELECT user_id FROM staff)),
           'stopped', (SELECT count(*) FROM public.community_post_attention x
                        WHERE x.post_id = v.post_id AND x.seen_ms >= 2000 AND x.viewer_user_id NOT IN (SELECT user_id FROM staff)),
           'median_ms', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.seen_ms) FROM public.community_post_attention x
                          WHERE x.post_id = v.post_id AND x.viewer_user_id NOT IN (SELECT user_id FROM staff))
         ) ORDER BY v.day), '[]'::jsonb)
    FROM public.community_daily_visuals v
    JOIN public.community_posts p ON p.id = v.post_id AND p.archived_at IS NULL
   WHERE v.status = 'posted'
     AND v.day > (now() - make_interval(days => least(greatest(coalesce(_days, 120), 7), 365)))::date
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_stats(int) FROM PUBLIC, anon, authenticated;
