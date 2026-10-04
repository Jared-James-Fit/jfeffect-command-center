-- Points a single workout earned, for the post-workout recap.
--
-- league: Performance League points this workout added to its month —
--   completed +10, fully logged +5, plus the record points it actually
--   unlocked: per lift, only the upgrade over the best tier already earned on
--   that lift earlier in the month (ATPR 10 / PROGRAM 5 / BLOCK 3), and never
--   beyond what's left of the 40-point monthly record cap. Mirrors
--   league_month_scores, so the recap and the leaderboard always agree.
-- level: Logging Level points (athlete_xp_events) awarded for this workout —
--   completion, full logging and the workout review.

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
     AND ((_scheduled_workout_id IS NOT NULL AND pc.scheduled_workout_id = _scheduled_workout_id)
       OR (_scheduled_workout_id IS NULL AND pc.scheduled_workout_id IS NULL AND pc.day_id = _day_id))
   ORDER BY pc.completed_at LIMIT 1;
  IF comp.id IS NULL THEN RETURN NULL; END IF;

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
