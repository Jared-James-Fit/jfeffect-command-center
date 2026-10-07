-- Wednesday Wins, round 3: a stats card anyone gets, and the voice tuned.
--
--   * week_stats adds the history the card needs: last week's tonnage, where
--     this week ranks against every week on record (tonnage and workouts),
--     weeks tracked, and workouts per week for the last 8 weeks.
--   * Copy: no "ur"/"u"; "yall" only in the hype intro for a monster week.

-- The crew's week in numbers, for the stats card under the post. Counts and
-- totals only, nobody singled out. Adds the history the card needs to say
-- something plain and impressive every week: tonnage the week before, where
-- this week ranks against every week on record, and workouts per week for
-- the last 8 weeks.
CREATE OR REPLACE FUNCTION public.community_week_stats(_week_start date, _exclude_user uuid, _wins jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_from timestamptz := (_week_start::timestamp AT TIME ZONE tz);
  v_to timestamptz := ((_week_start + 7)::timestamp AT TIME ZONE tz);
  v_roster uuid[];
  v_weeks jsonb;
BEGIN
  SELECT array_agg(cl.id) INTO v_roster FROM public.clients cl
   WHERE cl.user_id IS NOT NULL
     AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
     AND coalesce(cl.status, '') <> 'Archived'
     AND coalesce(cl.portal_access_disabled, false) = false
     AND cl.user_id IS DISTINCT FROM _exclude_user;

  -- every week on record up to this one: workouts and total weight lifted
  SELECT coalesce(jsonb_agg(jsonb_build_object('wk', wk, 'sessions', coalesce(n, 0), 'volume_kg', coalesce(vol, 0)) ORDER BY wk), '[]'::jsonb)
    INTO v_weeks
    FROM (
      SELECT coalesce(s.wk, v.wk) AS wk, s.n, v.vol
        FROM (SELECT date_trunc('week', pc.completed_at AT TIME ZONE tz)::date AS wk, count(*) AS n
                FROM public.pl_day_completions pc
               WHERE pc.client_id = ANY (v_roster) AND pc.completed_at IS NOT NULL AND pc.completed_at < v_to
               GROUP BY 1) s
        FULL JOIN (SELECT date_trunc('week', q.workout_at AT TIME ZONE tz)::date AS wk, round(sum(q.reps * q.load_kg)) AS vol
                     FROM unnest(v_roster) r(id) CROSS JOIN LATERAL public.client_qualifying_sets(r.id) q
                    WHERE q.completed AND q.workout_at < v_to
                    GROUP BY 1) v ON v.wk = s.wk
    ) h;

  RETURN jsonb_build_object(
    'week_of', _week_start,
    'roster', coalesce(array_length(v_roster, 1), 0),
    -- opened the app: signed in, or logged anything at all
    'opened', (SELECT count(DISTINCT x.id) FROM (
                 SELECT a.client_id AS id FROM public.client_activity_log a
                  WHERE a.action = 'signed_in' AND a.created_at >= v_from AND a.created_at < v_to AND a.client_id = ANY (v_roster)
                 UNION ALL
                 SELECT e.client_id FROM public.athlete_xp_events e
                  WHERE e.occurred_at >= v_from AND e.occurred_at < v_to AND e.client_id = ANY (v_roster)) x),
    'trained', jsonb_array_length(coalesce(_wins, '[]'::jsonb)),
    'sessions', (SELECT coalesce(sum((w->>'sessions')::int), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'sessions_prev', (SELECT count(*) FROM public.pl_day_completions pc
                       WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from - interval '7 days' AND pc.completed_at < v_from),
    'prs', (SELECT coalesce(sum((w->>'pr_lifts')::int), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'pr_people', (SELECT count(*) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w WHERE (w->>'pr_lifts')::int > 0),
    'volume_kg', (SELECT coalesce(sum((w->>'volume_kg')::numeric), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'volume_prev_kg', (SELECT coalesce((h->>'volume_kg')::numeric, 0) FROM jsonb_array_elements(v_weeks) h WHERE (h->>'wk')::date = _week_start - 7),
    -- 1 = the most weight the crew has lifted in any week on record
    'volume_rank', (SELECT 1 + count(*) FROM jsonb_array_elements(v_weeks) h
                     WHERE (h->>'wk')::date < _week_start
                       AND (h->>'volume_kg')::numeric > coalesce((SELECT (t->>'volume_kg')::numeric FROM jsonb_array_elements(v_weeks) t WHERE (t->>'wk')::date = _week_start), 0)),
    'sessions_rank', (SELECT 1 + count(*) FROM jsonb_array_elements(v_weeks) h
                       WHERE (h->>'wk')::date < _week_start
                         AND (h->>'sessions')::int > coalesce((SELECT (t->>'sessions')::int FROM jsonb_array_elements(v_weeks) t WHERE (t->>'wk')::date = _week_start), 0)),
    'weeks_tracked', (SELECT count(*) FROM jsonb_array_elements(v_weeks) h WHERE (h->>'wk')::date <= _week_start),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('wk', g.wk, 'sessions', coalesce((SELECT (h->>'sessions')::int FROM jsonb_array_elements(v_weeks) h WHERE (h->>'wk')::date = g.wk), 0)) ORDER BY g.wk), '[]'::jsonb)
                  FROM (SELECT (_week_start - 7 * i) AS wk FROM generate_series(0, 7) i) g),
    'reps', (SELECT coalesce(sum((w->>'reps')::int), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'streaks', (SELECT count(*) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w WHERE (w->>'streak')::int >= 4),
    'bodyweight', (SELECT count(DISTINCT e.client_id) FROM public.athlete_xp_events e
                    WHERE e.event_type = 'bodyweight' AND e.occurred_at >= v_from AND e.occurred_at < v_to AND e.client_id = ANY (v_roster)),
    'checkins', (SELECT count(DISTINCT e.client_id) FROM public.athlete_xp_events e
                  WHERE e.event_type = 'weekly_checkin' AND e.occurred_at >= v_from AND e.occurred_at < v_to AND e.client_id = ANY (v_roster)),
    'busiest_day', (SELECT to_char(pc.completed_at AT TIME ZONE tz, 'FMDay') FROM public.pl_day_completions pc
                     WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to
                     GROUP BY 1, extract(isodow FROM pc.completed_at AT TIME ZONE tz) ORDER BY count(*) DESC, extract(isodow FROM pc.completed_at AT TIME ZONE tz) LIMIT 1));
END;
$$;
REVOKE ALL ON FUNCTION public.community_week_stats(date, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_compose_wins(_week_start date, _exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_all jsonb := public.community_week_wins(_week_start, _exclude_user);
  v_n int := jsonb_array_length(v_all);
  v_k int;
  v_pick jsonb;
  v_lines text;
  v_rest text;
  v_rest_n int;
  v_stats jsonb;
  v_prs int;
  v_wk int := extract(week FROM _week_start)::int;
  v_intro text;
  v_outro text;
  v_caption text;
BEGIN
  IF v_n = 0 THEN RETURN NULL; END IF;
  v_k := CASE WHEN v_n <= 4 THEN v_n ELSE least(6, greatest(4, ceil(v_n / 2.0)::int)) END;

  SELECT jsonb_agg(w ORDER BY ord) INTO v_pick FROM (
    SELECT w, row_number() OVER (ORDER BY
             EXISTS (SELECT 1 FROM public.community_series_features f
                      WHERE f.client_id = (w->>'client_id')::uuid
                        AND f.featured_at > ((_week_start + 9)::timestamp AT TIME ZONE 'America/Winnipeg') - interval '28 days'
                        AND f.series_key <> 'wednesday_wins:' || to_char(_week_start + 9, 'IYYY-"W"IW')) ASC,
             (w->>'score')::int DESC,
             md5((w->>'client_id') || _week_start::text)) AS ord
      FROM jsonb_array_elements(v_all) w) z
   WHERE ord <= v_k;

  SELECT string_agg(coalesce(w->'texts'->>((pos - 1 + v_wk)::int % 3), w->>'text'), E'\n\n' ORDER BY pos) INTO v_lines
    FROM (SELECT w, row_number() OVER (ORDER BY (w->>'score')::int DESC) AS pos FROM jsonb_array_elements(v_pick) w) z;
  -- Everyone else who trained is still named.
  SELECT count(*)::int,
         CASE WHEN count(*) = 1 THEN min(nm) ELSE string_agg(nm, ', ' ORDER BY ord) FILTER (WHERE ord < count_all) || ' and ' || max(nm) FILTER (WHERE ord = count_all) END
    INTO v_rest_n, v_rest
    FROM (SELECT w->>'name' AS nm, row_number() OVER (ORDER BY (w->>'score')::int DESC, w->>'name') AS ord, count(*) OVER () AS count_all
            FROM jsonb_array_elements(v_all) w
           WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_pick) p WHERE p->>'client_id' = w->>'client_id')) r;

  v_stats := public.community_week_stats(_week_start, _exclude_user, v_all);
  v_prs := (v_stats->>'prs')::int;

  v_intro := CASE
    -- "yall" only when it's genuinely hype
    WHEN v_prs >= 25 THEN (ARRAY['yall are cooking. ' || v_prs || ' PRs last week heres who stood out',
                                 'big week. ' || v_prs || ' PRs between all of you last week heres who stood out'])[1 + v_wk % 2]
    WHEN v_prs >= 10 THEN (ARRAY['big week. ' || v_prs || ' PRs between all of you last week heres who stood out',
                                 'last week was a good one. ' || v_prs || ' PRs across the crew and some of you went off'])[1 + v_wk % 2]
    WHEN v_n * 10 >= (v_stats->>'roster')::int * 6 THEN (ARRAY['most of you showed up last week heres what that looked like',
                                                              'good week from this group. some highlights'])[1 + v_wk % 2]
    ELSE (ARRAY['heres what last week looked like', 'few highlights from last week'])[1 + v_wk % 2] END;
  v_outro := (ARRAY['proud of everyone. lets keep it rolling this week 🔥',
                    'thats the standard now. lets go again',
                    'not on the list this week? get your sessions in and you will be',
                    'keep stacking weeks like this. lets gooo'])[1 + v_wk % 4];

  v_caption := v_intro || E'\n\n' || v_lines || E'\n\n'
    || CASE WHEN v_rest IS NULL THEN ''
            WHEN v_rest_n = 1 THEN 'shoutout to ' || v_rest || ' too. showing up is the whole game' || E'\n\n'
            ELSE (ARRAY['shoutout to ' || v_rest || ' too. every one of you showed up',
                        'also big shoutout to ' || v_rest || '. showing up is the whole game',
                        v_rest || ' showed up too and that counts'])[1 + v_wk % 3] || E'\n\n' END
    || v_outro;
  -- not perfect every time: some weeks every paragraph starts lowercase,
  -- other weeks they're capitalized
  IF v_wk % 2 = 1 THEN
    SELECT string_agg(upper(left(p, 1)) || substr(p, 2), E'\n\n' ORDER BY n) INTO v_caption
      FROM unnest(string_to_array(v_caption, E'\n\n')) WITH ORDINALITY AS t(p, n);
  END IF;

  RETURN jsonb_build_object(
    'week_of', _week_start,
    'trainers', v_n,
    'featured', (SELECT jsonb_agg(jsonb_build_object('client_id', w->>'client_id', 'type', w->>'type')) FROM jsonb_array_elements(v_pick) w),
    'stats', v_stats,
    'caption', v_caption);
END;
$$;
REVOKE ALL ON FUNCTION public.community_compose_wins(date, uuid) FROM PUBLIC, anon, authenticated;
