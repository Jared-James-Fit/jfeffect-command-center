-- Wednesday Wins: last week's wins, from the real training data, as a coach
-- post (same note posts, feed, profile, reactions, comments as the others).
--
--   * One win per client who trained last week (Mon–Sun, Winnipeg), the best
--     of: all-time / program / block PR (the app's own record functions),
--     first week, back after 14+ days off, every scheduled session done,
--     N straight weeks training, volume up 15%+, or sessions logged.
--     Nobody who didn't train gets a "win", and nothing is made up.
--   * Fair rotation: clients not featured in the last 4 weeks go first, then
--     the strongest win. Up to 6 get a full line each week (about half of
--     who trained), so everyone who trains gets one within the month; the
--     rest are still named in the "also put in the work" line.
--   * Weights are shown in each client's own unit, and never for a client
--     who has used "Hide weights" on a post.
--   * Posts every Wednesday at 12:00 Winnipeg (same once-a-week, pause and
--     edit rules as Monday Motivation / Finish Strong Friday).

ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_series_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_series_check
  CHECK (series IS NULL OR (kind = 'note' AND series IN ('monday_motivation', 'wednesday_wins', 'finish_strong_friday')));

-- Who was named, when, for what (drives the "everyone within the month" rotation).
CREATE TABLE IF NOT EXISTS public.community_series_features (
  series_key text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  win_type text NOT NULL,
  featured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_key, client_id)
);
CREATE INDEX IF NOT EXISTS community_series_features_client_idx ON public.community_series_features (client_id, featured_at DESC);
ALTER TABLE public.community_series_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_series_features FROM anon, authenticated;
GRANT ALL ON public.community_series_features TO service_role;

-- The crew's numbers for the week, shown as a card under the post.
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS series_data jsonb;

CREATE OR REPLACE FUNCTION public.community_fmt_load(_kg numeric, _unit text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _kg IS NULL OR _kg <= 0 THEN NULL
              WHEN _unit = 'kg' THEN trim(trailing '.' FROM trim(trailing '0' FROM round(_kg, 1)::text)) || ' kg'
              ELSE round(_kg * 2.20462)::int::text || ' lb' END
$$;

-- "Hip Thrust - Barbell" reads as "Barbell Hip Thrust" in a sentence.
CREATE OR REPLACE FUNCTION public.community_fmt_lift(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _name ~* '^(.+?) - (barbell|dumbbells?|cable|machine|smith machine|kettlebell|band|bodyweight|ez bar|trap bar|landmine)$'
              THEN regexp_replace(_name, '^(.+?) - (.+)$', '\2 \1') ELSE _name END
$$;

-- Every client who trained in the week starting _week_start (a Monday), with
-- their single best win, written the way a coach would say it. Internal (no
-- grants); used by compose + preview.
CREATE OR REPLACE FUNCTION public.community_week_wins(_week_start date, _exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_from timestamptz := (_week_start::timestamp AT TIME ZONE tz);
  v_to timestamptz := ((_week_start + 7)::timestamp AT TIME ZONE tz);
  c record;
  pr record;
  v_out jsonb := '[]'::jsonb;
  v_name text;
  v_hide boolean;
  v_sessions int;
  v_pr_lifts int;
  v_sched int;
  v_done int;
  v_prev timestamptz;
  v_first_this timestamptz;
  v_gap int;
  v_streak int;
  v_vol numeric;
  v_vol_prev numeric;
  v_reps int;
  v_type text;
  v_score int;
  v_text text;
  v_texts text[];
  v_lift text;
  v_set text;
  v_more text;
BEGIN
  FOR c IN
    SELECT cl.id, cl.user_id, coalesce(nullif(cl.preferred_weight_unit, ''), 'lb') AS unit
      FROM public.clients cl
     WHERE cl.user_id IS NOT NULL
       AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
       AND coalesce(cl.status, '') <> 'Archived'
       AND coalesce(cl.portal_access_disabled, false) = false
       AND cl.user_id IS DISTINCT FROM _exclude_user
  LOOP
    SELECT count(*)::int, min(pc.completed_at) INTO v_sessions, v_first_this FROM public.pl_day_completions pc
     WHERE pc.client_id = c.id AND pc.completed_at >= v_from AND pc.completed_at < v_to;
    CONTINUE WHEN v_sessions = 0;

    v_name := public.community_author(c.user_id)->>'name';
    v_hide := EXISTS (SELECT 1 FROM public.community_posts p WHERE p.author_user_id = c.user_id AND p.hide_loads);

    -- PRs set this week (the same record rules the recap and share cards use)
    SELECT x.exercise_name, x.reps, x.load_kg,
           CASE WHEN x.is_atpr THEN 'atpr' WHEN x.is_program_pr THEN 'program_pr' ELSE 'block_pr' END AS scope
      INTO pr
      FROM (SELECT * FROM public.client_load_records(c.id) UNION ALL SELECT * FROM public.client_rep_records(c.id)) x
     WHERE x.completed AND x.workout_at >= v_from AND x.workout_at < v_to AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr)
     ORDER BY x.is_atpr DESC, x.is_program_pr DESC, (x.exercise_name ~* '(squat|bench|deadlift)') DESC, x.load_kg DESC NULLS LAST
     LIMIT 1;
    SELECT count(DISTINCT x.exercise_key)::int INTO v_pr_lifts
      FROM (SELECT * FROM public.client_load_records(c.id) UNION ALL SELECT * FROM public.client_rep_records(c.id)) x
     WHERE x.completed AND x.workout_at >= v_from AND x.workout_at < v_to AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr);

    SELECT count(*)::int, count(pc.id)::int INTO v_sched, v_done
      FROM public.pl_scheduled_workouts s
      LEFT JOIN public.pl_day_completions pc ON pc.scheduled_workout_id = s.id AND pc.completed_at IS NOT NULL
     WHERE s.client_id = c.id AND s.scheduled_date >= _week_start AND s.scheduled_date < _week_start + 7;

    SELECT max(pc.completed_at) INTO v_prev FROM public.pl_day_completions pc
     WHERE pc.client_id = c.id AND pc.completed_at IS NOT NULL AND pc.completed_at < v_from;
    v_gap := CASE WHEN v_prev IS NULL THEN NULL ELSE extract(day FROM (v_first_this - v_prev))::int END;

    v_streak := 0;
    WHILE v_streak < 52 AND EXISTS (
      SELECT 1 FROM public.pl_day_completions pc WHERE pc.client_id = c.id
         AND pc.completed_at >= ((_week_start - 7 * v_streak)::timestamp AT TIME ZONE tz)
         AND pc.completed_at < ((_week_start - 7 * v_streak + 7)::timestamp AT TIME ZONE tz)) LOOP
      v_streak := v_streak + 1;
    END LOOP;

    SELECT coalesce(sum(q.reps * q.load_kg) FILTER (WHERE q.workout_at >= v_from), 0),
           coalesce(sum(q.reps * q.load_kg) FILTER (WHERE q.workout_at < v_from), 0),
           coalesce(sum(q.reps) FILTER (WHERE q.workout_at >= v_from), 0)::int
      INTO v_vol, v_vol_prev, v_reps
      FROM public.client_qualifying_sets(c.id) q
     WHERE q.completed AND q.workout_at >= v_from - interval '7 days' AND q.workout_at < v_to;

    -- Best single win
    IF pr.scope IS NOT NULL THEN
      v_type := pr.scope;
      -- More PRs and a big-3 PR rank higher within the same kind of win.
      v_score := CASE pr.scope WHEN 'atpr' THEN 100 WHEN 'program_pr' THEN 85 ELSE 70 END
                 + least(coalesce(v_pr_lifts, 1), 10) + CASE WHEN pr.exercise_name ~* '(squat|bench|deadlift)' THEN 5 ELSE 0 END;
      v_lift := public.community_fmt_lift(pr.exercise_name);
      v_set := CASE WHEN v_hide OR public.community_fmt_load(pr.load_kg, c.unit) IS NULL THEN NULL
                    WHEN pr.reps = 1 THEN 'a ' || public.community_fmt_load(pr.load_kg, c.unit) || ' single'
                    ELSE public.community_fmt_load(pr.load_kg, c.unit) || ' for ' || pr.reps END;
      v_more := CASE WHEN v_pr_lifts >= 5 THEN ' ' || v_pr_lifts || ' PRs in one week.'
                     WHEN v_pr_lifts > 1 THEN ' That''s ' || v_pr_lifts || ' PRs on the week.' ELSE '' END;
      -- three ways to say each win; compose rotates them so lines next to
      -- each other never read the same
      v_texts := CASE pr.scope
        WHEN 'atpr' THEN ARRAY[
          v_name || ' hit an all-time PR on ' || v_lift || coalesce(', ' || v_set, '') || '.',
          'New all-time PR for ' || v_name || ' on ' || v_lift || '.' || coalesce(' ' || initcap(left(v_set, 1)) || substr(v_set, 2) || '.', ''),
          v_name || ' set a new all-time best on ' || v_lift || coalesce(', ' || v_set, '') || '.']
        WHEN 'program_pr' THEN ARRAY[
          v_name || ' hit a program PR on ' || v_lift || coalesce(', ' || v_set, '') || '.',
          v_name || ' beat their best on ' || v_lift || ' this program' || coalesce(', ' || v_set, '') || '.',
          'Program PR for ' || v_name || ' on ' || v_lift || coalesce(', ' || v_set, '') || '.']
        ELSE ARRAY[
          v_name || ' beat their best of this block on ' || v_lift || coalesce(', ' || v_set, '') || '.',
          'Block PR for ' || v_name || ' on ' || v_lift || coalesce(', ' || v_set, '') || '.',
          v_name || ' hit a block PR on ' || v_lift || coalesce(', ' || v_set, '') || '.']
      END;
      v_texts := ARRAY[v_texts[1] || v_more, v_texts[2] || v_more, v_texts[3] || v_more];
    ELSIF v_prev IS NULL THEN
      v_type := 'first_week'; v_score := 60;
      v_texts := ARRAY[
        'Welcome to the crew ' || v_name || '. First week done, ' || CASE WHEN v_sessions = 1 THEN 'first session in.' ELSE v_sessions || ' sessions in.' END,
        v_name || ' got their first week in the books. ' || CASE WHEN v_sessions = 1 THEN 'One session down.' ELSE v_sessions || ' sessions down.' END,
        'First week done for ' || v_name || '. ' || CASE WHEN v_sessions = 1 THEN 'That first session is the hardest one.' ELSE v_sessions || ' sessions in already.' END];
    ELSIF v_gap >= 14 THEN
      v_type := 'comeback'; v_score := 60;
      v_texts := ARRAY[
        v_name || ' is back after ' || v_gap || ' days off. The first one back is the hardest, and it''s done.',
        'Good to have ' || v_name || ' back after ' || v_gap || ' days away.',
        v_name || ' got back in after ' || v_gap || ' days off. That''s the hard part done.'];
    ELSIF v_sched >= 3 AND v_done >= v_sched THEN
      v_type := 'perfect_week'; v_score := 55;
      v_texts := ARRAY[
        v_name || ' went ' || v_done || ' for ' || v_sched || '. Didn''t miss a single session.',
        v_name || ' hit every session on the plan, ' || v_done || ' for ' || v_sched || '.',
        v_done || ' for ' || v_sched || ' from ' || v_name || '. Every session done.'];
    ELSIF v_streak >= 4 THEN
      v_type := 'streak'; v_score := 40 + least(v_streak, 20);
      v_texts := ARRAY[
        v_name || ' has trained ' || v_streak || ' weeks straight without missing one.',
        v_streak || ' weeks in a row for ' || v_name || '. That''s how it''s done.',
        v_name || ' hasn''t missed a week in ' || v_streak || ' weeks.'];
    ELSIF v_vol_prev > 0 AND v_vol >= v_vol_prev * 1.15 THEN
      v_type := 'volume'; v_score := 35;
      v_texts := ARRAY[
        v_name || ' moved ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more weight than the week before.',
        v_name || ' lifted ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more than the week before.',
        v_name || ' put up ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more total weight than the week before.'];
    ELSE
      v_type := 'sessions'; v_score := 10 + v_sessions * 3;
      v_texts := CASE WHEN v_sessions = 1 THEN array_fill(v_name || ' got a session in. That counts.', ARRAY[3])
                      ELSE ARRAY[v_name || ' got ' || v_sessions || ' sessions in.', v_sessions || ' sessions from ' || v_name || '.', v_name || ' put in ' || v_sessions || ' sessions.'] END;
    END IF;
    v_text := v_texts[1];

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'client_id', c.id, 'name', v_name, 'type', v_type, 'score', v_score, 'text', v_text, 'texts', to_jsonb(v_texts),
      'sessions', v_sessions, 'pr_lifts', coalesce(v_pr_lifts, 0), 'streak', v_streak,
      'volume_kg', round(v_vol), 'reps', v_reps));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_week_wins(date, uuid) FROM PUBLIC, anon, authenticated;

-- The crew's week in numbers, for the stats card under the post. Only
-- counts and percentages, nobody singled out.
CREATE OR REPLACE FUNCTION public.community_week_stats(_week_start date, _exclude_user uuid, _wins jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_from timestamptz := (_week_start::timestamp AT TIME ZONE tz);
  v_to timestamptz := ((_week_start + 7)::timestamp AT TIME ZONE tz);
  v_roster uuid[];
BEGIN
  SELECT array_agg(cl.id) INTO v_roster FROM public.clients cl
   WHERE cl.user_id IS NOT NULL
     AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
     AND coalesce(cl.status, '') <> 'Archived'
     AND coalesce(cl.portal_access_disabled, false) = false
     AND cl.user_id IS DISTINCT FROM _exclude_user;
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

-- The post itself: who's named (fair rotation), the words, and the stats.
-- NULL when nobody trained. Internal; publish and the coach preview call it.
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
    WHEN v_prs >= 10 THEN (ARRAY['Big week. ' || v_prs || ' PRs between all of you last week. Here''s who stood out.',
                                 'Last week was a good one. ' || v_prs || ' PRs across the crew, and some of you went off.'])[1 + v_wk % 2]
    WHEN v_n * 10 >= (v_stats->>'roster')::int * 6 THEN (ARRAY['Most of you showed up last week. Here''s what that looked like.',
                                                              'Good week from this group. Here are some of the highlights.'])[1 + v_wk % 2]
    ELSE (ARRAY['Here''s what last week looked like.', 'A few highlights from last week.'])[1 + v_wk % 2] END;
  v_outro := (ARRAY['Proud of you guys. Let''s keep it rolling this week.',
                    'That''s the standard now. Let''s go again.',
                    'Not on the list this week? Get your sessions in and you will be.',
                    'Keep stacking weeks like this. Let''s go.'])[1 + v_wk % 4];

  RETURN jsonb_build_object(
    'week_of', _week_start,
    'trainers', v_n,
    'featured', (SELECT jsonb_agg(jsonb_build_object('client_id', w->>'client_id', 'type', w->>'type')) FROM jsonb_array_elements(v_pick) w),
    'stats', v_stats,
    'caption', v_intro || E'\n\n' || v_lines || E'\n\n'
               || CASE WHEN v_rest IS NOT NULL
                       THEN 'Shoutout to ' || v_rest || ' too. ' || CASE WHEN v_rest_n = 1 THEN 'Showing up is the whole game.' ELSE 'Every one of you showed up.' END || E'\n\n'
                       ELSE '' END
               || v_outro);
END;
$$;
REVOKE ALL ON FUNCTION public.community_compose_wins(date, uuid) FROM PUBLIC, anon, authenticated;

-- ── Publish + coach overview: Wednesday Wins added ─────────────────────────
CREATE OR REPLACE FUNCTION public.community_publish_series(_series text DEFAULT NULL, _force boolean DEFAULT false, _at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_local timestamp := (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg');
  v_dow int := extract(isodow FROM v_local);
  v_series text := _series;
  v_settings record;
  v_author uuid;
  v_key text;
  v_item record;
  v_recent text[];
  v_id uuid;
  v_day int;
  v_start time;
  v_comp jsonb;
BEGIN
  -- Cron runs as the database owner (no auth.uid()); people must be coaches.
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_series IS NULL THEN
    v_series := CASE v_dow WHEN 1 THEN 'monday_motivation' WHEN 3 THEN 'wednesday_wins' WHEN 5 THEN 'finish_strong_friday' END;
    IF v_series IS NULL THEN RETURN jsonb_build_object('status', 'not_today'); END IF;
  END IF;
  IF v_series NOT IN ('monday_motivation', 'wednesday_wins', 'finish_strong_friday') THEN RAISE EXCEPTION 'Unknown series'; END IF;
  v_day := CASE v_series WHEN 'monday_motivation' THEN 1 WHEN 'wednesday_wins' THEN 3 ELSE 5 END;
  -- Mon/Fri 07:00, Wednesday Wins at noon (a 5-hour window each).
  v_start := CASE v_series WHEN 'wednesday_wins' THEN time '12:00' ELSE time '07:00' END;
  IF NOT coalesce(_force, false) THEN
    IF v_dow <> v_day OR v_local::time < v_start OR v_local::time >= v_start + interval '5 hours' THEN
      RETURN jsonb_build_object('status', 'outside_window');
    END IF;
  END IF;

  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RETURN jsonb_build_object('status', 'no_author'); END IF;

  v_key := v_series || ':' || to_char(v_local, 'IYYY-"W"IW');

  -- Wednesday Wins is written from last week's training, not the library.
  IF v_series = 'wednesday_wins' THEN
    v_comp := public.community_compose_wins((date_trunc('week', v_local)::date - 7), v_author);
    IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;
    INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
    INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at)
    VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
            v_comp->>'caption', v_series, v_key, v_comp->'stats', coalesce(_at, now()))
    RETURNING id INTO v_id;
    UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
    INSERT INTO public.community_series_features (series_key, client_id, win_type, featured_at)
    SELECT v_key, (f->>'client_id')::uuid, f->>'type', coalesce(_at, now()) FROM jsonb_array_elements(v_comp->'featured') f
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'featured', jsonb_array_length(v_comp->'featured'));
  END IF;

  -- Rotate: never a post that's been used more recently than another, and
  -- not the mentor of either of the last two posts (Monday or Friday).
  SELECT array_agg(x.mentor) INTO v_recent FROM (
    SELECT i.mentor FROM public.community_series_items i WHERE i.last_used_at IS NOT NULL ORDER BY i.last_used_at DESC LIMIT 2) x;
  SELECT * INTO v_item FROM public.community_series_items i
   WHERE i.series = v_series AND i.active
   ORDER BY (i.mentor = ANY (coalesce(v_recent, '{}'))) ASC, i.last_used_at ASC NULLS FIRST, i.sort_order, i.created_at
   LIMIT 1;
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('status', 'no_items'); END IF;

  -- Claim this week's slot first (the PK makes concurrent runs harmless).
  INSERT INTO public.community_series_runs (series_key, series, item_id) VALUES (v_key, v_series, v_item.id)
  ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, quote, quote_author, quote_source,
                                      series, series_key, series_item_id, created_at)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_item.body,
          v_item.quote, CASE WHEN v_item.quote IS NOT NULL THEN v_item.mentor END, v_item.quote_source,
          v_series, v_key, v_item.id, coalesce(_at, now()))
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

CREATE OR REPLACE FUNCTION public.community_series_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settings record;
  v_recent text[];
  v_local timestamp := now() AT TIME ZONE 'America/Winnipeg';
  v_wins_posted boolean;
  v_preview jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  SELECT array_agg(x.mentor) INTO v_recent FROM (
    SELECT i.mentor FROM public.community_series_items i WHERE i.last_used_at IS NOT NULL ORDER BY i.last_used_at DESC LIMIT 2) x;
  v_wins_posted := EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = 'wednesday_wins:' || to_char(v_local, 'IYYY-"W"IW'));
  -- Preview: what this Wednesday would say (or, once posted, next week's so far).
  v_preview := public.community_compose_wins(date_trunc('week', v_local)::date - CASE WHEN v_wins_posted THEN 0 ELSE 7 END,
                                              public.community_main_account(v_settings.author_user_id));
  RETURN jsonb_build_object(
    'wins_preview', CASE WHEN v_preview IS NOT NULL THEN jsonb_build_object('body', v_preview->>'caption', 'featured', jsonb_array_length(v_preview->'featured'),
                                                                             'trainers', v_preview->'trainers', 'week_of', v_preview->>'week_of', 'next_week', v_wins_posted,
                                                                             'stats', v_preview->'stats') END,
    'paused', coalesce(v_settings.paused, false),
    'author', CASE WHEN v_settings.author_user_id IS NOT NULL THEN public.community_author(v_settings.author_user_id) END,
    'next', coalesce((SELECT jsonb_object_agg(s.series, to_jsonb(n))
                        FROM (VALUES ('monday_motivation'), ('finish_strong_friday')) s(series)
                        CROSS JOIN LATERAL (
                          SELECT i.id, i.mentor, i.body, i.quote, i.quote_source FROM public.community_series_items i
                           WHERE i.series = s.series AND i.active
                           ORDER BY (i.mentor = ANY (coalesce(v_recent, '{}'))) ASC, i.last_used_at ASC NULLS FIRST, i.sort_order, i.created_at
                           LIMIT 1) n), '{}'::jsonb),
    'library', jsonb_build_object(
      'monday_motivation', (SELECT count(*) FROM public.community_series_items WHERE series = 'monday_motivation' AND active),
      'finish_strong_friday', (SELECT count(*) FROM public.community_series_items WHERE series = 'finish_strong_friday' AND active)),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'series', p.series, 'created_at', p.created_at,
                                                             'mentor', i.mentor, 'caption', left(p.caption, 120))
                                          ORDER BY p.created_at DESC)
                           FROM (SELECT * FROM public.community_posts WHERE series IS NOT NULL ORDER BY created_at DESC LIMIT 8) p
                           LEFT JOIN public.community_series_items i ON i.id = p.series_item_id), '[]'::jsonb),
    'this_week', jsonb_build_object(
      'wednesday_wins', v_wins_posted,
      'monday_motivation', EXISTS (SELECT 1 FROM public.community_series_runs r
                                    WHERE r.series_key = 'monday_motivation:' || to_char(now() AT TIME ZONE 'America/Winnipeg', 'IYYY-"W"IW')),
      'finish_strong_friday', EXISTS (SELECT 1 FROM public.community_series_runs r
                                       WHERE r.series_key = 'finish_strong_friday:' || to_char(now() AT TIME ZONE 'America/Winnipeg', 'IYYY-"W"IW'))));
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_overview() TO authenticated;
-- ── Read path: the stats ride along with the post ─────────────────────────
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
    'series_data', n.series_data,
    'edited_at', n.edited_at,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    -- "Hide my weights": loads are removed for everyone but the author.
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
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
REVOKE ALL ON FUNCTION public.community_post_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Schedule: Wednesdays, covering 12:00–17:00 Winnipeg in CST and CDT ────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'community-wednesday-wins';
  PERFORM cron.schedule('community-wednesday-wins', '*/15 16-23 * * 3', 'select public.community_publish_series(''wednesday_wins'');');
EXCEPTION WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
  RAISE NOTICE 'pg_cron not available; community-wednesday-wins not scheduled';
END $$;
