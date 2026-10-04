-- Training records: order an in-progress or reopened workout by when its sets
-- were actually logged (not "now"), so a reopened old workout is never
-- compared against workouts that were completed after it.

DROP FUNCTION IF EXISTS public.client_qualifying_sets(uuid);
CREATE FUNCTION public.client_qualifying_sets(_client_id uuid)
RETURNS TABLE(set_id uuid, workout_key text, workout_at timestamptz, completed boolean,
              block_id uuid, prep_id uuid, exercise_key text, exercise_id uuid, exercise_name text,
              reps int, load_kg numeric, set_completed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id,
         CASE WHEN r.scheduled_workout_id IS NOT NULL THEN 'sw:' || r.scheduled_workout_id ELSE 'day:' || e.day_id END,
         c.completed_at, c.completed_at IS NOT NULL,
         b.id, b.prep_id,
         CASE WHEN e.exercise_id IS NOT NULL THEN 'id:' || e.exercise_id
              ELSE 'name:' || public.pl_norm_exercise_name(e.exercise_name_override) END,
         e.exercise_id, coalesce(x.name, e.exercise_name_override, 'Exercise'),
         r.actual_reps::int, r.normalized_kg, r.completed_at
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
  WITH s AS (
    SELECT q.*, coalesce(q.workout_at, min(q.set_completed_at) OVER (PARTITION BY q.workout_key)) AS ord
      FROM public.client_qualifying_sets(_client_id) q
  ),
  wb AS (
    SELECT DISTINCT ON (s.workout_key, s.exercise_key, s.reps)
           s.workout_key, s.workout_at, s.ord, s.completed,
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
    SELECT s.workout_key, min(s.workout_at) AS workout_at,
           coalesce(min(s.workout_at), min(s.set_completed_at)) AS ord,
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
