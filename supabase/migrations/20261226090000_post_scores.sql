-- Post scores: how well each feed post did at keeping the crew interested,
-- for coaches only, from what's already recorded (views, likes, comments,
-- saves, shares, reposts, poll and sticker answers) plus attention from now
-- on (time on the post, coming on screen, leaving Crew with it on screen).
--
-- A post is scored against the coach's own other feed posts (last 120 days):
--   reach       people who saw it, out of the crew who were in Crew that week
--   engagement  likes 1, poll / sticker answers 1.5, comments 3, saves 4,
--               shares and reposts 4, per person who saw it (smoothed toward
--               the crew's average, so 1 like from 1 viewer isn't a hit)
--   attention   stopped on it (2s+), kept scrolling after it, time on it;
--               only once 3+ people's attention is recorded for the post
-- Each is ranked against the other posts (0 = the lowest, 1 = the highest);
-- the score is their weighted mix: reach 30, engagement 35, attention 35, or
-- reach 45, engagement 55 before attention is recorded. Coaches (and their
-- linked athlete logins, and the account posting as the coach) are never
-- counted: not as the audience, not as engagement. Automatic workout stories
-- (auto_shared) and stories aren't feed posts and aren't scored.
SET lock_timeout = '3s';

/** Everyone who is the coach side: staff logins, the athlete accounts they're linked to, and the account coach posts go out as. */
CREATE OR REPLACE FUNCTION public.community_staff_people()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH logins AS (SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach'))
  SELECT user_id FROM logins
  UNION SELECT cp.same_person_as FROM public.community_profiles cp WHERE cp.same_person_as IS NOT NULL AND cp.user_id IN (SELECT user_id FROM logins)
  UNION SELECT cp.user_id FROM public.community_profiles cp WHERE cp.same_person_as IN (SELECT user_id FROM logins)
  UNION SELECT s.author_user_id FROM public.community_series_settings s WHERE s.author_user_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.community_staff_people() FROM PUBLIC, anon, authenticated;

/* ---- attention: time on a post, coming on screen, leaving with it there ---- */

CREATE TABLE IF NOT EXISTS public.community_post_attention (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL,
  -- time at least half of it was on screen, the app showing
  seen_ms integer NOT NULL DEFAULT 0 CHECK (seen_ms >= 0),
  -- times it came (at least half) on screen
  shows integer NOT NULL DEFAULT 0 CHECK (shows >= 0),
  -- times Crew closed (or the app went to the background) with it on screen
  exits integer NOT NULL DEFAULT 0 CHECK (exits >= 0),
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, viewer_user_id)
);
ALTER TABLE public.community_post_attention ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_post_attention FROM PUBLIC, anon, authenticated;

/**
 * Add what's new from the app (a running tally, sent batched): per post,
 * {post_id, ms, shows, exits}. Your own posts, posts you can't see and
 * coaches' attention are never kept; each send is capped so nothing silly
 * lands.
 */
CREATE OR REPLACE FUNCTION public.community_attention_add(_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
  n integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' OR NOT public.can_view_community() THEN RETURN 0; END IF;
  v_me := public.community_main_account(uid);
  IF uid IN (SELECT public.community_staff_people()) OR v_me IN (SELECT public.community_staff_people()) THEN RETURN 0; END IF;
  INSERT INTO public.community_post_attention AS a (post_id, viewer_user_id, seen_ms, shows, exits)
  SELECT p.id, v_me, least(r.ms, 600000), least(r.shows, 50), least(r.exits, 5)
    FROM (
      SELECT (e->>'post_id')::uuid AS pid,
             sum(greatest(coalesce((e->>'ms')::numeric, 0), 0))::int AS ms,
             sum(greatest(coalesce((e->>'shows')::numeric, 0), 0))::int AS shows,
             sum(greatest(coalesce((e->>'exits')::numeric, 0), 0))::int AS exits
        FROM (SELECT e FROM jsonb_array_elements(_rows) e LIMIT 100) x
       WHERE e->>'post_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND coalesce(e->>'ms', '0') ~ '^[0-9]+(\.[0-9]+)?$'
         AND coalesce(e->>'shows', '0') ~ '^[0-9]+$'
         AND coalesce(e->>'exits', '0') ~ '^[0-9]+$'
       GROUP BY 1
    ) r
    JOIN public.community_posts p ON p.id = r.pid
   WHERE p.archived_at IS NULL
     AND p.author_user_id IS DISTINCT FROM v_me
     AND (r.ms > 0 OR r.shows > 0 OR r.exits > 0)
     AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
  ON CONFLICT (post_id, viewer_user_id) DO UPDATE
     SET seen_ms = least(a.seen_ms + EXCLUDED.seen_ms, 36000000),
         shows = least(a.shows + EXCLUDED.shows, 100000),
         exits = least(a.exits + EXCLUDED.exits, 100000),
         last_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_attention_add(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_attention_add(jsonb) TO authenticated, service_role;

/* ---- the score ---------------------------------------------------------- */

/**
 * Feed posts' scores, for coaches: `_post_ids` for the feed's chips (null:
 * every feed post in the window, for the board). Every post is ranked against
 * all the feed posts in the window, so a chip and the board always agree.
 */
CREATE OR REPLACE FUNCTION public.community_post_scores(_post_ids uuid[] DEFAULT NULL, _days integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_days integer := least(greatest(coalesce(_days, 120), 7), 365);
  v_out jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH staff AS (
    SELECT s AS user_id FROM public.community_staff_people() s WHERE s IS NOT NULL
  ), posts AS (
    SELECT p.id, p.author_user_id, p.created_at, p.kind, p.series, p.series_data, p.caption, p.quote, p.media_type,
           p.author_user_id IN (SELECT user_id FROM staff) AS by_coach
      FROM public.community_posts p
     WHERE p.archived_at IS NULL AND NOT coalesce(p.story_only, false) AND NOT coalesce(p.auto_shared, false)
       AND (p.created_at > now() - make_interval(days => v_days) OR p.id = ANY (coalesce(_post_ids, '{}')))
  ), cv AS (
    -- the crew's views (never a coach's)
    SELECT v.post_id, v.viewer_user_id, v.viewed_at
      FROM public.community_post_views v
     WHERE v.viewer_user_id NOT IN (SELECT user_id FROM staff)
       AND v.viewed_at > now() - make_interval(days => v_days + 7)
  ), aud AS (
    -- who was in Crew in the week after it went up (seeing anything there)
    SELECT p.id, count(DISTINCT cv.viewer_user_id) AS n
      FROM posts p
      JOIN cv ON cv.viewed_at >= p.created_at AND cv.viewed_at < p.created_at + interval '7 days' AND cv.viewer_user_id <> p.author_user_id
     GROUP BY p.id
  ), m AS (
    SELECT p.*,
           coalesce(a.n, 0) AS audience,
           (SELECT count(*) FROM cv WHERE cv.post_id = p.id AND cv.viewer_user_id <> p.author_user_id) AS viewers,
           (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r
             WHERE r.post_id = p.id AND r.user_id <> p.author_user_id AND r.user_id NOT IN (SELECT user_id FROM staff)) AS reactors,
           (SELECT count(DISTINCT c.author_user_id) FROM public.community_comments c
             WHERE c.post_id = p.id AND c.hidden_at IS NULL AND c.author_user_id <> p.author_user_id AND c.author_user_id NOT IN (SELECT user_id FROM staff)) AS commenters,
           (SELECT count(DISTINCT s.user_id) FROM public.community_saves s
             WHERE s.post_id = p.id AND s.user_id <> p.author_user_id AND s.user_id NOT IN (SELECT user_id FROM staff)) AS savers,
           (SELECT count(DISTINCT x.u) FROM (
               SELECT sp.author_user_id AS u FROM public.community_posts sp WHERE sp.shared_post_id = p.id AND sp.archived_at IS NULL
               UNION SELECT rp.user_id FROM public.community_reposts rp WHERE rp.post_id = p.id
             ) x WHERE x.u <> p.author_user_id AND x.u NOT IN (SELECT user_id FROM staff)) AS sharers,
           (SELECT count(DISTINCT x.u) FROM (
               SELECT pv.user_id AS u FROM public.community_poll_votes pv WHERE pv.post_id = p.id
               UNION SELECT sa.user_id FROM public.community_sticker_answers sa WHERE sa.post_id = p.id
             ) x WHERE x.u <> p.author_user_id AND x.u NOT IN (SELECT user_id FROM staff)) AS voters,
           (SELECT count(DISTINCT x.u) FROM (
               SELECT r.user_id AS u FROM public.community_reactions r WHERE r.post_id = p.id
               UNION SELECT c.author_user_id FROM public.community_comments c WHERE c.post_id = p.id AND c.hidden_at IS NULL
               UNION SELECT s.user_id FROM public.community_saves s WHERE s.post_id = p.id
               UNION SELECT sp.author_user_id FROM public.community_posts sp WHERE sp.shared_post_id = p.id AND sp.archived_at IS NULL
               UNION SELECT rp.user_id FROM public.community_reposts rp WHERE rp.post_id = p.id
               UNION SELECT pv.user_id FROM public.community_poll_votes pv WHERE pv.post_id = p.id
               UNION SELECT sa.user_id FROM public.community_sticker_answers sa WHERE sa.post_id = p.id
             ) x WHERE x.u <> p.author_user_id AND x.u NOT IN (SELECT user_id FROM staff)) AS engaged,
           att.reached, att.stopped, att.kept, att.median_ms
      FROM posts p
      LEFT JOIN aud a ON a.id = p.id
      LEFT JOIN LATERAL (
        SELECT count(*) AS reached,
               count(*) FILTER (WHERE x.seen_ms >= 2000) AS stopped,
               count(*) FILTER (WHERE x.exits = 0) AS kept,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY x.seen_ms) AS median_ms
          FROM public.community_post_attention x
         WHERE x.post_id = p.id AND x.viewer_user_id NOT IN (SELECT user_id FROM staff)
      ) att ON true
  ), w AS (
    SELECT m.*,
           (m.reactors * 1 + m.voters * 1.5 + m.commenters * 3 + m.savers * 4 + m.sharers * 4)::numeric AS points,
           greatest(m.viewers, m.engaged) AS seen_by
      FROM m
  ), prior AS (
    SELECT coalesce(sum(points) / nullif(sum(seen_by), 0), 0) AS rate FROM w
  ), r AS (
    SELECT w.*,
           CASE WHEN w.audience > 0 THEN least(1, w.viewers::numeric / greatest(w.audience, w.viewers)) END AS reach,
           (w.points + prior.rate * 5) / (w.seen_by + 5) AS rate,
           CASE WHEN w.reached >= 3 THEN
             0.4 * (w.stopped::numeric / w.reached) + 0.3 * (w.kept::numeric / w.reached) + 0.3 * least(coalesce(w.median_ms, 0) / 8000.0, 1)
           END AS hold
      FROM w, prior
  ), ranked AS (
    SELECT r.*,
           CASE WHEN r.reach IS NOT NULL THEN percent_rank() OVER (PARTITION BY r.reach IS NULL ORDER BY r.reach) END AS pr_reach,
           percent_rank() OVER (ORDER BY r.rate) AS pr_rate,
           CASE WHEN r.hold IS NOT NULL THEN percent_rank() OVER (PARTITION BY r.hold IS NULL ORDER BY r.hold) END AS pr_hold
      FROM r
  ), scored AS (
    SELECT ranked.*,
           round(100 * CASE
             WHEN pr_hold IS NOT NULL AND pr_reach IS NOT NULL THEN 0.30 * pr_reach + 0.35 * pr_rate + 0.35 * pr_hold
             WHEN pr_hold IS NOT NULL THEN 0.5 * pr_rate + 0.5 * pr_hold
             WHEN pr_reach IS NOT NULL THEN 0.45 * pr_reach + 0.55 * pr_rate
             ELSE pr_rate
           END)::int AS score,
           CASE
             WHEN series = 'lesson' THEN 'lesson:' || coalesce(series_data->>'track', '')
             WHEN series IS NOT NULL THEN series
             WHEN by_coach THEN 'coach'
             WHEN kind = 'workout' THEN 'member_workout'
             ELSE 'member_post'
           END AS kind_key
      FROM ranked
  ), final AS (
    SELECT scored.*, round(avg(score) OVER (PARTITION BY kind_key))::int AS kind_avg, count(*) OVER (PARTITION BY kind_key) AS kind_n,
           count(*) OVER () AS total
      FROM scored
  )
  SELECT jsonb_build_object(
           'days', v_days,
           'total', (SELECT count(*) FROM final),
           'attention_since', (SELECT min(first_at) FROM public.community_post_attention),
           'posts', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'post_id', o.id,
                      'created_at', o.created_at,
                      'kind_key', o.kind_key,
                      'by_coach', o.by_coach,
                      'author_name', split_part(btrim(coalesce(public.community_author(o.author_user_id)->>'name', '')), ' ', 1),
                      'title', left(coalesce(nullif(o.series_data->>'title', ''), nullif(btrim(split_part(btrim(coalesce(o.caption, '')), E'\n', 1)), ''), o.quote, ''), 90),
                      'media_type', o.media_type,
                      'early', o.created_at > now() - interval '24 hours',
                      'score', o.score,
                      'audience', o.audience, 'viewers', o.viewers,
                      'reactors', o.reactors, 'commenters', o.commenters, 'savers', o.savers, 'sharers', o.sharers, 'voters', o.voters, 'engaged', o.engaged,
                      'reach', round(o.reach, 3), 'rate', round(o.rate, 3),
                      'attention', CASE WHEN coalesce(o.reached, 0) > 0 THEN jsonb_build_object(
                        'reached', o.reached, 'stopped', o.stopped, 'kept', o.kept, 'median_ms', round(o.median_ms)) END,
                      'pct', jsonb_build_object('reach', round(o.pr_reach::numeric, 3), 'engagement', round(o.pr_rate::numeric, 3), 'attention', round(o.pr_hold::numeric, 3)),
                      'kind_avg', o.kind_avg, 'kind_n', o.kind_n)
                    ORDER BY o.score DESC, o.created_at DESC)
               FROM final o
              WHERE _post_ids IS NULL OR o.id = ANY (_post_ids)), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_scores(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_scores(uuid[], integer) TO authenticated, service_role;
