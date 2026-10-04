-- Weight records: the heaviest load ever lifted on an exercise, regardless of
-- reps. Complements the rep records ("best load for N reps"): going from
-- 10 lb × 12 to 15 lb × 12 is a 12-REP ATPR *and* a WEIGHT ATPR when 15 lb is
-- more than anything previously lifted on that exercise.
--
-- Same rules as rep records: compared against earlier *completed* workouts
-- (ordered by completion, or by when sets were logged for an open/reopened
-- workout), +0.25 kg tolerance, ATPR / PROGRAM PR / BLOCK PR scopes, and a
-- first-ever exposure is never a record.

CREATE OR REPLACE FUNCTION public.client_load_records(_client_id uuid)
RETURNS TABLE(workout_key text, workout_at timestamptz, completed boolean, block_id uuid, prep_id uuid,
              exercise_key text, exercise_id uuid, exercise_name text, reps int, load_kg numeric, set_id uuid,
              prev_all_kg numeric, prev_program_kg numeric, prev_block_kg numeric,
              is_atpr boolean, is_program_pr boolean, is_block_pr boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT q.*, coalesce(q.workout_at, min(q.set_completed_at) OVER (PARTITION BY q.workout_key)) AS ord
      FROM public.client_qualifying_sets(_client_id) q
  ),
  -- Heaviest set per workout per exercise (most reps breaks ties).
  hb AS (
    SELECT DISTINCT ON (s.workout_key, s.exercise_key)
           s.workout_key, s.workout_at, s.ord, s.completed, s.block_id, s.prep_id,
           s.exercise_key, s.exercise_id, s.exercise_name, s.reps, s.load_kg, s.set_id
      FROM s
     ORDER BY s.workout_key, s.exercise_key, s.load_kg DESC, s.reps DESC, s.set_id
  )
  SELECT h.workout_key, h.workout_at, h.completed, h.block_id, h.prep_id, h.exercise_key, h.exercise_id,
         h.exercise_name, h.reps, h.load_kg, h.set_id,
         b.prev_all, b.prev_prog, b.prev_block,
         b.prev_all IS NOT NULL AND h.load_kg > b.prev_all + 0.25,
         h.prep_id IS NOT NULL AND b.prev_prog IS NOT NULL AND h.load_kg > b.prev_prog + 0.25,
         b.prev_block IS NOT NULL AND h.load_kg > b.prev_block + 0.25
    FROM hb h
    LEFT JOIN LATERAL (
      SELECT max(p.load_kg) AS prev_all,
             max(p.load_kg) FILTER (WHERE p.prep_id = h.prep_id) AS prev_prog,
             max(p.load_kg) FILTER (WHERE p.block_id = h.block_id) AS prev_block
        FROM hb p
       WHERE p.completed AND p.exercise_key = h.exercise_key
         AND p.workout_key <> h.workout_key AND p.ord < h.ord
    ) b ON true
$$;
REVOKE ALL ON FUNCTION public.client_load_records(uuid) FROM PUBLIC, anon, authenticated;

-- Workout view: rep records + weight records + tonnage.
CREATE OR REPLACE FUNCTION public.workout_records(_client_id uuid, _scheduled_workout_id uuid DEFAULT NULL, _day_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; t record; recs jsonb; loads jsonb; ex jsonb;
BEGIN
  IF NOT public.can_view_client_training(_client_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  k := CASE WHEN _scheduled_workout_id IS NOT NULL THEN 'sw:' || _scheduled_workout_id ELSE 'day:' || _day_id END;
  SELECT * INTO t FROM public.client_workout_tonnage(_client_id) x WHERE x.workout_key = k;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'set_id', r.set_id, 'exercise_id', r.exercise_id, 'exercise_key', r.exercise_key, 'exercise_name', r.exercise_name,
           'reps', r.reps, 'load_kg', r.load_kg,
           'atpr', r.is_atpr, 'program_pr', r.is_program_pr, 'block_pr', r.is_block_pr,
           'prev_all_kg', r.prev_all_kg, 'prev_program_kg', r.prev_program_kg, 'prev_block_kg', r.prev_block_kg)
         ORDER BY r.is_atpr DESC, r.is_program_pr DESC, r.load_kg * r.reps DESC), '[]'::jsonb)
    INTO recs
    FROM public.client_rep_records(_client_id) r
   WHERE r.workout_key = k AND (r.is_atpr OR r.is_program_pr OR r.is_block_pr);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'set_id', l.set_id, 'exercise_id', l.exercise_id, 'exercise_key', l.exercise_key, 'exercise_name', l.exercise_name,
           'reps', l.reps, 'load_kg', l.load_kg,
           'atpr', l.is_atpr, 'program_pr', l.is_program_pr, 'block_pr', l.is_block_pr,
           'prev_all_kg', l.prev_all_kg, 'prev_program_kg', l.prev_program_kg, 'prev_block_kg', l.prev_block_kg)
         ORDER BY l.is_atpr DESC, l.is_program_pr DESC, l.load_kg DESC), '[]'::jsonb)
    INTO loads
    FROM public.client_load_records(_client_id) l
   WHERE l.workout_key = k AND (l.is_atpr OR l.is_program_pr OR l.is_block_pr);
  SELECT coalesce(jsonb_agg(jsonb_build_object('exercise_key', q.exercise_key, 'exercise_name', q.exercise_name, 'tonnage_kg', q.t)
           ORDER BY q.t DESC), '[]'::jsonb)
    INTO ex
    FROM (SELECT s.exercise_key, min(s.exercise_name) exercise_name, round(sum(s.load_kg * s.reps), 1) t
            FROM public.client_qualifying_sets(_client_id) s WHERE s.workout_key = k GROUP BY 1) q;
  RETURN jsonb_build_object(
    'workout_key', k,
    'tonnage_kg', coalesce(t.tonnage_kg, 0),
    'tonnage', jsonb_build_object('atpr', coalesce(t.is_atpr, false), 'program_pr', coalesce(t.is_program_pr, false),
                                  'block_pr', coalesce(t.is_block_pr, false), 'prev_all_kg', t.prev_all_kg,
                                  'prev_program_kg', t.prev_program_kg, 'prev_block_kg', t.prev_block_kg),
    'records', recs,
    'load_records', loads,
    'exercise_tonnage', ex);
END;
$$;
GRANT EXECUTE ON FUNCTION public.workout_records(uuid, uuid, uuid) TO authenticated;

-- Coach view: recent rep records, weight records and tonnage records.
CREATE OR REPLACE FUNCTION public.client_recent_records(_client_id uuid, _since timestamptz DEFAULT now() - interval '60 days')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_client_training(_client_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'records', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'workout_key', r.workout_key, 'at', r.workout_at, 'exercise_id', r.exercise_id, 'exercise_name', r.exercise_name,
        'reps', r.reps, 'load_kg', r.load_kg, 'atpr', r.is_atpr, 'program_pr', r.is_program_pr, 'block_pr', r.is_block_pr,
        'prev_all_kg', r.prev_all_kg)
        ORDER BY r.is_atpr DESC, r.workout_at DESC)
      FROM public.client_rep_records(_client_id) r
      WHERE r.completed AND r.workout_at >= _since AND (r.is_atpr OR r.is_program_pr OR r.is_block_pr)), '[]'::jsonb),
    'load_records', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'workout_key', l.workout_key, 'at', l.workout_at, 'exercise_id', l.exercise_id, 'exercise_name', l.exercise_name,
        'reps', l.reps, 'load_kg', l.load_kg, 'atpr', l.is_atpr, 'program_pr', l.is_program_pr, 'block_pr', l.is_block_pr,
        'prev_all_kg', l.prev_all_kg)
        ORDER BY l.is_atpr DESC, l.workout_at DESC)
      FROM public.client_load_records(_client_id) l
      WHERE l.completed AND l.workout_at >= _since AND (l.is_atpr OR l.is_program_pr OR l.is_block_pr)), '[]'::jsonb),
    'tonnage', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'workout_key', t.workout_key, 'at', t.workout_at, 'tonnage_kg', t.tonnage_kg,
        'atpr', t.is_atpr, 'program_pr', t.is_program_pr, 'block_pr', t.is_block_pr) ORDER BY t.workout_at DESC)
      FROM public.client_workout_tonnage(_client_id) t
      WHERE t.completed AND t.workout_at >= _since AND (t.is_atpr OR t.is_program_pr OR t.is_block_pr)), '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.client_recent_records(uuid, timestamptz) TO authenticated;
