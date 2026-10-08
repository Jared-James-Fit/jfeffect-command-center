-- Wednesday Wins, shorter: a post every week doesn't need to name everyone
-- every time. One intro line, 3 shout-outs (up to 5 only when needed), one
-- team line. The rotation makes sure everyone who trains gets their own
-- shout-out at some point each calendar month: people not featured yet this
-- month go first (on-and-off trainers before every-week regulars, who'll be
-- back), and the number featured is just enough to fit everyone left into
-- the Wednesdays left in the month.
CREATE OR REPLACE FUNCTION public.community_compose_wins(_week_start date, _exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_all jsonb := public.community_week_wins(_week_start, _exclude_user);
  v_n int := jsonb_array_length(v_all);
  v_post date := _week_start + 9;
  v_month_start timestamptz := (date_trunc('month', (_week_start + 9)::timestamp) AT TIME ZONE tz);
  v_key text := 'wednesday_wins:' || to_char(_week_start + 9, 'IYYY-"W"IW');
  -- only shout-outs before this post count (so re-composing a past week is honest)
  v_post_end timestamptz := ((_week_start + 10)::timestamp AT TIME ZONE tz);
  v_weds_left int;
  v_waiting int;
  v_k int;
  v_pick jsonb;
  v_lines text;
  v_stats jsonb;
  v_prs int;
  v_wk int := extract(week FROM _week_start)::int;
  v_intro text;
  v_outro text;
  v_caption text;
BEGIN
  IF v_n = 0 THEN RETURN NULL; END IF;

  -- Wednesdays left in this month, this one included
  v_weds_left := ((date_trunc('month', v_post::timestamp) + interval '1 month - 1 day')::date - v_post) / 7 + 1;
  -- people who trained and haven't had a shout-out yet this month
  SELECT count(*)::int INTO v_waiting FROM jsonb_array_elements(v_all) w
   WHERE NOT EXISTS (SELECT 1 FROM public.community_series_features f
                      WHERE f.client_id = (w->>'client_id')::uuid AND f.featured_at >= v_month_start AND f.featured_at < v_post_end AND f.series_key <> v_key);
  v_k := least(v_n, greatest(3, least(5, ceil(v_waiting::numeric / greatest(v_weds_left, 1))::int)));

  SELECT jsonb_agg(w ORDER BY ord) INTO v_pick FROM (
    SELECT w, row_number() OVER (ORDER BY
             EXISTS (SELECT 1 FROM public.community_series_features f
                      WHERE f.client_id = (w->>'client_id')::uuid AND f.featured_at >= v_month_start AND f.featured_at < v_post_end AND f.series_key <> v_key) ASC,
             -- people who train every week will be back next week; catch the
             -- ones who train on and off while they're here
             ((w->>'streak')::int >= 4) ASC,
             (w->>'score')::int DESC,
             md5((w->>'client_id') || _week_start::text)) AS ord
      FROM jsonb_array_elements(v_all) w) z
   WHERE ord <= v_k;

  SELECT string_agg(coalesce(w->'texts'->>((pos - 1 + v_wk)::int % 3), w->>'text'), E'\n\n' ORDER BY pos) INTO v_lines
    FROM (SELECT w, row_number() OVER (ORDER BY (w->>'score')::int DESC) AS pos FROM jsonb_array_elements(v_pick) w) z;

  v_stats := public.community_week_stats(_week_start, _exclude_user, v_all);
  v_prs := (v_stats->>'prs')::int;

  v_intro := CASE
    -- "yall" only when it's genuinely hype
    WHEN v_prs >= 25 THEN (ARRAY['yall are cooking. ' || v_prs || ' PRs last week', 'big week. ' || v_prs || ' PRs between everyone last week'])[1 + v_wk % 2]
    WHEN v_prs >= 10 THEN (ARRAY['big week. ' || v_prs || ' PRs between everyone', 'last week was a good one. ' || v_prs || ' PRs across the crew'])[1 + v_wk % 2]
    WHEN v_n * 10 >= (v_stats->>'roster')::int * 6 THEN (ARRAY['most of the crew showed up last week', 'good week from this group'])[1 + v_wk % 2]
    ELSE (ARRAY['some wins from last week', 'few highlights from last week'])[1 + v_wk % 2] END;
  v_outro := (ARRAY[v_n || ' of you got after it last week. proud of this crew 🔥',
                    'thats the standard. lets go again this week',
                    'not on here yet? you will be. lets go',
                    'everyone who showed up last week built this. keep stacking'])[1 + v_wk % 4];

  v_caption := v_intro || E'\n\n' || v_lines || E'\n\n' || v_outro;
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
