-- A Crew workout post's sets (Nov 21 2026): the workout sheet a post opens over
-- the feed (Workout | Comments) lists every exercise with its sets, so each
-- exercise in community_workout_exercises now carries `set_list`: its working
-- sets in the order they were done (the row's place, then the set's), each the
-- weight as typed and its unit (`v`, `u`), the kg mirror (`kg`, for the other
-- unit), reps, RPE, a timed set's seconds and how the load counts (`lt`:
-- external, bodyweight, assisted). Derived only; nothing stored changes. A post
-- that hides its weights hides them here too (community_hide_exercise_loads).

CREATE OR REPLACE FUNCTION pg_temp.patch_fn(_sig text, _pairs text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d text := pg_get_functiondef(_sig::regprocedure);
  i int;
BEGIN
  FOR i IN 1 .. array_length(_pairs, 1) / 2 LOOP
    IF position(_pairs[2 * i] IN d) > 0 THEN
      CONTINUE; -- already applied
    END IF;
    IF position(_pairs[2 * i - 1] IN d) = 0 THEN
      RAISE EXCEPTION '% : fragment % not found', _sig, i;
    END IF;
    d := replace(d, _pairs[2 * i - 1], _pairs[2 * i]);
  END LOOP;
  EXECUTE d;
END $$;

SELECT pg_temp.patch_fn('public.community_workout_exercises(uuid)', ARRAY[
$old$           r.actual_reps, r.completed_duration_seconds
      FROM public.pl_row_results r$old$,
$new$           r.actual_reps, r.completed_duration_seconds,
           r.set_index, r.actual_load_kg, coalesce(r.entered_value, r.actual_load) AS entered_value,
           r.actual_rpe_num, coalesce(r.load_type, CASE WHEN r.is_bodyweight THEN 'bodyweight' END) AS load_type
      FROM public.pl_row_results r$new$,
$old$           'pr', CASE coalesce(rec.tier, 0) WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' WHEN 1 THEN 'block_pr' END)$old$,
$new$           'pr', CASE coalesce(rec.tier, 0) WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' WHEN 1 THEN 'block_pr' END,
           'set_list', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                 'v', s2.entered_value, 'u', s2.unit, 'kg', s2.actual_load_kg,
                                 'reps', s2.actual_reps, 'rpe', s2.actual_rpe_num,
                                 'secs', s2.completed_duration_seconds, 'lt', s2.load_type))
                               ORDER BY s2.sort_order, s2.set_index)
                          FROM sets s2 WHERE s2.ekey = per.ekey))$new$
]);

-- a post that hides its weights: no load on any set either
CREATE OR REPLACE FUNCTION public.community_hide_exercise_loads(_e jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT jsonb_agg(
           x || jsonb_build_object('best_load_kg', null,
                                   'max_reps', CASE WHEN jsonb_typeof(x->'max_reps') = 'number' THEN x->'max_reps' ELSE x->'best_reps' END,
                                   'set_list', (SELECT jsonb_agg(s - 'v' - 'kg') FROM jsonb_array_elements(
                                                  CASE WHEN jsonb_typeof(x->'set_list') = 'array' THEN x->'set_list' ELSE '[]'::jsonb END) s)))
           FROM jsonb_array_elements(coalesce(_e, '[]'::jsonb)) x), '[]'::jsonb)
$function$;
