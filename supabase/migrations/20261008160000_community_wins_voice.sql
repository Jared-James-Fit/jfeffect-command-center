-- Wednesday Wins in Jared's own voice: gym shorthand (265lbs x 8, comp
-- deadlift, DB RDL), few commas, lowercase, "yall"/"thats"/"ur", and not
-- perfectly polished every week (paragraph starts are capitalized on odd
-- weeks only). Same facts, same rotation, same stats card.

-- "Competition Deadlift" -> "comp deadlift", "Barbell Bench Press" -> "bench",
-- "Romanian Deadlift - Dumbbell" -> "DB RDL", "Overhead Cable Triceps
-- Extension" -> "overhead cable tricep ext".
CREATE OR REPLACE FUNCTION public.community_fmt_lift_short(_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text := lower(public.community_fmt_lift(_name));
BEGIN
  s := regexp_replace(s, '\mcompetition\M', 'comp', 'g');
  s := regexp_replace(s, '\m(barbell |bb )?bench press\M', 'bench', 'g');
  s := regexp_replace(s, '\mromanian deadlifts?\M', 'RDL', 'g');
  s := regexp_replace(s, '\moverhead press\M', 'OHP', 'g');
  s := regexp_replace(s, '\mdumbbells?\M', 'DB', 'g');
  s := regexp_replace(s, '\mbarbell\M', 'BB', 'g');
  s := regexp_replace(s, '\mtriceps\M', 'tricep', 'g');
  s := regexp_replace(s, '\mextensions?\M', 'ext', 'g');
  s := regexp_replace(s, '\mrdl\M', 'RDL', 'g');
  s := regexp_replace(s, '\mohp\M', 'OHP', 'g');
  s := regexp_replace(s, '\mssb\M', 'SSB', 'g');
  s := regexp_replace(s, '\mez\M', 'EZ', 'g');
  s := regexp_replace(s, '\s*\([^)]*\)', '', 'g');
  RETURN btrim(regexp_replace(s, '\s+', ' ', 'g'));
END;
$$;

-- "265lbs x 8", "100kg x 3", "140kg single". NULL when there's no load.
CREATE OR REPLACE FUNCTION public.community_fmt_set(_kg numeric, _reps int, _unit text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _kg IS NULL OR _kg <= 0 THEN NULL
         ELSE CASE WHEN _unit = 'kg' THEN trim(trailing '.' FROM trim(trailing '0' FROM round(_kg, 1)::text)) || 'kg'
                   ELSE round(_kg * 2.20462)::int::text || 'lbs' END
              || CASE WHEN _reps = 1 THEN ' single' ELSE ' x ' || _reps END END
$$;

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
  v_unit text;
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
    SELECT x.exercise_id, x.exercise_name, x.reps, x.load_kg,
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
      v_lift := public.community_fmt_lift_short(pr.exercise_name);
      -- the unit they log this lift in (kg/lb toggle per exercise), else their default
      v_unit := coalesce((SELECT u.unit FROM public.client_exercise_unit_prefs u
                           WHERE u.client_id = c.id AND u.exercise_id = pr.exercise_id AND u.unit IN ('kg', 'lb') LIMIT 1), c.unit);
      v_set := CASE WHEN v_hide THEN NULL ELSE public.community_fmt_set(pr.load_kg, pr.reps, v_unit) END;
      v_more := CASE WHEN v_pr_lifts = 2 THEN ' + 1 more PR'
                     WHEN v_pr_lifts > 2 THEN ' + ' || (v_pr_lifts - 1) || ' more PRs' ELSE '' END;
      -- three ways to say each win (compose rotates them so lines next to
      -- each other never read the same). Written the way Jared texts:
      -- gym shorthand, few commas, not every sentence capitalized.
      v_texts := CASE
        WHEN v_set IS NULL THEN ARRAY[
          v_name || ' just hit a new ' || CASE pr.scope WHEN 'atpr' THEN 'all time' WHEN 'program_pr' THEN 'program' ELSE 'block' END || ' PR on ' || v_lift,
          'new ' || CASE pr.scope WHEN 'atpr' THEN 'all time' WHEN 'program_pr' THEN 'program' ELSE 'block' END || ' PR for ' || v_name || ' on ' || v_lift,
          v_name || ' PRd ' || v_lift || CASE pr.scope WHEN 'atpr' THEN ' best ever' WHEN 'program_pr' THEN ' best of the program' ELSE ' best of the block' END]
        WHEN pr.scope = 'atpr' THEN ARRAY[
          v_name || ' just hit ' || v_set || ' on ' || v_lift || '. all time PR',
          'new all time PR for ' || v_name || ' on ' || v_lift || ' ' || v_set,
          v_name || ' went ' || v_set || ' on ' || v_lift || ' for an all time PR']
        WHEN pr.scope = 'program_pr' THEN ARRAY[
          v_name || ' hit ' || v_set || ' on ' || v_lift || '. program PR',
          'program PR for ' || v_name || ' on ' || v_lift || ' ' || v_set,
          v_name || ' went ' || v_set || ' on ' || v_lift || ' best of the program so far']
        ELSE ARRAY[
          v_name || ' hit ' || v_set || ' on ' || v_lift || '. block PR',
          'block PR for ' || v_name || ' on ' || v_lift || ' ' || v_set,
          v_name || ' went ' || v_set || ' on ' || v_lift || ' best of the block']
      END;
      -- a big PR week gets its own reaction, worded differently per phrasing
      v_texts := CASE WHEN v_pr_lifts >= 5 THEN ARRAY[
                   v_texts[1] || '. ' || v_pr_lifts || ' PRs in 1 week thats insane',
                   v_texts[2] || '. ' || v_pr_lifts || ' PRs in 1 week crazy',
                   v_texts[3] || '. ' || v_pr_lifts || ' PRs on the week lowkey insane']
                 ELSE ARRAY[v_texts[1] || v_more, v_texts[2] || v_more, v_texts[3] || v_more] END;
    ELSIF v_prev IS NULL THEN
      v_type := 'first_week'; v_score := 60;
      v_texts := ARRAY[
        'welcome to the crew ' || v_name || '. ' || CASE WHEN v_sessions = 1 THEN 'first session in the books' ELSE 'first week done ' || v_sessions || ' sessions in' END,
        v_name || ' got their first week in the books. ' || CASE WHEN v_sessions = 1 THEN '1 session down' ELSE v_sessions || ' sessions down' END,
        'first week done for ' || v_name || CASE WHEN v_sessions = 1 THEN '. first one is always the hardest' ELSE ' and already ' || v_sessions || ' sessions in' END];
    ELSIF v_gap >= 14 THEN
      v_type := 'comeback'; v_score := 60;
      v_texts := ARRAY[
        v_name || ' is back after ' || v_gap || ' days off. first one back is the hardest and its done',
        'good to have ' || v_name || ' back in after ' || v_gap || ' days away',
        v_name || ' got back in after ' || v_gap || ' days off. hardest part done'];
    ELSIF v_sched >= 3 AND v_done >= v_sched THEN
      v_type := 'perfect_week'; v_score := 55;
      v_texts := ARRAY[
        v_name || ' went ' || v_done || ' for ' || v_sched || ' didnt miss a single session',
        v_name || ' hit every session on the plan ' || v_done || '/' || v_sched,
        v_done || '/' || v_sched || ' from ' || v_name || '. every session done'];
    ELSIF v_streak >= 4 THEN
      v_type := 'streak'; v_score := 40 + least(v_streak, 20);
      v_texts := ARRAY[
        v_name || ' has trained ' || v_streak || ' weeks straight no misses',
        v_streak || ' weeks in a row for ' || v_name || '. thats how its done',
        v_name || ' hasnt missed a week in ' || v_streak || ' weeks fr'];
    ELSIF v_vol_prev > 0 AND v_vol >= v_vol_prev * 1.15 THEN
      v_type := 'volume'; v_score := 35;
      v_texts := ARRAY[
        v_name || ' moved ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more weight than the week before',
        v_name || ' lifted ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more than last week',
        v_name || ' put up ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more total volume vs the week before'];
    ELSE
      v_type := 'sessions'; v_score := 10 + v_sessions * 3;
      v_texts := CASE WHEN v_sessions = 1 THEN array_fill(v_name || ' got a session in and that counts', ARRAY[3])
                      ELSE ARRAY[v_name || ' got ' || v_sessions || ' sessions in', v_sessions || ' sessions from ' || v_name, v_name || ' put in ' || v_sessions || ' sessions'] END;
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
    WHEN v_prs >= 10 THEN (ARRAY['big week. ' || v_prs || ' PRs between all of you last week heres who stood out',
                                 'last week was a good one. ' || v_prs || ' PRs across the crew and some of you went off'])[1 + v_wk % 2]
    WHEN v_n * 10 >= (v_stats->>'roster')::int * 6 THEN (ARRAY['most of you showed up last week heres what that looked like',
                                                              'good week from this group. some highlights'])[1 + v_wk % 2]
    ELSE (ARRAY['heres what last week looked like', 'few highlights from last week'])[1 + v_wk % 2] END;
  v_outro := (ARRAY['proud of yall. lets keep it rolling this week 🔥',
                    'thats the standard now. lets go again',
                    'not on the list this week? get ur sessions in and u will be',
                    'keep stacking weeks like this. lets gooo'])[1 + v_wk % 4];

  v_caption := v_intro || E'\n\n' || v_lines || E'\n\n'
    || CASE WHEN v_rest IS NULL THEN ''
            WHEN v_rest_n = 1 THEN 'shoutout to ' || v_rest || ' too. showing up is the whole game' || E'\n\n'
            ELSE (ARRAY['shoutout to ' || v_rest || ' too. every one of you showed up',
                        'also big shoutout to ' || v_rest || '. yall showed up and thats the whole game',
                        v_rest || ' yall showed up too and it counts'])[1 + v_wk % 3] || E'\n\n' END
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
