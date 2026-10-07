-- Wednesday Wins: a PR line shows the weight in the unit the athlete logs
-- that lift in (the per-exercise kg/lb toggle), falling back to their
-- account default. Before, it always used the account default, so a bench
-- logged in kg would have read as converted pounds.

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
      v_lift := public.community_fmt_lift(pr.exercise_name);
      -- the unit they log this lift in (kg/lb toggle per exercise), else their default
      v_unit := coalesce((SELECT u.unit FROM public.client_exercise_unit_prefs u
                           WHERE u.client_id = c.id AND u.exercise_id = pr.exercise_id AND u.unit IN ('kg', 'lb') LIMIT 1), c.unit);
      v_set := CASE WHEN v_hide OR public.community_fmt_load(pr.load_kg, v_unit) IS NULL THEN NULL
                    WHEN pr.reps = 1 THEN 'a ' || public.community_fmt_load(pr.load_kg, v_unit) || ' single'
                    ELSE public.community_fmt_load(pr.load_kg, v_unit) || ' for ' || pr.reps END;
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
