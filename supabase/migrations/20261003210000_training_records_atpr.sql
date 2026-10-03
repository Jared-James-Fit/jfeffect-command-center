-- Training records: ATPR / PROGRAM PR / BLOCK PR, rep PRs and tonnage.
--
-- Source of truth = logged sets (pl_row_results). Nothing is stored: records
-- are derived deterministically on read, so edits, deletions and reopened
-- workouts can never leave a stale badge behind.
--
-- Qualifying set: completed, reps > 0, external load > 0 (no bodyweight /
-- assisted / time-only), not flagged as a warm-up, identified by canonical
-- exercise (exercise_id; unlinked custom rows fall back to their name).
--
-- Rep record at N reps: the workout's best load for N reps beats the best
-- load previously lifted for N *or more* reps (a heavier set for more reps
-- already proves the N-rep ability). The baseline is only workouts completed
-- before this one, so a workout is never compared against itself. No baseline
-- → no record (first-ever logs are never labelled ATPR).
--   ATPR        baseline = all earlier workouts
--   PROGRAM PR  baseline = earlier workouts in the same program (pl_preps)
--   BLOCK PR    baseline = earlier workouts in the same block
-- Loads within 0.25 kg (lb↔kg rounding, e.g. 495 lb = 224.53 kg vs 224.5 kg)
-- are ties, never records. Tonnage needs to beat the baseline by > 1 kg.
-- A set dominated in the same workout (more reps at ≥ load) is not a record.

CREATE OR REPLACE FUNCTION public.can_view_client_training(_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin') OR public.is_assigned_coach(_client_id)
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.user_id = auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.client_qualifying_sets(_client_id uuid)
RETURNS TABLE(set_id uuid, workout_key text, workout_at timestamptz, completed boolean,
              block_id uuid, prep_id uuid, exercise_key text, exercise_id uuid, exercise_name text,
              reps int, load_kg numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id,
         CASE WHEN r.scheduled_workout_id IS NOT NULL THEN 'sw:' || r.scheduled_workout_id ELSE 'day:' || e.day_id END,
         c.completed_at, c.completed_at IS NOT NULL,
         b.id, b.prep_id,
         CASE WHEN e.exercise_id IS NOT NULL THEN 'id:' || e.exercise_id
              ELSE 'name:' || public.pl_norm_exercise_name(e.exercise_name_override) END,
         e.exercise_id, coalesce(x.name, e.exercise_name_override, 'Exercise'),
         r.actual_reps::int, r.normalized_kg
    FROM public.pl_row_results r
    JOIN public.pl_exercise_rows e ON e.id = r.row_id
    JOIN public.pl_days d ON d.id = e.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
    LEFT JOIN public.exercises x ON x.id = e.exercise_id
    LEFT JOIN LATERAL (
      SELECT pc.completed_at FROM public.pl_day_completions pc
       WHERE pc.client_id = r.client_id AND pc.completed_at IS NOT NULL
         AND ((r.scheduled_workout_id IS NOT NULL AND pc.scheduled_workout_id = r.scheduled_workout_id)
           OR (r.scheduled_workout_id IS NULL AND pc.scheduled_workout_id IS NULL AND pc.day_id = e.day_id))
       ORDER BY pc.completed_at LIMIT 1) c ON true
   WHERE r.client_id = _client_id
     AND r.completed_at IS NOT NULL
     AND r.actual_reps > 0
     AND coalesce(r.load_type, 'external') = 'external'
     AND NOT coalesce(r.is_bodyweight, false)
     AND coalesce(r.is_working_set, true)
     AND r.normalized_kg > 0
     AND (e.exercise_id IS NOT NULL OR btrim(coalesce(e.exercise_name_override, '')) <> '')
$$;
REVOKE ALL ON FUNCTION public.client_qualifying_sets(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_rep_records(_client_id uuid)
RETURNS TABLE(workout_key text, workout_at timestamptz, completed boolean, block_id uuid, prep_id uuid,
              exercise_key text, exercise_id uuid, exercise_name text, reps int, load_kg numeric, set_id uuid,
              prev_all_kg numeric, prev_program_kg numeric, prev_block_kg numeric,
              is_atpr boolean, is_program_pr boolean, is_block_pr boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM public.client_qualifying_sets(_client_id)),
  wb AS (
    SELECT DISTINCT ON (s.workout_key, s.exercise_key, s.reps)
           s.workout_key, s.workout_at, coalesce(s.workout_at, 'infinity'::timestamptz) AS ord, s.completed,
           s.block_id, s.prep_id, s.exercise_key, s.exercise_id, s.exercise_name, s.reps, s.load_kg, s.set_id
      FROM s
     ORDER BY s.workout_key, s.exercise_key, s.reps, s.load_kg DESC, s.set_id
  ),
  undominated AS (
    SELECT wb.* FROM wb
     WHERE NOT EXISTS (SELECT 1 FROM wb o
                        WHERE o.workout_key = wb.workout_key AND o.exercise_key = wb.exercise_key
                          AND o.reps > wb.reps AND o.load_kg >= wb.load_kg)
  )
  SELECT u.workout_key, u.workout_at, u.completed, u.block_id, u.prep_id, u.exercise_key, u.exercise_id,
         u.exercise_name, u.reps, u.load_kg, u.set_id,
         b.prev_all, b.prev_prog, b.prev_block,
         b.prev_all IS NOT NULL AND u.load_kg > b.prev_all + 0.25,
         u.prep_id IS NOT NULL AND b.prev_prog IS NOT NULL AND u.load_kg > b.prev_prog + 0.25,
         b.prev_block IS NOT NULL AND u.load_kg > b.prev_block + 0.25
    FROM undominated u
    LEFT JOIN LATERAL (
      SELECT max(p.load_kg) AS prev_all,
             max(p.load_kg) FILTER (WHERE p.prep_id = u.prep_id) AS prev_prog,
             max(p.load_kg) FILTER (WHERE p.block_id = u.block_id) AS prev_block
        FROM wb p
       WHERE p.completed AND p.exercise_key = u.exercise_key AND p.reps >= u.reps
         AND p.workout_key <> u.workout_key AND p.ord < u.ord
    ) b ON true
$$;
REVOKE ALL ON FUNCTION public.client_rep_records(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_workout_tonnage(_client_id uuid)
RETURNS TABLE(workout_key text, workout_at timestamptz, completed boolean, block_id uuid, prep_id uuid,
              tonnage_kg numeric, prev_all_kg numeric, prev_program_kg numeric, prev_block_kg numeric,
              is_atpr boolean, is_program_pr boolean, is_block_pr boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM public.client_qualifying_sets(_client_id)),
  w AS (
    SELECT s.workout_key, min(s.workout_at) AS workout_at, coalesce(min(s.workout_at), 'infinity'::timestamptz) AS ord,
           bool_or(s.completed) AS completed, (array_agg(s.block_id))[1] AS block_id, (array_agg(s.prep_id))[1] AS prep_id,
           round(sum(s.load_kg * s.reps), 1) AS tonnage_kg
      FROM s GROUP BY s.workout_key
  )
  SELECT w.workout_key, w.workout_at, w.completed, w.block_id, w.prep_id, w.tonnage_kg,
         b.prev_all, b.prev_prog, b.prev_block,
         b.prev_all IS NOT NULL AND w.tonnage_kg > b.prev_all + 1,
         w.prep_id IS NOT NULL AND b.prev_prog IS NOT NULL AND w.tonnage_kg > b.prev_prog + 1,
         b.prev_block IS NOT NULL AND w.tonnage_kg > b.prev_block + 1
    FROM w
    LEFT JOIN LATERAL (
      SELECT max(p.tonnage_kg) AS prev_all,
             max(p.tonnage_kg) FILTER (WHERE p.prep_id = w.prep_id) AS prev_prog,
             max(p.tonnage_kg) FILTER (WHERE p.block_id = w.block_id) AS prev_block
        FROM w p WHERE p.completed AND p.workout_key <> w.workout_key AND p.ord < w.ord
    ) b ON true
$$;
REVOKE ALL ON FUNCTION public.client_workout_tonnage(uuid) FROM PUBLIC, anon, authenticated;

-- Records for ONE workout (live during logging, the recap, and coach review).
CREATE OR REPLACE FUNCTION public.workout_records(_client_id uuid, _scheduled_workout_id uuid DEFAULT NULL, _day_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; t record; recs jsonb; ex jsonb;
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
  -- Exercise tonnage inside this workout (historical analytics; not shown on set rows).
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
    'exercise_tonnage', ex);
END;
$$;
GRANT EXECUTE ON FUNCTION public.workout_records(uuid, uuid, uuid) TO authenticated;

-- Exercise history context: all-time bests per rep count + current program/block bests.
CREATE OR REPLACE FUNCTION public.exercise_records(_client_id uuid, _exercise_id uuid DEFAULT NULL, _exercise_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; cur_block uuid; cur_prep uuid; out jsonb;
BEGIN
  IF NOT public.can_view_client_training(_client_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  k := CASE WHEN _exercise_id IS NOT NULL THEN 'id:' || _exercise_id ELSE 'name:' || public.pl_norm_exercise_name(_exercise_name) END;
  SELECT b.id, b.prep_id INTO cur_block, cur_prep FROM public.pl_blocks b
   WHERE b.client_id = _client_id AND lower(coalesce(b.status, '')) = 'active' AND NOT coalesce(b.archived, false)
   ORDER BY b.start_date DESC NULLS LAST LIMIT 1;
  WITH s AS (SELECT * FROM public.client_qualifying_sets(_client_id) q WHERE q.exercise_key = k AND q.completed),
  reps AS (SELECT DISTINCT s.reps FROM s),
  best AS (
    SELECT r.reps,
      (SELECT jsonb_build_object('load_kg', s.load_kg, 'at', s.workout_at) FROM s WHERE s.reps = r.reps ORDER BY s.load_kg DESC, s.workout_at LIMIT 1) atpr,
      (SELECT jsonb_build_object('load_kg', s.load_kg, 'at', s.workout_at) FROM s WHERE s.reps = r.reps AND cur_prep IS NOT NULL AND s.prep_id = cur_prep ORDER BY s.load_kg DESC, s.workout_at LIMIT 1) program,
      (SELECT jsonb_build_object('load_kg', s.load_kg, 'at', s.workout_at) FROM s WHERE s.reps = r.reps AND s.block_id = cur_block ORDER BY s.load_kg DESC, s.workout_at LIMIT 1) block
    FROM reps r
  )
  SELECT jsonb_build_object(
    'rep_bests', coalesce((SELECT jsonb_agg(jsonb_build_object('reps', reps, 'atpr', atpr, 'program', program, 'block', block) ORDER BY reps) FROM best WHERE reps <= 20), '[]'::jsonb),
    'current_block', (SELECT name FROM public.pl_blocks WHERE id = cur_block),
    'current_program', (SELECT title FROM public.pl_preps WHERE id = cur_prep))
  INTO out;
  RETURN out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.exercise_records(uuid, uuid, text) TO authenticated;

-- Coach view: recent records across completed workouts.
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
    'tonnage', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'workout_key', t.workout_key, 'at', t.workout_at, 'tonnage_kg', t.tonnage_kg,
        'atpr', t.is_atpr, 'program_pr', t.is_program_pr, 'block_pr', t.is_block_pr) ORDER BY t.workout_at DESC)
      FROM public.client_workout_tonnage(_client_id) t
      WHERE t.completed AND t.workout_at >= _since AND (t.is_atpr OR t.is_program_pr OR t.is_block_pr)), '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.client_recent_records(uuid, timestamptz) TO authenticated;

CREATE INDEX IF NOT EXISTS pl_row_results_client_completed_idx ON public.pl_row_results (client_id) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS pl_day_completions_client_sw_idx ON public.pl_day_completions (client_id, scheduled_workout_id);
CREATE INDEX IF NOT EXISTS pl_day_completions_client_day_idx ON public.pl_day_completions (client_id, day_id);
