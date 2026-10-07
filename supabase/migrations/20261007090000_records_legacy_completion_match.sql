-- Records / tonnage / league: count sets from legacy-logged workouts that were
-- finished through a scheduled instance.
--
-- Before August 2026 the logger saved sets without a scheduled_workout_id
-- (legacy day path) while the "Finish workout" row in pl_day_completions was
-- keyed by the scheduled instance. The strict match below (null set → null
-- completion only) therefore saw ~1,460 sets from finished workouts as "never
-- completed", dropped them from every record baseline and produced false
-- ATPRs (e.g. 235 lb × 5 flagged as a 5-rep ATPR for an athlete with
-- 200 kg × 5 on record).
--
-- Fix: a legacy (null-instance) set falls back to its day's instance
-- completion when the day has no legacy completion of its own and that
-- instance logged no instance-keyed sets (so the legacy sets ARE its sets).
-- Legacy sets are unique per (client, row, set), so there is exactly one legacy
-- session per day and the fallback is unambiguous. No data is rewritten: the
-- logger still finds these sets on the legacy path.

CREATE OR REPLACE FUNCTION public.client_qualifying_sets(_client_id uuid)
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
       ORDER BY pc.completed_at LIMIT 1) c0 ON true
    LEFT JOIN LATERAL (
      SELECT pc.completed_at FROM public.pl_day_completions pc
       WHERE c0.completed_at IS NULL AND r.scheduled_workout_id IS NULL
         AND pc.client_id = r.client_id AND pc.day_id = e.day_id
         AND pc.completed_at IS NOT NULL AND pc.scheduled_workout_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.pl_row_results r2
                          WHERE r2.scheduled_workout_id = pc.scheduled_workout_id AND r2.client_id = r.client_id)
       ORDER BY pc.completed_at LIMIT 1) c1 ON true
    CROSS JOIN LATERAL (SELECT coalesce(c0.completed_at, c1.completed_at) AS completed_at) c
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
