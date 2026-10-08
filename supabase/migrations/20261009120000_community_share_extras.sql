-- Share cards people can read without lifting: a workout receipt, a 4-week
-- "showed up" calendar and "vs last time". Only the composer preview (the
-- athlete's own workout) gets these; the feed payload is unchanged.

CREATE OR REPLACE FUNCTION public.community_completion_extras(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pc record;
  k text;
  tz text;
  v_title text;
  v_local date;
  v_reps int := 0;
  v_lifetime int := 0;
  v_streak int := 0;
  v_days jsonb := '[]'::jsonb;
  v_prev_id uuid;
  v_prev jsonb;
  wk date;
BEGIN
  SELECT * INTO pc FROM public.pl_day_completions WHERE id = _completion_id AND completed_at IS NOT NULL;
  IF pc.id IS NULL THEN RETURN '{}'::jsonb; END IF;
  k := public.completion_workout_key(pc.id);
  SELECT coalesce(nullif(btrim(c.timezone), ''), 'America/Winnipeg') INTO tz FROM public.clients c WHERE c.id = pc.client_id;
  tz := coalesce(tz, 'America/Winnipeg');
  v_local := (pc.completed_at AT TIME ZONE tz)::date;
  SELECT nullif(btrim(d.title), '') INTO v_title FROM public.pl_days d WHERE d.id = pc.day_id;

  -- Every rep of every finished working set.
  SELECT coalesce(sum(greatest(coalesce(r.actual_reps, 0), 0)), 0)::int INTO v_reps
    FROM public.pl_row_results r
    JOIN public.pl_exercise_rows e ON e.id = r.row_id
   WHERE r.client_id = pc.client_id
     AND r.completed_at IS NOT NULL
     AND coalesce(r.is_working_set, true)
     AND (CASE WHEN r.scheduled_workout_id IS NOT NULL THEN 'sw:' || r.scheduled_workout_id ELSE 'day:' || e.day_id END) = k;

  -- "Workout #142": every finished session up to and including this one.
  SELECT count(*)::int INTO v_lifetime
    FROM public.pl_day_completions c2
   WHERE c2.client_id = pc.client_id AND c2.completed_at IS NOT NULL AND c2.completed_at <= pc.completed_at;

  -- Local days trained in the 4 calendar weeks (Mon-Sun) ending this week.
  SELECT coalesce(jsonb_agg(DISTINCT to_char((c2.completed_at AT TIME ZONE tz)::date, 'YYYY-MM-DD')), '[]'::jsonb) INTO v_days
    FROM public.pl_day_completions c2
   WHERE c2.client_id = pc.client_id AND c2.completed_at IS NOT NULL
     AND c2.completed_at <= pc.completed_at
     AND (c2.completed_at AT TIME ZONE tz)::date >= date_trunc('week', v_local)::date - 21;

  -- Weeks in a row with at least one workout, counting back from this one.
  wk := date_trunc('week', v_local)::date;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.pl_day_completions c2
       WHERE c2.client_id = pc.client_id AND c2.completed_at IS NOT NULL
         AND c2.completed_at <= pc.completed_at
         AND date_trunc('week', c2.completed_at AT TIME ZONE tz)::date = wk);
    v_streak := v_streak + 1;
    EXIT WHEN v_streak >= 104;
    wk := wk - 7;
  END LOOP;

  -- The same workout (same day name) the last time they did it.
  IF v_title IS NOT NULL THEN
    SELECT c2.id INTO v_prev_id
      FROM public.pl_day_completions c2 JOIN public.pl_days d2 ON d2.id = c2.day_id
     WHERE c2.client_id = pc.client_id AND c2.completed_at IS NOT NULL
       AND c2.completed_at < pc.completed_at AND c2.id <> pc.id
       AND btrim(d2.title) = v_title
     ORDER BY c2.completed_at DESC LIMIT 1;
    IF v_prev_id IS NOT NULL THEN
      SELECT jsonb_build_object('completed_at', s->'completed_at', 'tonnage_kg', s->'tonnage_kg',
                                'working_sets', s->'working_sets', 'top_lift', s->'top_lift')
        INTO v_prev FROM (SELECT public.community_workout_stats(v_prev_id) AS s) x;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'local_date', to_char(v_local, 'YYYY-MM-DD'),
    'total_reps', v_reps,
    'lifetime_sessions', v_lifetime,
    'streak_weeks', v_streak,
    'days_trained', v_days,
    'prev', v_prev);
END;
$$;
REVOKE ALL ON FUNCTION public.community_completion_extras(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_completion_preview(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
     WHERE pc.id = _completion_id AND c.user_id = auth.uid() AND pc.completed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN public.community_workout_stats(_completion_id)
         || jsonb_build_object('exercises', public.community_workout_exercises(_completion_id))
         || public.community_completion_extras(_completion_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_completion_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_completion_preview(uuid) TO authenticated;
