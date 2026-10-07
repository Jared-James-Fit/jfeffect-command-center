-- Same workout identity everywhere: records, points summary and community stats.
--
-- A finished workout's key is the key of its logged sets. Normally that is the
-- completion's own key, but legacy sets (logged before Aug 2026 without a
-- scheduled_workout_id) that were finished through a scheduled instance live
-- under 'day:<day_id>'. This mirrors the fallback in client_qualifying_sets
-- (20261007090000): the instance logged no sets of its own, the day has no
-- legacy completion, and legacy sets exist for that day.

CREATE OR REPLACE FUNCTION public.completion_workout_key(_completion_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN pc.scheduled_workout_id IS NULL THEN 'day:' || pc.day_id
    WHEN NOT EXISTS (SELECT 1 FROM public.pl_row_results r
                      WHERE r.scheduled_workout_id = pc.scheduled_workout_id AND r.client_id = pc.client_id)
     AND NOT EXISTS (SELECT 1 FROM public.pl_day_completions l
                      WHERE l.client_id = pc.client_id AND l.day_id = pc.day_id
                        AND l.scheduled_workout_id IS NULL AND l.completed_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.pl_row_results r JOIN public.pl_exercise_rows e ON e.id = r.row_id
                  WHERE r.client_id = pc.client_id AND r.scheduled_workout_id IS NULL AND e.day_id = pc.day_id
                    AND r.completed_at IS NOT NULL)
    THEN 'day:' || pc.day_id
    ELSE 'sw:' || pc.scheduled_workout_id END
  FROM public.pl_day_completions pc WHERE pc.id = _completion_id
$$;
REVOKE ALL ON FUNCTION public.completion_workout_key(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_workout_stats(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pc record;
  k text;
  tz text;
  v_title text;
  v_working int := 0;
  v_tonnage numeric := 0;
  v_top jsonb;
  v_prs jsonb := '[]'::jsonb;
  v_pr_count int := 0;
  v_month int := 0;
  v_week int := 0;
BEGIN
  SELECT * INTO pc FROM public.pl_day_completions WHERE id = _completion_id AND completed_at IS NOT NULL;
  IF pc.id IS NULL THEN RETURN NULL; END IF;
  k := public.completion_workout_key(pc.id);
  SELECT coalesce(nullif(btrim(c.timezone), ''), 'America/Winnipeg') INTO tz FROM public.clients c WHERE c.id = pc.client_id;
  tz := coalesce(tz, 'America/Winnipeg');

  SELECT coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout')
    INTO v_title FROM public.pl_days d WHERE d.id = pc.day_id;

  SELECT count(*)::int INTO v_working
    FROM public.pl_row_results r
    JOIN public.pl_exercise_rows e ON e.id = r.row_id
   WHERE r.client_id = pc.client_id
     AND r.completed_at IS NOT NULL
     AND coalesce(r.is_working_set, true)
     AND (CASE WHEN r.scheduled_workout_id IS NOT NULL THEN 'sw:' || r.scheduled_workout_id ELSE 'day:' || e.day_id END) = k;

  SELECT coalesce(round(sum(s.load_kg * s.reps), 1), 0) INTO v_tonnage
    FROM public.client_qualifying_sets(pc.client_id) s WHERE s.workout_key = k;

  -- Primary lift = the first programmed exercise with a qualifying set; its
  -- best set across ALL of its rows (a ramp/top-set row before the work sets
  -- must not become the headline).
  WITH qs AS (
    SELECT s.exercise_key, s.exercise_name, s.reps, s.load_kg, e.sort_order
      FROM public.client_qualifying_sets(pc.client_id) s
      JOIN public.pl_row_results r ON r.id = s.set_id
      JOIN public.pl_exercise_rows e ON e.id = r.row_id
     WHERE s.workout_key = k
  ),
  primary_lift AS (SELECT qs.exercise_key FROM qs ORDER BY qs.sort_order ASC LIMIT 1)
  SELECT jsonb_build_object('exercise_name', t.exercise_name, 'reps', t.reps, 'load_kg', t.load_kg)
    INTO v_top
    FROM (
      SELECT qs.exercise_name, qs.reps, qs.load_kg
        FROM qs JOIN primary_lift pl ON pl.exercise_key = qs.exercise_key
       ORDER BY (qs.load_kg * (1 + qs.reps / 30.0)) DESC, qs.load_kg DESC
       LIMIT 1) t;

  WITH rec AS (
    SELECT x.exercise_key, x.exercise_name, x.reps, x.load_kg,
           CASE WHEN x.is_atpr THEN 3 WHEN x.is_program_pr THEN 2 WHEN x.is_block_pr THEN 1 ELSE 0 END AS tier
      FROM public.client_rep_records(pc.client_id) x
     WHERE x.workout_key = k AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr)
    UNION ALL
    SELECT y.exercise_key, y.exercise_name, y.reps, y.load_kg,
           CASE WHEN y.is_atpr THEN 3 WHEN y.is_program_pr THEN 2 WHEN y.is_block_pr THEN 1 ELSE 0 END
      FROM public.client_load_records(pc.client_id) y
     WHERE y.workout_key = k AND (y.is_atpr OR y.is_program_pr OR y.is_block_pr)
  ),
  per_lift AS (
    SELECT DISTINCT ON (exercise_key) exercise_key, exercise_name, reps, load_kg, tier
      FROM rec ORDER BY exercise_key, tier DESC, load_kg DESC, reps DESC
  )
  SELECT (SELECT count(*) FROM per_lift)::int,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                     'exercise_name', q.exercise_name, 'reps', q.reps, 'load_kg', q.load_kg,
                     'scope', CASE q.tier WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' ELSE 'block_pr' END)
                   ORDER BY q.tier DESC, q.load_kg DESC)
                     FROM (SELECT * FROM per_lift ORDER BY tier DESC, load_kg DESC LIMIT 3) q), '[]'::jsonb)
    INTO v_pr_count, v_prs;

  -- Completed sessions in the same local month / ISO week, up to and including this one.
  SELECT count(*) FILTER (WHERE date_trunc('month', c2.completed_at AT TIME ZONE tz) = date_trunc('month', pc.completed_at AT TIME ZONE tz))::int,
         count(*) FILTER (WHERE date_trunc('week', c2.completed_at AT TIME ZONE tz) = date_trunc('week', pc.completed_at AT TIME ZONE tz))::int
    INTO v_month, v_week
    FROM public.pl_day_completions c2
   WHERE c2.client_id = pc.client_id
     AND c2.completed_at IS NOT NULL
     AND c2.completed_at <= pc.completed_at
     AND c2.completed_at >= pc.completed_at - interval '32 days';

  RETURN jsonb_build_object(
    'workout_title', v_title,
    'completed_at', pc.completed_at,
    'duration_min', nullif(pc.actual_duration_min, 0),
    'working_sets', v_working,
    'tonnage_kg', v_tonnage,
    'top_lift', v_top,
    'pr_count', v_pr_count,
    'prs', v_prs,
    'month_sessions', v_month,
    'week_sessions', v_week);
END;
$$;
REVOKE ALL ON FUNCTION public.community_workout_stats(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_workout_exercises(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pc record;
  k text;
  v_out jsonb;
BEGIN
  SELECT * INTO pc FROM public.pl_day_completions WHERE id = _completion_id AND completed_at IS NOT NULL;
  IF pc.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  k := public.completion_workout_key(pc.id);

  WITH sets AS (
    SELECT r.id AS set_id, e.sort_order,
           coalesce(x.name, nullif(btrim(e.exercise_name_override), ''), 'Exercise') AS name,
           CASE WHEN e.exercise_id IS NOT NULL THEN 'id:' || e.exercise_id
                ELSE 'name:' || public.pl_norm_exercise_name(e.exercise_name_override) END AS ekey,
           r.actual_reps, r.completed_duration_seconds
      FROM public.pl_row_results r
      JOIN public.pl_exercise_rows e ON e.id = r.row_id
      LEFT JOIN public.exercises x ON x.id = e.exercise_id
     WHERE r.client_id = pc.client_id
       AND r.completed_at IS NOT NULL
       AND coalesce(r.is_working_set, true)
       AND (CASE WHEN r.scheduled_workout_id IS NOT NULL THEN 'sw:' || r.scheduled_workout_id ELSE 'day:' || e.day_id END) = k
  ),
  q AS (SELECT s.set_id, s.load_kg, s.reps FROM public.client_qualifying_sets(pc.client_id) s WHERE s.workout_key = k),
  rec AS (
    SELECT z.exercise_key, max(z.tier) AS tier FROM (
      SELECT x.exercise_key, CASE WHEN x.is_atpr THEN 3 WHEN x.is_program_pr THEN 2 WHEN x.is_block_pr THEN 1 ELSE 0 END AS tier
        FROM public.client_rep_records(pc.client_id) x WHERE x.workout_key = k
      UNION ALL
      SELECT y.exercise_key, CASE WHEN y.is_atpr THEN 3 WHEN y.is_program_pr THEN 2 WHEN y.is_block_pr THEN 1 ELSE 0 END
        FROM public.client_load_records(pc.client_id) y WHERE y.workout_key = k
    ) z GROUP BY z.exercise_key
  ),
  per AS (
    SELECT ekey, min(sort_order) AS so, min(name) AS name, count(*)::int AS n,
           max(actual_reps) AS max_reps, max(completed_duration_seconds) AS max_secs
      FROM sets GROUP BY ekey
  ),
  best AS (
    SELECT DISTINCT ON (sets.ekey) sets.ekey, q.load_kg, q.reps
      FROM sets JOIN q ON q.set_id = sets.set_id
     ORDER BY sets.ekey, (q.load_kg * (1 + q.reps / 30.0)) DESC, q.load_kg DESC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', per.name,
           'sets', per.n,
           'best_load_kg', best.load_kg,
           'best_reps', best.reps,
           'max_reps', per.max_reps,
           'max_seconds', per.max_secs,
           'pr', CASE coalesce(rec.tier, 0) WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' WHEN 1 THEN 'block_pr' END)
         ORDER BY per.so, per.name), '[]'::jsonb)
    INTO v_out
    FROM per
    LEFT JOIN best ON best.ekey = per.ekey
    LEFT JOIN rec ON rec.exercise_key = per.ekey;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_workout_exercises(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.workout_points_summary(_client_id uuid, _scheduled_workout_id uuid DEFAULT NULL, _day_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text;
  comp record;
  b record;
  completed_pts int := 0;
  logged_pts int := 0;
  record_pts int := 0;
  earlier_total int := 0;
  upgrade_total int := 0;
  lifts jsonb := '[]'::jsonb;
  level jsonb := '[]'::jsonb;
  level_total int := 0;
BEGIN
  IF NOT public.can_view_client_training(_client_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  k := CASE WHEN _scheduled_workout_id IS NOT NULL THEN 'sw:' || _scheduled_workout_id ELSE 'day:' || _day_id END;

  SELECT pc.* INTO comp FROM public.pl_day_completions pc
   WHERE pc.client_id = _client_id AND pc.completed_at IS NOT NULL
     AND (pc.scheduled_workout_id = _scheduled_workout_id
       OR (pc.day_id = _day_id AND public.completion_workout_key(pc.id) = k))
   ORDER BY pc.completed_at LIMIT 1;
  IF comp.id IS NULL THEN RETURN NULL; END IF;
  -- Records live under the key of the sets actually logged for this completion.
  k := public.completion_workout_key(comp.id);

  SELECT * INTO b FROM public.league_month_bounds((comp.completed_at AT TIME ZONE public.league_tz())::date, now());

  -- League: completion + logging (from the same trigger-awarded events the league counts).
  IF EXISTS (SELECT 1 FROM public.athlete_xp_events e WHERE e.client_id = _client_id AND e.source_id = comp.id
               AND e.event_type = 'workout_completed' AND e.occurred_at >= b.start_at AND e.occurred_at < b.end_at) THEN
    completed_pts := 10;
  END IF;
  IF EXISTS (SELECT 1 FROM public.athlete_xp_events e WHERE e.client_id = _client_id AND e.source_id = comp.id
               AND e.event_type = 'workout_fully_logged' AND e.occurred_at >= b.start_at AND e.occurred_at < b.end_at) THEN
    logged_pts := 5;
  END IF;

  -- League: record points this workout unlocked.
  IF b.month_start >= public.league_records_start_month() THEN
    WITH r AS (
      SELECT x.workout_key, x.workout_at, x.completed, x.exercise_key, x.exercise_name, x.is_atpr, x.is_program_pr, x.is_block_pr
        FROM public.client_rep_records(_client_id) x
      UNION ALL
      SELECT y.workout_key, y.workout_at, y.completed, y.exercise_key, y.exercise_name, y.is_atpr, y.is_program_pr, y.is_block_pr
        FROM public.client_load_records(_client_id) y
    ),
    month_r AS (
      SELECT r.*, CASE WHEN r.is_atpr THEN 3 WHEN r.is_program_pr THEN 2 WHEN r.is_block_pr THEN 1 ELSE 0 END tier
        FROM r WHERE r.completed AND r.workout_at >= b.start_at AND r.workout_at < b.end_at
    ),
    this_w AS (
      SELECT m.exercise_key, min(m.exercise_name) exercise_name, max(m.tier) tier
        FROM month_r m WHERE m.workout_key = k AND m.tier > 0 GROUP BY 1
    ),
    before_w AS (
      SELECT m.exercise_key, max(m.tier) tier
        FROM month_r m WHERE m.workout_key <> k AND m.workout_at < comp.completed_at AND m.tier > 0 GROUP BY 1
    ),
    pts AS (
      SELECT t.exercise_key, t.exercise_name, t.tier,
             CASE t.tier WHEN 3 THEN 10 WHEN 2 THEN 5 WHEN 1 THEN 3 ELSE 0 END
             - CASE coalesce(bw.tier, 0) WHEN 3 THEN 10 WHEN 2 THEN 5 WHEN 1 THEN 3 ELSE 0 END AS upgrade
        FROM this_w t LEFT JOIN before_w bw USING (exercise_key)
    )
    SELECT coalesce(sum(greatest(p.upgrade, 0)), 0)::int,
           coalesce(jsonb_agg(jsonb_build_object('exercise_name', p.exercise_name,
             'scope', CASE p.tier WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' ELSE 'block_pr' END,
             'points', greatest(p.upgrade, 0)) ORDER BY p.upgrade DESC, p.exercise_name)
             FILTER (WHERE p.upgrade > 0), '[]'::jsonb)
      INTO upgrade_total, lifts
      FROM pts p;

    SELECT least(40, coalesce(sum(CASE x.tier WHEN 3 THEN 10 WHEN 2 THEN 5 WHEN 1 THEN 3 ELSE 0 END), 0))::int
      INTO earlier_total
      FROM (
        SELECT m.exercise_key, max(m.tier) tier FROM (
          SELECT r2.exercise_key, CASE WHEN r2.is_atpr THEN 3 WHEN r2.is_program_pr THEN 2 WHEN r2.is_block_pr THEN 1 ELSE 0 END tier
            FROM (
              SELECT x.workout_key, x.workout_at, x.completed, x.exercise_key, x.is_atpr, x.is_program_pr, x.is_block_pr FROM public.client_rep_records(_client_id) x
              UNION ALL
              SELECT y.workout_key, y.workout_at, y.completed, y.exercise_key, y.is_atpr, y.is_program_pr, y.is_block_pr FROM public.client_load_records(_client_id) y
            ) r2
           WHERE r2.completed AND r2.workout_key <> k AND r2.workout_at >= b.start_at AND r2.workout_at < comp.completed_at
        ) m GROUP BY 1
      ) x;
    record_pts := least(upgrade_total, greatest(0, 40 - earlier_total));
  END IF;

  -- Logging Level points for this workout.
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', e.label, 'event_type', e.event_type, 'xp', e.xp) ORDER BY e.occurred_at), '[]'::jsonb),
         coalesce(sum(e.xp), 0)::int
    INTO level, level_total
    FROM public.athlete_xp_events e
   WHERE e.client_id = _client_id
     AND ((e.source_table = 'pl_day_completions' AND e.source_id = comp.id)
       OR (e.source_table = 'pl_workout_feedback' AND e.source_id IN (SELECT f.id FROM public.pl_workout_feedback f WHERE f.completion_id = comp.id)));

  RETURN jsonb_build_object(
    'month_start', b.month_start,
    'league', jsonb_build_object(
      'completed', completed_pts,
      'fully_logged', logged_pts,
      'records', record_pts,
      'record_lifts', lifts,
      'record_cap_hit', upgrade_total > record_pts,
      'total', completed_pts + logged_pts + record_pts),
    'level', jsonb_build_object('events', level, 'total', level_total));
END;
$$;
GRANT EXECUTE ON FUNCTION public.workout_points_summary(uuid, uuid, uuid) TO authenticated;
