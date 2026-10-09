-- The coach's view of the community in one call: how many clients looked at
-- it this week, how they engaged, what needs the coach (comments with no
-- reply, shared workouts with no props, a birthday draft to review), who
-- hasn't looked in a while, the post that landed best, and what goes out
-- next. Powers the dashboard card and the top of the Community page.
-- Coaches' own activity is never counted as the crew's.

CREATE OR REPLACE FUNCTION public.community_admin_pulse()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  c_time constant time[] := ARRAY[time '07:00', time '12:00', time '12:00', time '12:00', time '07:00', time '09:00', time '19:00'];
  v_since timestamptz := now() - interval '7 days';
  v_local timestamp := now() AT TIME ZONE tz;
  v_settings record;
  v_next jsonb;
  v_day date;
  v_series text;
  v_time time;
  v_roster jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;

  -- The next daily post that hasn't gone out yet (today's still counts until its window closes).
  IF NOT coalesce(v_settings.paused, false) THEN
    FOR i IN 0..7 LOOP
      v_day := v_local::date + i;
      v_series := c_days[extract(isodow FROM v_day)::int];
      v_time := c_time[extract(isodow FROM v_day)::int];
      CONTINUE WHEN i = 0 AND v_local::time >= CASE WHEN v_time >= time '19:00' THEN time '23:59:59' ELSE v_time + interval '5 hours' END;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_series || ':' || to_char(v_day, 'IYYY-"W"IW'));
      v_next := jsonb_build_object('series', v_series, 'at', (v_day + v_time) AT TIME ZONE tz);
      EXIT;
    END LOOP;
  END IF;

  -- Everyone in the community who isn't a coach, with when they last opened it.
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'client_id', r.id, 'seen_at', s.seen_at,
                                               'name', a.j->>'name', 'avatar_url', a.j->>'avatar_url')
                            ORDER BY s.seen_at ASC NULLS FIRST, a.j->>'name'), '[]'::jsonb)
    INTO v_roster
    FROM public.clients r
    LEFT JOIN public.community_seen s ON s.user_id = r.user_id
    CROSS JOIN LATERAL (SELECT public.community_author(r.user_id) AS j) a
   WHERE r.user_id IS NOT NULL
     AND coalesce(r.archived, false) = false AND r.archived_at IS NULL
     AND coalesce(r.status, '') <> 'Archived' AND coalesce(r.portal_access_disabled, false) = false
     AND NOT coalesce((a.j->>'is_coach')::boolean, false);

  RETURN jsonb_build_object(
    'roster', jsonb_array_length(v_roster),
    'opened', (SELECT count(*) FROM jsonb_array_elements(v_roster) x WHERE (x->>'seen_at')::timestamptz >= v_since),
    -- who hasn't looked this week, longest first (never opened at the top)
    'not_opened', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
                     SELECT x FROM jsonb_array_elements(v_roster) x
                      WHERE x->>'seen_at' IS NULL OR (x->>'seen_at')::timestamptz < v_since LIMIT 30) z),
    'client_posts', (SELECT count(*) FROM public.community_posts p
                      WHERE p.created_at >= v_since AND p.archived_at IS NULL AND NOT public.community_is_coach(p.author_user_id)),
    'reactions', (SELECT count(*) FROM public.community_reactions r
                   WHERE r.created_at >= v_since AND NOT public.community_is_coach(r.user_id)),
    'comments', (SELECT count(*) FROM public.community_comments c
                  WHERE c.created_at >= v_since AND NOT public.community_is_coach(c.author_user_id)),
    -- shared workouts nobody from the coaching side has reacted to or commented on
    'waiting_props', (SELECT count(*) FROM public.community_posts p
                       WHERE p.created_at >= v_since AND p.archived_at IS NULL AND p.kind = 'workout'
                         AND NOT public.community_is_coach(p.author_user_id)
                         AND NOT EXISTS (SELECT 1 FROM public.community_reactions r WHERE r.post_id = p.id AND public.community_is_coach(r.user_id))
                         AND NOT EXISTS (SELECT 1 FROM public.community_comments c WHERE c.post_id = p.id AND public.community_is_coach(c.author_user_id))),
    -- client comments (last 2 weeks) with no coach comment after them on that post
    'to_reply', (SELECT coalesce(jsonb_agg(jsonb_build_object('post_id', c.post_id, 'comment_id', c.id, 'created_at', c.created_at,
                                                              'body', left(c.body, 140), 'name', public.community_author(c.author_user_id)->>'name',
                                                              'avatar_url', public.community_author(c.author_user_id)->>'avatar_url')
                                          ORDER BY c.created_at DESC), '[]'::jsonb)
                   FROM (SELECT c.* FROM public.community_comments c
                          JOIN public.community_posts p ON p.id = c.post_id AND p.archived_at IS NULL
                         WHERE c.created_at >= now() - interval '14 days'
                           AND NOT public.community_is_coach(c.author_user_id)
                           AND NOT EXISTS (SELECT 1 FROM public.community_comments k
                                            WHERE k.post_id = c.post_id AND k.created_at > c.created_at AND public.community_is_coach(k.author_user_id))
                         ORDER BY c.created_at DESC LIMIT 10) c),
    -- the post the crew engaged with most this week
    'top_post', (SELECT jsonb_build_object('post_id', p.id, 'series', p.series, 'name', public.community_author(p.author_user_id)->>'name',
                                           'line', left(split_part(coalesce(p.caption, ''), E'\n', 1), 90), 'reactions', p.re, 'comments', p.co)
                   FROM (SELECT p.*, (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = p.id) AS re,
                                     (SELECT count(*) FROM public.community_comments c WHERE c.post_id = p.id) AS co
                           FROM public.community_posts p
                          WHERE p.created_at >= v_since AND p.archived_at IS NULL AND p.visibility = 'community') p
                  WHERE p.re + p.co > 0
                  ORDER BY p.re + p.co DESC, p.created_at DESC LIMIT 1),
    'paused', coalesce(v_settings.paused, false),
    'next', v_next,
    -- birthday posts: drafts waiting on the coach, and the next one going out
    'birthday_review', (SELECT count(*) FROM public.community_birthday_posts b WHERE b.status = 'ready' AND b.birthday >= current_date - 1),
    'birthday_next', (SELECT jsonb_build_object('id', b.id, 'status', b.status, 'post_at', b.post_at, 'birthday', b.birthday,
                                                'name', coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''), split_part(c.full_name, ' ', 1)))
                        FROM public.community_birthday_posts b JOIN public.clients c ON c.id = b.client_id
                       WHERE b.status IN ('ready', 'scheduled') AND b.post_at >= now() - interval '1 day'
                       ORDER BY b.post_at LIMIT 1));
END;
$$;
REVOKE ALL ON FUNCTION public.community_admin_pulse() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_admin_pulse() TO authenticated;
