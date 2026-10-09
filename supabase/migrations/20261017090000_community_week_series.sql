-- A post for every day of the week.
--
--   Mon  Monday Motivation        library, 7am                     (already here)
--   Tue  Tuesday Tips & Tricks    a tip, or the crew's own data, noon
--   Wed  Wednesday Wins           last week's shout-outs, noon     (already here)
--   Thu  Try it Thursday          an app feature + how the people who use it train, noon
--   Fri  Finish Strong Friday     library, 7am                     (already here)
--   Sat  Saturday Spirit & Visual a picture that says it, 9am
--   Sun  Sunday Recap             the week's report card, 7pm
--
-- Same rules as before: one post per theme per ISO week (series_key), the
-- coach's switch pauses all of it, "Post now" from the coach screen.
--
-- Numbers are only ever the app's own. A data post (Tuesday's observation,
-- Thursday's stat) only goes out when both groups have 3+ people and the gap
-- is real; it says how many people it's about and calls it what it is
-- (people who do X, not "X makes you better"). Otherwise Tuesday posts a tip
-- from the library and Thursday posts the feature without a number. Names
-- only appear where Wednesday Wins would already say them.
--
-- The new days' extras (Saturday's picture, Thursday's feature card,
-- Tuesday's numbers) go to the app as `series_extra`, so a phone still on an
-- older version just shows the words instead of trying to draw a Wins card.

-- ── Shape ──────────────────────────────────────────────────────────────────
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_series_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_series_check
  CHECK (series IS NULL OR (kind = 'note' AND series IN (
    'monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
    'finish_strong_friday', 'saturday_spirit', 'sunday_recap')));

ALTER TABLE public.community_series_items DROP CONSTRAINT IF EXISTS community_series_items_series_check;
ALTER TABLE public.community_series_items ADD CONSTRAINT community_series_items_series_check
  CHECK (series IN ('monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit'));
-- What the post carries besides words: Saturday's picture, Thursday's feature, Tuesday's kind of tip.
ALTER TABLE public.community_series_items ADD COLUMN IF NOT EXISTS data jsonb;

-- ── The crew's last 8 full weeks, one row per person who trained ───────────
-- People who started inside the window are left out: everything is a PR in
-- your first weeks, which would skew any comparison.
CREATE OR REPLACE FUNCTION public.community_crew_outcomes(_exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH win AS (
    SELECT ((date_trunc('week', now() AT TIME ZONE 'America/Winnipeg') - interval '56 days') AT TIME ZONE 'America/Winnipeg') AS f,
           (date_trunc('week', now() AT TIME ZONE 'America/Winnipeg') AT TIME ZONE 'America/Winnipeg') AS t
  ), roster AS (
    SELECT cl.id, cl.user_id FROM public.clients cl, win w
     WHERE cl.user_id IS NOT NULL
       AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
       AND coalesce(cl.status, '') <> 'Archived'
       AND coalesce(cl.portal_access_disabled, false) = false
       AND cl.user_id IS DISTINCT FROM _exclude_user
       AND EXISTS (SELECT 1 FROM public.pl_day_completions pc WHERE pc.client_id = cl.id AND pc.completed_at < w.f)
  )
  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM (
    SELECT r.id AS client_id,
      (SELECT count(*) FROM public.pl_day_completions pc WHERE pc.client_id = r.id AND pc.completed_at >= w.f AND pc.completed_at < w.t) AS sessions,
      (SELECT count(DISTINCT date_trunc('week', pc.completed_at AT TIME ZONE 'America/Winnipeg'))
         FROM public.pl_day_completions pc WHERE pc.client_id = r.id AND pc.completed_at >= w.f AND pc.completed_at < w.t) AS weeks,
      (SELECT count(DISTINCT x.exercise_key)
         FROM (SELECT * FROM public.client_load_records(r.id) UNION ALL SELECT * FROM public.client_rep_records(r.id)) x
        WHERE x.completed AND x.workout_at >= w.f AND x.workout_at < w.t AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr)) AS prs,
      (SELECT count(*) FROM public.athlete_xp_events e WHERE e.client_id = r.id AND e.occurred_at >= w.f AND e.occurred_at < w.t AND e.event_type = 'workout_fully_logged') AS fully_logged,
      (SELECT count(*) FROM public.pl_workout_feedback fb WHERE fb.client_id = r.id AND fb.created_at >= w.f AND fb.created_at < w.t) AS reviews,
      (SELECT count(*) FROM public.athlete_xp_events e WHERE e.client_id = r.id AND e.occurred_at >= w.f AND e.occurred_at < w.t AND e.event_type = 'bodyweight') AS bodyweight,
      (SELECT count(*) FROM public.athlete_xp_events e WHERE e.client_id = r.id AND e.occurred_at >= w.f AND e.occurred_at < w.t AND e.event_type = 'weekly_checkin') AS checkins,
      (SELECT count(*) FROM public.athlete_xp_events e WHERE e.client_id = r.id AND e.occurred_at >= w.f AND e.occurred_at < w.t AND e.event_type IN ('progress_photo', 'progress_video')) AS progress,
      (SELECT count(*) FROM public.athlete_xp_events e WHERE e.client_id = r.id AND e.occurred_at >= w.f AND e.occurred_at < w.t AND e.event_type = 'water_logged') AS water
      FROM roster r, win w
  ) p WHERE p.sessions > 0
$$;
REVOKE ALL ON FUNCTION public.community_crew_outcomes(uuid) FROM PUBLIC, anon, authenticated;

/**
 * Split the crew by a habit and compare an outcome. NULL unless it's worth
 * saying: 3+ people on each side and a real gap (25%+ and a minimum absolute
 * difference). _ratio: the habit is per session (reviews / sessions) rather
 * than a count. Outcomes: 'spw' sessions a week, 'prs' lifts PR'd.
 */
CREATE OR REPLACE FUNCTION public.community_crew_compare(_rows jsonb, _habit text, _min numeric, _ratio boolean, _outcome text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_a int; v_b int; v_x numeric; v_y numeric;
BEGIN
  WITH t AS (
    SELECT (CASE WHEN _ratio THEN coalesce((r->>_habit)::numeric, 0) / greatest((r->>'sessions')::numeric, 1)
                 ELSE coalesce((r->>_habit)::numeric, 0) END) >= _min AS yes,
           CASE _outcome WHEN 'spw' THEN (r->>'sessions')::numeric / 8 ELSE coalesce((r->>_outcome)::numeric, 0) END AS v
      FROM jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) r)
  SELECT count(*) FILTER (WHERE yes), count(*) FILTER (WHERE NOT yes), avg(v) FILTER (WHERE yes), avg(v) FILTER (WHERE NOT yes)
    INTO v_a, v_b, v_x, v_y FROM t;
  IF v_a < 3 OR v_b < 3 OR v_x IS NULL OR v_y IS NULL THEN RETURN NULL; END IF;
  IF v_x < v_y * 1.25 OR v_x - v_y < (CASE _outcome WHEN 'prs' THEN 2 ELSE 0.5 END) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('habit', _habit, 'outcome', _outcome, 'a', v_a, 'b', v_b,
                            'x', round(v_x, CASE _outcome WHEN 'prs' THEN 0 ELSE 1 END),
                            'y', round(v_y, CASE _outcome WHEN 'prs' THEN 0 ELSE 1 END));
END;
$$;

-- ── Tuesday: the crew's own data, when it says something ───────────────────
/**
 * One observation, or NULL. Never two data Tuesdays in a row, each kind at
 * most once every 8 weeks, and the biggest real gap wins.
 */
CREATE OR REPLACE FUNCTION public.community_compose_observation(_exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows jsonb;
  v_recent text[];
  v_best jsonb;
  v_c jsonb;
  v_lo record;
  v_caption text;
BEGIN
  IF coalesce((SELECT p.series_data ? 'observation' FROM public.community_posts p
                WHERE p.series = 'tuesday_tips' ORDER BY p.created_at DESC LIMIT 1), false) THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(p.series_data->>'observation') INTO v_recent FROM public.community_posts p
   WHERE p.series = 'tuesday_tips' AND p.series_data ? 'observation' AND p.created_at > now() - interval '56 days';
  v_recent := coalesce(v_recent, '{}');
  v_rows := public.community_crew_outcomes(_exclude_user);

  -- 3+ sessions a week vs fewer → lifts PR'd
  IF NOT 'frequency' = ANY (v_recent) THEN
    v_c := public.community_crew_compare(v_rows, 'sessions', 24, false, 'prs');
    IF v_c IS NOT NULL THEN v_best := v_c || jsonb_build_object('observation', 'frequency'); END IF;
  END IF;
  -- trained 7-8 of the last 8 weeks vs missed 2+ → lifts PR'd
  IF NOT 'consistency' = ANY (v_recent) THEN
    v_c := public.community_crew_compare(v_rows, 'weeks', 7, false, 'prs');
    IF v_c IS NOT NULL AND (v_best IS NULL OR (v_c->>'x')::numeric / greatest((v_c->>'y')::numeric, 0.5)
                                              > (v_best->>'x')::numeric / greatest((v_best->>'y')::numeric, 0.5)) THEN
      v_best := v_c || jsonb_build_object('observation', 'consistency');
    END IF;
  END IF;
  -- sessions after under 5 hours of sleep vs the rest → how the session felt (1-5)
  IF v_best IS NULL AND NOT 'sleep' = ANY (v_recent) THEN
    SELECT count(*) FILTER (WHERE fb.sleep_bucket = 'lt5') AS n_lo,
           count(DISTINCT fb.client_id) FILTER (WHERE fb.sleep_bucket = 'lt5') AS p_lo,
           count(*) FILTER (WHERE fb.sleep_bucket <> 'lt5') AS n_hi,
           avg(fb.overall_rating) FILTER (WHERE fb.sleep_bucket = 'lt5') AS r_lo,
           avg(fb.overall_rating) FILTER (WHERE fb.sleep_bucket <> 'lt5') AS r_hi
      INTO v_lo
      FROM public.pl_workout_feedback fb
      JOIN public.clients cl ON cl.id = fb.client_id
     WHERE cl.user_id IS DISTINCT FROM _exclude_user
       AND fb.created_at > now() - interval '120 days' AND fb.sleep_bucket IS NOT NULL AND fb.overall_rating IS NOT NULL;
    IF v_lo.n_lo >= 10 AND v_lo.p_lo >= 3 AND v_lo.n_hi >= 30 AND v_lo.r_hi - v_lo.r_lo >= 0.3 THEN
      v_best := jsonb_build_object('observation', 'sleep', 'habit', 'sleep', 'outcome', 'rating', 'a', v_lo.n_lo, 'b', v_lo.n_hi,
                                   'x', round(v_lo.r_lo, 1), 'y', round(v_lo.r_hi, 1), 'people', v_lo.p_lo);
    END IF;
  END IF;
  IF v_best IS NULL THEN RETURN NULL; END IF;

  v_caption := CASE v_best->>'observation'
    WHEN 'frequency' THEN
      'looked through the last 8 weeks of training in the app 📊' || E'\n\n'
      || 'the ' || (v_best->>'a') || ' of you averaging 3+ sessions a week hit ' || (v_best->>'x') || ' PRs on average. everyone else: ' || (v_best->>'y') || E'\n\n'
      || 'probably not magic, its practice. more good reps at the lifts = better at the lifts. if youre at 2 a week, a short 3rd session is the easiest upgrade there is'
    WHEN 'consistency' THEN
      'something from the app data 📊' || E'\n\n'
      || 'the ' || (v_best->>'a') || ' of you who trained in 7 or 8 of the last 8 weeks hit ' || (v_best->>'x') || ' PRs on average. the ' || (v_best->>'b') || ' who missed 2+ weeks: ' || (v_best->>'y') || E'\n\n'
      || 'missing a week isnt the end of the world. but the PRs are going to the people who just dont miss. boring answer, usually the right one'
    ELSE
      'noticed this in your workout reviews 📊' || E'\n\n'
      || 'sessions after under 5 hours of sleep got rated ' || (v_best->>'x') || '/5 on average (' || (v_best->>'a') || ' sessions from ' || (v_best->>'people') || ' of you). everything else: ' || (v_best->>'y') || '/5' || E'\n\n'
      || 'one short night wont wreck you but it shows up. if the night before was rough, keep the top set honest and dont go chasing a PR that day' END;
  RETURN v_best || jsonb_build_object('caption', v_caption);
END;
$$;
REVOKE ALL ON FUNCTION public.community_compose_observation(uuid) FROM PUBLIC, anon, authenticated;

-- ── Thursday: how the people who use a feature train ──────────────────────
CREATE OR REPLACE FUNCTION public.community_feature_stat(_data jsonb, _exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c jsonb;
BEGIN
  IF _data IS NULL OR NOT (_data ? 'habit') THEN RETURN NULL; END IF;
  v_c := public.community_crew_compare(public.community_crew_outcomes(_exclude_user),
           _data->>'habit', (_data->>'min')::numeric, coalesce((_data->>'ratio')::boolean, false), coalesce(_data->>'outcome', 'spw'));
  IF v_c IS NULL THEN RETURN NULL; END IF;
  RETURN v_c || jsonb_build_object('line', CASE v_c->>'outcome'
    WHEN 'prs' THEN 'the ' || (v_c->>'a') || ' of you who ' || (_data->>'doers') || ' hit ' || (v_c->>'x') || ' PRs on average over the last 8 weeks. everyone else: ' || (v_c->>'y')
    ELSE 'the ' || (v_c->>'a') || ' of you who ' || (_data->>'doers') || ' trained ' || (v_c->>'x') || 'x a week on average over the last 8 weeks. everyone else: ' || (v_c->>'y') || 'x' END
    || '. not saying the feature does it for you, the people who use it are just more locked in');
END;
$$;
REVOKE ALL ON FUNCTION public.community_feature_stat(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ── Sunday: the week's report card ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_compose_recap(_week_start date, _exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_from timestamptz := (_week_start::timestamp AT TIME ZONE tz);
  v_to timestamptz := ((_week_start + 7)::timestamp AT TIME ZONE tz);
  v_roster uuid[];
  v_wins jsonb := public.community_week_wins(_week_start, _exclude_user);
  v_stats jsonb;
  v_planned int;
  v_done int;
  v_hit int;
  v_active int;
  v_days jsonb;
  v_completed int;
  v_logged int;
  v_top jsonb;
  v_featured jsonb;
  v_improve jsonb;
  v_quiet int;
  v_pct int;
  v_prs int;
  v_pr_people int;
  v_wk int := extract(week FROM _week_start)::int;
  v_caption text;
BEGIN
  IF jsonb_array_length(v_wins) = 0 THEN RETURN NULL; END IF;
  v_stats := public.community_week_stats(_week_start, _exclude_user, v_wins);
  -- the same crew Wednesday Wins counts
  SELECT array_agg(cl.id) INTO v_roster FROM public.clients cl
   WHERE cl.user_id IS NOT NULL
     AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
     AND coalesce(cl.status, '') <> 'Archived'
     AND coalesce(cl.portal_access_disabled, false) = false
     AND cl.user_id IS DISTINCT FROM _exclude_user;

  -- the plan: everyone training right now (a session in the last 5 weeks) and
  -- the sessions a week they committed to. Extra sessions don't cover for
  -- someone else's missed ones, so each person counts up to their own target.
  SELECT coalesce(sum(t.goal), 0)::int, coalesce(sum(least(t.done, t.goal)), 0)::int,
         count(*) FILTER (WHERE t.done >= t.goal)::int, count(*)::int
    INTO v_planned, v_done, v_hit, v_active
    FROM (SELECT coalesce(nullif(cl.committed_training_frequency, 0), array_length(cl.committed_training_days, 1)) AS goal,
                 (SELECT count(*) FROM public.pl_day_completions pc
                   WHERE pc.client_id = cl.id AND pc.completed_at >= v_from AND pc.completed_at < v_to) AS done
            FROM public.clients cl
           WHERE cl.id = ANY (v_roster)
             AND EXISTS (SELECT 1 FROM public.pl_day_completions pc
                          WHERE pc.client_id = cl.id AND pc.completed_at >= v_to - interval '35 days' AND pc.completed_at < v_to)) t
   WHERE t.goal > 0;

  -- workouts by day, Monday first
  SELECT jsonb_agg(coalesce(x.n, 0) ORDER BY d.d) INTO v_days
    FROM generate_series(1, 7) d(d)
    LEFT JOIN (SELECT extract(isodow FROM pc.completed_at AT TIME ZONE tz)::int AS dow, count(*)::int AS n
                 FROM public.pl_day_completions pc
                WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to
                GROUP BY 1) x ON x.dow = d.d;

  -- every set logged: workouts fully logged out of workouts finished
  SELECT count(*) FILTER (WHERE e.event_type = 'workout_completed')::int, count(*) FILTER (WHERE e.event_type = 'workout_fully_logged')::int
    INTO v_completed, v_logged
    FROM public.athlete_xp_events e
   WHERE e.client_id = ANY (v_roster) AND e.occurred_at >= v_from AND e.occurred_at < v_to
     AND e.event_type IN ('workout_completed', 'workout_fully_logged');

  -- the week's 3 biggest moments, in the words Wednesday Wins uses (no plain "got N sessions in")
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', z.w->>'name', 'type', z.w->>'type', 'text', z.w->>'text') ORDER BY z.rn), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('client_id', z.w->>'client_id', 'type', z.w->>'type') ORDER BY z.rn), '[]'::jsonb)
    INTO v_top, v_featured
    FROM (SELECT w, row_number() OVER (ORDER BY (w->>'score')::int DESC, md5((w->>'client_id') || _week_start::text)) AS rn
            FROM jsonb_array_elements(v_wins) w
           WHERE w->>'type' <> 'sessions') z
   WHERE z.rn <= 3;

  -- one thing to work on: the first that applies
  v_pct := CASE WHEN v_planned > 0 THEN round(100.0 * v_done / v_planned)::int END;
  SELECT q.d INTO v_quiet FROM (SELECT d, (v_days->>(d - 1))::int AS n FROM generate_series(1, 6) d) q ORDER BY q.n, q.d LIMIT 1;
  v_improve := CASE
    WHEN v_planned >= 6 AND v_pct < 80 THEN jsonb_build_object('kind', 'plan', 'missed', v_planned - v_done,
      'text', 'we came up ' || (v_planned - v_done) || ' sessions short of the plan. if your week gets packed, message me and we move days around instead of skipping')
    WHEN v_completed >= 6 AND v_logged * 10 < v_completed * 7 THEN jsonb_build_object('kind', 'logging', 'pct', round(100.0 * v_logged / v_completed)::int,
      'text', round(100.0 * v_logged / v_completed)::int || '% of workouts had every set logged. weight & reps on every set, its how your PRs get found')
    WHEN (v_stats->>'trained')::int >= 4 AND (v_stats->>'checkins')::int * 2 < (v_stats->>'trained')::int THEN jsonb_build_object('kind', 'checkins',
      'text', 'only ' || (v_stats->>'checkins') || ' weekly check-ins came in. a couple minutes, and its how I hear how your week actually went')
    ELSE jsonb_build_object('kind', 'day', 'day', to_char(_week_start + v_quiet - 1, 'FMDay'),
      'text', to_char(_week_start + v_quiet - 1, 'FMDay') || ' was our quietest day. if its on your plan this week, thats the one to protect') END;

  v_prs := (v_stats->>'prs')::int;
  v_pr_people := (v_stats->>'pr_people')::int;
  v_caption := CASE
      WHEN v_pct >= 85 THEN (ARRAY['week in the books. ' || v_pct || '% of planned sessions got done 🔥',
                                   'thats a wrap on the week. ' || v_hit || ' of ' || v_active || ' of you hit every session you planned 💪'])[1 + v_wk % 2]
      WHEN v_pct IS NOT NULL THEN (ARRAY['week recap. ' || v_pct || '% of planned sessions got done',
                                         'end of the week. heres how we did'])[1 + v_wk % 2]
      ELSE 'end of the week. heres how we did' END
    || CASE WHEN v_prs > 0 AND v_pr_people > 1 THEN E'\n\n' || v_prs || ' PRs between ' || v_pr_people || ' of you'
            WHEN v_prs > 0 THEN E'\n\n' || v_prs || CASE WHEN v_prs = 1 THEN ' PR' ELSE ' PRs' END || ' this week'
            ELSE '' END
    || E'\n\n' || (ARRAY['full numbers below 👇', 'numbers below 👇 lets go again this week', 'the whole week below 👇'])[1 + v_wk % 3];

  RETURN jsonb_build_object('caption', v_caption, 'featured', v_featured, 'stats', v_stats || jsonb_build_object(
    'kind', 'recap', 'planned', v_planned, 'planned_done', v_done, 'hit', v_hit, 'active', v_active, 'days', v_days,
    'completed', v_completed, 'fully_logged', v_logged, 'top', v_top, 'improve', v_improve));
END;
$$;
REVOKE ALL ON FUNCTION public.community_compose_recap(date, uuid) FROM PUBLIC, anon, authenticated;

-- ── Rotation: the next library post for a day ──────────────────────────────
-- Monday and Friday share mentors (not the same one twice in a row across
-- them); the other days rotate within themselves (Tuesday never runs the same
-- kind of tip twice in a row). Oldest-used first.
CREATE OR REPLACE FUNCTION public.community_series_next(_series text)
RETURNS public.community_series_items LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.* FROM public.community_series_items i
   WHERE i.series = _series AND i.active
   ORDER BY (i.mentor = ANY (coalesce((
              SELECT array_agg(x.mentor) FROM (
                SELECT j.mentor FROM public.community_series_items j
                 WHERE j.last_used_at IS NOT NULL
                   AND CASE WHEN _series IN ('monday_motivation', 'finish_strong_friday') THEN j.series IN ('monday_motivation', 'finish_strong_friday')
                            ELSE j.series = _series END
                 ORDER BY j.last_used_at DESC LIMIT 2) x), '{}'))) ASC,
            i.last_used_at ASC NULLS FIRST, i.sort_order, i.created_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.community_series_next(text) FROM PUBLIC, anon, authenticated;

-- ── Publish: whatever today is ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_publish_series(_series text DEFAULT NULL, _force boolean DEFAULT false, _at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  v_local timestamp := (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg');
  v_dow int := extract(isodow FROM v_local);
  v_series text := coalesce(_series, c_days[extract(isodow FROM (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg'))::int]);
  v_settings record;
  v_author uuid;
  v_key text;
  v_item record;
  v_id uuid;
  v_start time;
  v_end time;
  v_comp jsonb;
  v_caption text;
  v_data jsonb;
  v_stat jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT v_series = ANY (c_days) THEN RAISE EXCEPTION 'Unknown series'; END IF;
  v_start := CASE v_series
    WHEN 'monday_motivation' THEN time '07:00' WHEN 'finish_strong_friday' THEN time '07:00'
    WHEN 'saturday_spirit' THEN time '09:00' WHEN 'sunday_recap' THEN time '19:00'
    ELSE time '12:00' END;
  v_end := CASE WHEN v_start >= time '19:00' THEN time '23:59:59' ELSE v_start + interval '5 hours' END;
  IF NOT coalesce(_force, false) THEN
    IF v_dow <> array_position(c_days, v_series) OR v_local::time < v_start OR v_local::time >= v_end THEN
      RETURN jsonb_build_object('status', 'outside_window');
    END IF;
  END IF;

  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RETURN jsonb_build_object('status', 'no_author'); END IF;

  v_key := v_series || ':' || to_char(v_local, 'IYYY-"W"IW');
  IF EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_key) THEN
    RETURN jsonb_build_object('status', 'exists', 'key', v_key);
  END IF;

  -- Built from the logs: Wednesday (last week's shout-outs) and Sunday (this week's report card).
  IF v_series IN ('wednesday_wins', 'sunday_recap') THEN
    IF v_series = 'wednesday_wins' THEN
      v_comp := public.community_compose_wins((date_trunc('week', v_local)::date - 7), v_author);
      IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;
      -- Sunday already showed that week's numbers: Wednesday is the shout-outs.
      v_data := CASE WHEN EXISTS (SELECT 1 FROM public.community_series_runs r
                                   WHERE r.series_key = 'sunday_recap:' || to_char(date_trunc('week', v_local)::date - 1, 'IYYY-"W"IW'))
                     THEN NULL ELSE v_comp->'stats' END;
    ELSE
      v_comp := public.community_compose_recap(date_trunc('week', v_local)::date, v_author);
      IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;
      v_data := v_comp->'stats';
    END IF;
    INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
    INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at)
    VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
            v_comp->>'caption', v_series, v_key, v_data, coalesce(_at, now()))
    RETURNING id INTO v_id;
    UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
    -- Sunday's top 3 count as featured too, so Wednesday spreads the shout-outs to others.
    INSERT INTO public.community_series_features (series_key, client_id, win_type, featured_at)
    SELECT v_key, (f->>'client_id')::uuid, f->>'type', coalesce(_at, now()) FROM jsonb_array_elements(coalesce(v_comp->'featured', '[]'::jsonb)) f
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key);
  END IF;

  -- Tuesday: the crew's own data when it says something real, else the library.
  IF v_series = 'tuesday_tips' THEN
    v_comp := public.community_compose_observation(v_author);
    IF v_comp IS NOT NULL THEN
      INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;
      IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
      INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at)
      VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
              v_comp->>'caption', v_series, v_key, v_comp - 'caption', coalesce(_at, now()))
      RETURNING id INTO v_id;
      UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
      RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'observation', v_comp->>'observation');
    END IF;
  END IF;

  -- The libraries.
  SELECT * INTO v_item FROM public.community_series_next(v_series);
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('status', 'no_items'); END IF;

  v_caption := v_item.body;
  v_data := v_item.data;
  IF v_series = 'try_it_thursday' THEN
    v_stat := public.community_feature_stat(v_item.data, v_author);
    IF v_stat IS NOT NULL THEN
      v_caption := v_caption || E'\n\n📊 ' || (v_stat->>'line');
      v_data := coalesce(v_data, '{}'::jsonb) || jsonb_build_object('stat', v_stat - 'line');
    END IF;
  END IF;

  INSERT INTO public.community_series_runs (series_key, series, item_id) VALUES (v_key, v_series, v_item.id)
  ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, quote, quote_author, quote_source,
                                      series, series_key, series_item_id, series_data, created_at)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_caption,
          v_item.quote, CASE WHEN v_item.quote IS NOT NULL THEN v_item.mentor END, v_item.quote_source,
          v_series, v_key, v_item.id, v_data, coalesce(_at, now()))
  ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
  UPDATE public.community_series_items SET last_used_at = coalesce(_at, now()), use_count = use_count + 1 WHERE id = v_item.id;
  RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'mentor', v_item.mentor);
END;
$$;
REVOKE ALL ON FUNCTION public.community_publish_series(text, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_publish_series(text, boolean, timestamptz) TO authenticated;

-- ── Coach screen: all seven days ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_series_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  c_libs constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit'];
  v_settings record;
  v_local timestamp := now() AT TIME ZONE 'America/Winnipeg';
  v_wk text := to_char(now() AT TIME ZONE 'America/Winnipeg', 'IYYY-"W"IW');
  v_wins_posted boolean;
  v_preview jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  v_wins_posted := EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = 'wednesday_wins:' || v_wk);
  v_preview := public.community_compose_wins(date_trunc('week', v_local)::date - CASE WHEN v_wins_posted THEN 0 ELSE 7 END,
                                              public.community_main_account(v_settings.author_user_id));
  RETURN jsonb_build_object(
    'wins_preview', CASE WHEN v_preview IS NOT NULL THEN jsonb_build_object('body', v_preview->>'caption', 'featured', jsonb_array_length(v_preview->'featured'),
                                                                             'trainers', v_preview->'trainers', 'week_of', v_preview->>'week_of', 'next_week', v_wins_posted,
                                                                             'stats', v_preview->'stats') END,
    'paused', coalesce(v_settings.paused, false),
    'author', CASE WHEN v_settings.author_user_id IS NOT NULL THEN public.community_author(v_settings.author_user_id) END,
    'next', coalesce((SELECT jsonb_object_agg(s.series, jsonb_build_object('id', n.id, 'mentor', n.mentor, 'body', n.body,
                                                                           'quote', n.quote, 'quote_source', n.quote_source, 'data', n.data))
                        FROM unnest(c_libs) s(series)
                        CROSS JOIN LATERAL public.community_series_next(s.series) n
                       WHERE n.id IS NOT NULL), '{}'::jsonb),
    'library', (SELECT jsonb_object_agg(s.series, (SELECT count(*) FROM public.community_series_items i WHERE i.series = s.series AND i.active))
                  FROM unnest(c_libs) s(series)),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'series', p.series, 'created_at', p.created_at,
                                                             'mentor', i.mentor, 'caption', left(p.caption, 120))
                                          ORDER BY p.created_at DESC)
                           FROM (SELECT * FROM public.community_posts WHERE series IS NOT NULL ORDER BY created_at DESC LIMIT 8) p
                           LEFT JOIN public.community_series_items i ON i.id = p.series_item_id), '[]'::jsonb),
    'this_week', (SELECT jsonb_object_agg(s.series, EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = s.series || ':' || v_wk))
                    FROM unnest(c_days) s(series)));
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_overview() TO authenticated;

/**
 * What a data day would say right now (the coach screen asks for it):
 * Sunday's report card so far, Tuesday's observation (NULL = a tip goes out),
 * Thursday's stat for the feature that's up next (NULL = no number).
 */
CREATE OR REPLACE FUNCTION public.community_series_preview(_series text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settings record;
  v_author uuid;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF _series = 'sunday_recap' THEN
    RETURN public.community_compose_recap(date_trunc('week', now() AT TIME ZONE 'America/Winnipeg')::date, v_author);
  ELSIF _series = 'tuesday_tips' THEN
    RETURN public.community_compose_observation(v_author);
  ELSIF _series = 'try_it_thursday' THEN
    RETURN public.community_feature_stat((SELECT n.data FROM public.community_series_next('try_it_thursday') n), v_author);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_preview(text) TO authenticated;

-- ── The post as the app gets it: Wins-shaped numbers stay in series_data ──
CREATE OR REPLACE FUNCTION public.community_post_json(_post_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', n.id,
    'created_at', n.created_at,
    'visibility', n.visibility,
    'caption', n.caption,
    'media_path', n.media_path,
    'media_thumb_path', n.media_thumb_path,
    'media_type', n.media_type,
    'media_width', n.media_width,
    'media_height', n.media_height,
    'completion_id', n.completion_id,
    'kind', n.kind,
    'series', n.series,
    'quote', n.quote,
    'quote_author', n.quote_author,
    'quote_source', n.quote_source,
    'series_data', CASE WHEN n.series IS NULL OR n.series IN ('wednesday_wins', 'sunday_recap') THEN n.series_data END,
    'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit') THEN n.series_data END,
    'edited_at', n.edited_at,
    'archived_at', n.archived_at,
    'archived_from', n.archived_from,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'reaction_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = n.id),
    'reactors', coalesce((SELECT jsonb_agg(x.j ORDER BY x.coach DESC, x.at DESC)
                            FROM (SELECT public.community_author(r.user_id)
                                         || jsonb_build_object('is_me', public.community_main_account(r.user_id) = public.community_main_account(_viewer)) AS j,
                                         public.community_is_coach(r.user_id) AS coach, r.created_at AS at
                                    FROM public.community_reactions r WHERE r.post_id = n.id
                                   ORDER BY public.community_is_coach(r.user_id) DESC, r.created_at DESC LIMIT 3) x), '[]'::jsonb),
    'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                    ORDER BY r.created_at)
                                   FROM public.community_reactions r
                                  WHERE r.post_id = n.id
                                    AND public.community_is_coach(r.user_id)), '[]'::jsonb),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$$;

-- ── Schedule: one job every 15 minutes; each day knows its own window ──────
DO $$ BEGIN
  PERFORM cron.unschedule('community-weekly-coach-posts');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('community-wednesday-wins');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.schedule('community-daily-series', '*/15 * * * *', 'select public.community_publish_series();');
EXCEPTION WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
  RAISE NOTICE 'pg_cron not available; community-daily-series not scheduled';
END $$;

-- ── Libraries ──────────────────────────────────────────────────────────────
-- Tuesday: cues to test, habits, mindset, controlling what you can. mentor =
-- the kind of tip (the rotation never runs the same kind twice in a row).
INSERT INTO public.community_series_items (series, mentor, body, sort_order, data)
SELECT 'tuesday_tips', v.kind, v.body, v.n, jsonb_build_object('kind', v.kind)
  FROM (VALUES
  (1, 'cue', 'cue to test on squats this week: spread the floor. push your feet out to the sides like youre trying to rip the floor apart, without your feet actually moving. a lot of people feel their hips kick in more and their knees stop caving. try it on your warm up sets first and see if the bar feels more stable. if it clicks keep it, if not toss it 🤝'),
  (2, 'habit', 'workout habit that matters more than people think: do the same warm up every time. same order, same jumps in weight. after a few weeks your body knows exactly what its getting ready for and you stop wasting energy figuring it out. pick one this week and stick to it'),
  (3, 'mindset', 'one bad session means basically nothing. sleep, stress, food, a long day at work, it all shows up on the bar. what matters is the trend over 4-6 weeks. next time a session feels off, log it honestly, leave your review & move on. thats it 🤝'),
  (4, 'externals', 'gym is packed, no rack open, someones on your bench. have a backup. rack taken? do your accessories first. machine gone? swap it for the closest thing. a session done 80% as planned beats a session skipped. dont let the gym decide whether you train'),
  (5, 'cue', 'bench cue worth testing: try to bend the bar. grip it tight and think about snapping it in half. for a lot of people it locks the shoulder blades back and stops the elbows flaring early. test it on your first couple warm up sets and pay attention to how the bar path feels. only way to know if it works for you is to try it 💪'),
  (6, 'habit', 'be honest with your RPE. an 8 means you had 2 more good reps in you, not 2 more if your life depended on it. the whole point is picking the right weight for the day, so if the number is off the weight is off. after each top set this week ask yourself how many you actually had left and log that'),
  (7, 'mindset', 'try a routine before your heavy sets. same steps every time: chalk, belt, same breath, same setup. it takes the thinking out of it and gives your brain something to do besides worrying about the weight. pick 3 steps and run them before every working set this week'),
  (8, 'externals', 'you cant control how your body feels every day. you can control showing up, sleeping, eating and giving honest effort. stack those and the numbers take care of themselves over time. on the days you feel like crap, still show up and hit what the plan says. thats the win'),
  (9, 'cue', 'deadlift cue to try: pull the slack out before the bar leaves the floor. grip it, pull up just enough that you hear the plates click, get tight, THEN push. no yanking. jerking the bar off the floor is one of the fastest ways to lose position. do it on every warm up set this week so its automatic by the top set'),
  (10, 'habit', 'rest longer on your main lifts. 3-5 min between heavy sets isnt lazy, its how the next set actually gets to be heavy. cutting rest short on squats & deads mostly just makes the next set worse. save the short rest for accessories'),
  (11, 'mindset', 'save the hype for the top set. if youre getting fired up for warm ups youre burning it too early. stay calm through the warm ups, then turn it up for the 1 or 2 sets that actually matter. test it next session and see how the top set feels'),
  (12, 'externals', 'if everything feels heavy for 2 weeks straight, tell me. thats not you being soft, thats information. sometimes it means we pull back for a week, sometimes its sleep or food. either way I can only adjust what I know about, so put it in your workout review or send me a message 🤝'),
  (13, 'cue', 'if your deadlift is slow off the floor try this: stop thinking pull and start thinking push the floor away, like a leg press. it tends to keep the hips from shooting up first and gets your legs doing more of the work. worth testing on your next pull day. film a set with it and one without if you want to see the difference 🎥'),
  (14, 'habit', 'eat something 1-3 hours before you train. some carbs & some protein, nothing crazy. training on an empty tank usually shows up in the last few sets, not the first. if you train early and cant eat much, a banana or some toast beats nothing. try it this week and see if the back half of your session feels different'),
  (15, 'mindset', 'the only comparison that matters is you vs you a few months ago. someone elses numbers have nothing to do with your progress. scroll back through your PRs in the app sometime, most people forget how far theyve actually come 🙏'),
  (16, 'cue', 'bracing cue worth testing: breathe into your belt, all the way around. not just your stomach, your sides and lower back too, like youre filling a barrel. then lock it in before you move. if your lower back is the first thing to give on heavy sets this is where id start. practice it on a lighter set first so you can feel it'),
  (17, 'habit', 'before you walk into the gym, open your workout and know what your top set is supposed to be. takes 30 seconds. showing up with the plan already in your head means less wandering, less guessing weights halfway through, and a better session. try it this week before you leave the house'),
  (18, 'externals', 'sleep is the one thing that makes training feel easier without changing a single thing in your program. 7-9 hours. most people dont need a new program, they need to go to bed earlier. try getting 30 min more a night this week and see how your top sets feel 🫡'),
  (19, 'cue', 'one for bench: instead of pushing the bar up, think about pushing yourself away from the bar, down into the bench. sounds like the same thing but for a lot of people it keeps the upper back tight and the leg drive connected. give it a few sets this week and see if the lockout feels any different'),
  (20, 'cue', 'for RDLs: pretend theres a wall behind you and youre trying to touch it with your butt. hips go back, bar stays glued to your legs, stop when your hips cant go back any further. most people go too low and turn it into a back exercise. do it right and you should feel your hamstrings way more 🔥'),
  (21, 'cue', 'for pulldowns & rows: think elbows to your back pockets, not hands to your chest. your hands are just hooks. most people feel their lats way more and their biceps way less. try it next back day and drop the weight a bit if you need to, worth it'),
  (22, 'habit', 'something to test on your accessories: control the way down for 2-3 seconds and dont cut the stretch short at the bottom. research has been leaning toward the stretched part of the rep being really good for growth. youll probably need less weight, thats normal. try it on 1 or 2 exercises for a couple weeks and see how they feel')
  ) v(n, kind, body)
 WHERE NOT EXISTS (SELECT 1 FROM public.community_series_items i WHERE i.series = 'tuesday_tips');

-- Thursday: features clients should be using. mentor = the feature. A habit
-- (from community_crew_outcomes) means the post can carry a live stat.
INSERT INTO public.community_series_items (series, mentor, body, sort_order, data)
SELECT 'try_it_thursday', v.feature, v.body, v.n, v.data::jsonb
  FROM (VALUES
  (1, 'bodyweight', 'log your bodyweight. on Home tap Log Weight on the Bodyweight card. first thing in the morning, after the bathroom, before you eat or drink. one weigh in means basically nothing, the trend over a few weeks is what tells us if your food actually lines up with your goal. aim for 3-4 mornings a week',
     '{"feature":"bodyweight","title":"Log your bodyweight","where":["Home","Bodyweight card","Log Weight"],"habit":"bodyweight","min":16,"outcome":"spw","doers":"log your bodyweight 2+ times a week"}'),
  (2, 'rest_timer', 'the rest timer. it starts on its own when you check off a set, or tap the ▶ on any exercise to start it yourself. no more guessing how long youve been sitting there on your phone. this week try actually resting the full time on your main lifts: 3-5 min on heavy squats, bench & deads',
     '{"feature":"rest_timer","title":"Use the rest timer","where":["Workout","▶ on any exercise"]}'),
  (3, 'workout_review', 'the review at the end of your workout. when you tap Finish Workout it asks how hard it was, if anything hurt, how you slept and how much energy you had going in. about 20 seconds. it tells me the stuff your numbers cant, like a PR on 4 hours of sleep or a tweak before it turns into something. dont skip it, even on the boring days',
     '{"feature":"workout_review","title":"Review your workout","where":["Workout","Finish Workout","How''d it go?"],"habit":"reviews","min":0.8,"ratio":true,"outcome":"spw","doers":"review 8 out of 10 workouts or more"}'),
  (4, 'how_to', 'every exercise in your program has a How To button. tap it for the demo video if theres one, the coaching cues and the most common mistakes. if theres anything on your plan youre not 100% sure about, check it before your first set. even on lifts you know well the cues are worth a look',
     '{"feature":"how_to","title":"Tap How To","where":["Workout","any exercise","How To"]}'),
  (5, 'progress_photos', 'progress photos. on Home tap Add Photos on the Progress card, then Done · Send to Coach. same spot, same lighting, same time of day, every few weeks. you see yourself in the mirror every day so you never notice the change. photos side by side dont lie. they come straight to me too',
     '{"feature":"progress_photos","title":"Take progress photos","where":["Home","Progress card","Add Photos"],"habit":"progress","min":1,"outcome":"spw","doers":"sent progress photos or videos"}'),
  (6, 'rpe', 'the RPE on every set. after a set tap how hard it was. 10 means nothing left, 8 means you had 2 more good reps. not sure? tap What is RPE? in the workout for the full scale. 2 seconds a set and it shows whether a weight was actually heavy or you were just having a rough day. be honest with it, thats the whole point',
     '{"feature":"rpe","title":"Rate every set","where":["Workout","RPE on each set","What is RPE?"]}'),
  (7, 'log_sets', 'log every set, not just the top one. weight & reps on each set as you go, right after you finish it. the app finds your PRs from what you log, so a set you dont log is a PR nobody ever sees. it also shows me how the whole session actually went. try logging as you go this week instead of all at the end',
     '{"feature":"log_sets","title":"Log every set","where":["Workout","each set","weight · reps · RPE"],"habit":"fully_logged","min":0.8,"ratio":true,"outcome":"spw","doers":"log every set in 8 out of 10 workouts or more"}'),
  (8, 'analytics', 'your training analytics. on the Workouts tab tap Analytics at the top (on your phone its the little pulse icon next to the calendar). your lifts over time, your recent all time PRs, all of it. on a rough week its the best reminder of how far youve actually come 📈',
     '{"feature":"analytics","title":"Check your analytics","where":["Workouts","Analytics"]}'),
  (9, 'weekly_checkin', 'the weekly check-in. when its due it shows up in Messages as a card, tap Start check-in and go. a couple minutes. its where I hear about the stuff the workout log cant show me: stress, sleep, how your body feels, whats coming up. the bad weeks are the ones I most need to hear about so dont skip those 🤝',
     '{"feature":"weekly_checkin","title":"Do your weekly check-in","where":["Messages","Weekly Check-In","Start check-in"],"habit":"checkins","min":2,"outcome":"spw","doers":"have been sending your weekly check-ins"}'),
  (10, 'exercise_notes', 'the note button on each exercise. use it for anything you want to remember: seat height, grip width, which cue clicked, something that felt off. next time you open the note on that exercise your old notes are right there, and I can see them too. saves you figuring it all out again every week',
     '{"feature":"exercise_notes","title":"Leave yourself a note","where":["Workout","note on any exercise","Save Note"]}'),
  (11, 'league', 'the Performance League on Home. every month it ranks the crew on points from training, logging, reviews, check-ins and progress photos. not on who lifts the most, so anyone can win it. you need a bodyweight logged to get in. tap the card to see where youre at 🏆',
     '{"feature":"league","title":"Check the Performance League","where":["Home","Performance League"]}'),
  (12, 'lift_video', 'send me a video of a top set. in Messages tap + then Camera or Photos & Videos. side angle, whole body in the shot, phone around hip height. its the fastest way for me to catch something in your technique before it turns into a problem or a missed lift',
     '{"feature":"lift_video","title":"Send me a set","where":["Messages","+","Camera"]}'),
  (13, 'water', 'the Water Today card on Home. tap +250ml, +500ml or +1L when you drink. most people drink less than they think, and it can show up as feeling flat in the gym. try logging it for one week just to see where youre actually at',
     '{"feature":"water","title":"Track your water","where":["Home","Water Today","+500ml"],"habit":"water","min":8,"outcome":"spw","doers":"log your water at least once a week"}'),
  (14, 'share', 'post a workout in the community. tap Share at the top of the Community tab and pick a session. no pressure to make it look good, its the effort people hype up. when the crew can see you showing up its a lot harder to skip on the days you dont feel like it',
     '{"feature":"share","title":"Share a workout","where":["Community","Share"]}'),
  (15, 'cookbook', 'the Cookbook. More → Nutrition → Open Cookbook. easy meals: air fryer, microwave, no-cook & store-bought. if hitting your protein feels like a chore, find 2 or 3 in there you actually like and rotate them. nobody needs 40 recipes, you need a few you will actually make',
     '{"feature":"cookbook","title":"Open the Cookbook","where":["More","Nutrition","Open Cookbook"]}')
  ) v(n, feature, body, data)
 WHERE NOT EXISTS (SELECT 1 FROM public.community_series_items i WHERE i.series = 'try_it_thursday');

-- Saturday: the picture does the talking. mentor = the scene.
INSERT INTO public.community_series_items (series, mentor, body, sort_order, data)
SELECT 'saturday_spirit', v.scene, v.body, v.n, jsonb_build_object('scene', v.scene)
  FROM (VALUES
  (1, 'keep_digging', 'you might be one swing away. keep swinging ⛏️'),
  (2, 'bamboo_roots', 'growth you cant see yet is still growth'),
  (3, 'stonecutter', 'it wasnt the last hit that split it. it was all of them'),
  (4, 'iceberg', 'they see the PR. they dont see everything under it'),
  (5, 'stairs_fog', 'you dont need to see the top. just the next step'),
  (6, 'water_stone', 'not force. frequency.'),
  (7, 'year_dots', 'a great year is mostly just not missing twice'),
  (8, 'switchback', 'the long way up is still up'),
  (9, 'sunrise_rack', 'earned before anyone else is awake'),
  (10, 'seed_to_tree', 'it takes the time it takes. the answer is in the work')
  ) v(n, scene, body)
 WHERE NOT EXISTS (SELECT 1 FROM public.community_series_items i WHERE i.series = 'saturday_spirit');
