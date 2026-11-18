-- Crew posts show a weight in the unit the athlete typed it in, with the
-- other unit beside it (dual-weight.ts). Until now every post's stats were kg
-- only, so each viewer saw someone else's lift in their own unit and nothing
-- could tell a 315 lb bench from a 142.9 kg one.
--
-- Additive only: each weight the stats name gets the unit its set was typed
-- in (`unit`), and a workout gets the unit most of its weights were typed in
-- (its volume reads in it). Nothing is stored and no record changes; a
-- post that hides weights still hides them (load_kg is what's hidden, the
-- unit alone says nothing). The functions are patched in place from their
-- live definitions, each patch checked, so nothing else in them can drift.
--
-- Wednesday Wins (community_fmt_set) names a PR in the unit its set was
-- typed in, with the other unit beside it: "65lbs (29.5kg) x 12", and a
-- 72.5 lb set no longer reads 73.

CREATE OR REPLACE FUNCTION pg_temp.patch_fn(_sig text, _pairs text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d text := pg_get_functiondef(_sig::regprocedure);
  i int;
BEGIN
  FOR i IN 1 .. array_length(_pairs, 1) / 2 LOOP
    IF position(_pairs[2 * i] IN d) > 0 THEN
      CONTINUE; -- already applied (the migration runs once, but never twice-patch)
    END IF;
    IF position(_pairs[2 * i - 1] IN d) = 0 THEN
      RAISE EXCEPTION '% : fragment % not found', _sig, i;
    END IF;
    d := replace(d, _pairs[2 * i - 1], _pairs[2 * i]);
  END LOOP;
  EXECUTE d;
END $$;

-- 1. A workout's stats: the top lift's and each PR's unit, and the workout's own.
SELECT pg_temp.patch_fn('public.community_workout_stats(uuid)', ARRAY[
  E'  v_daytitle text;\nBEGIN',
  E'  v_daytitle text;\n  v_unit text;\nBEGIN',

  E'    SELECT s.exercise_key, s.exercise_name, s.reps, s.load_kg, e.sort_order\n',
  E'    SELECT s.exercise_key, s.exercise_name, s.reps, s.load_kg, e.sort_order, coalesce(r.entered_unit, r.actual_load_unit) AS unit\n',

  E'jsonb_build_object(''exercise_name'', t.exercise_name, ''reps'', t.reps, ''load_kg'', t.load_kg)',
  E'jsonb_build_object(''exercise_name'', t.exercise_name, ''reps'', t.reps, ''load_kg'', t.load_kg, ''unit'', t.unit)',

  E'      SELECT qs.exercise_name, qs.reps, qs.load_kg\n        FROM qs JOIN primary_lift',
  E'      SELECT qs.exercise_name, qs.reps, qs.load_kg, qs.unit\n        FROM qs JOIN primary_lift',

  E'    SELECT x.exercise_key, x.exercise_name, x.reps, x.load_kg,\n',
  E'    SELECT x.exercise_key, x.exercise_name, x.reps, x.load_kg, x.set_id,\n',

  E'    SELECT y.exercise_key, y.exercise_name, y.reps, y.load_kg,\n',
  E'    SELECT y.exercise_key, y.exercise_name, y.reps, y.load_kg, y.set_id,\n',

  E'SELECT DISTINCT ON (exercise_key) exercise_key, exercise_name, reps, load_kg, tier\n',
  E'SELECT DISTINCT ON (exercise_key) exercise_key, exercise_name, reps, load_kg, tier, set_id\n',

  E'''exercise_name'', q.exercise_name, ''reps'', q.reps, ''load_kg'', q.load_kg,\n',
  E'''exercise_name'', q.exercise_name, ''reps'', q.reps, ''load_kg'', q.load_kg,\n                     ''unit'', (SELECT coalesce(r2.entered_unit, r2.actual_load_unit) FROM public.pl_row_results r2 WHERE r2.id = q.set_id),\n',

  E'  RETURN jsonb_build_object(\n    ''workout_title'', v_title,',
  E'  -- the unit most of this workout''s weights were typed in (its volume reads in it)\n  SELECT mode() WITHIN GROUP (ORDER BY coalesce(r.entered_unit, r.actual_load_unit)) INTO v_unit\n    FROM public.pl_row_results r\n    JOIN public.pl_exercise_rows e ON e.id = r.row_id\n   WHERE r.client_id = pc.client_id\n     AND r.completed_at IS NOT NULL\n     AND coalesce(r.is_working_set, true)\n     AND r.actual_load > 0\n     AND (CASE WHEN r.scheduled_workout_id IS NOT NULL THEN ''sw:'' || r.scheduled_workout_id ELSE ''day:'' || e.day_id END) = k;\n\n  RETURN jsonb_build_object(\n    ''workout_title'', v_title,',

  E'    ''tonnage_kg'', v_tonnage,\n',
  E'    ''tonnage_kg'', v_tonnage,\n    ''unit'', v_unit,\n'
]);

-- 2. The workout page's exercises: each best set's unit.
SELECT pg_temp.patch_fn('public.community_workout_exercises(uuid)', ARRAY[
  E'    SELECT r.id AS set_id, e.sort_order,\n',
  E'    SELECT r.id AS set_id, coalesce(r.entered_unit, r.actual_load_unit) AS unit, e.sort_order,\n',

  E'SELECT DISTINCT ON (sets.ekey) sets.ekey, q.load_kg, q.reps\n',
  E'SELECT DISTINCT ON (sets.ekey) sets.ekey, q.load_kg, q.reps, sets.unit\n',

  E'           ''best_reps'', best.reps,\n',
  E'           ''best_reps'', best.reps,\n           ''best_unit'', best.unit,\n'
]);

-- 3. The share composer's "vs last time": the last session's own unit.
SELECT pg_temp.patch_fn('public.community_completion_extras(uuid)', ARRAY[
  E'''working_sets'', s->''working_sets'', ''top_lift'', s->''top_lift'')',
  E'''working_sets'', s->''working_sets'', ''top_lift'', s->''top_lift'', ''unit'', s->''unit'')'
]);

-- 4. Wednesday Wins: a PR in the unit its set was typed in, before any preference.
SELECT pg_temp.patch_fn('public.community_week_wins(date,uuid)', ARRAY[
  E'SELECT x.exercise_id, x.exercise_name, x.reps, x.load_kg,',
  E'SELECT x.exercise_id, x.exercise_name, x.reps, x.load_kg, x.set_id,',

  E'v_unit := coalesce((SELECT u.unit FROM public.client_exercise_unit_prefs u',
  E'v_unit := coalesce((SELECT coalesce(r.entered_unit, r.actual_load_unit) FROM public.pl_row_results r WHERE r.id = pr.set_id AND coalesce(r.entered_unit, r.actual_load_unit) IN (''kg'', ''lb'')), (SELECT u.unit FROM public.client_exercise_unit_prefs u'
]);

-- 5. "65lbs (29.5kg) x 12" / "142.5kg (314.2lbs) single": the weight as typed
--    (never rounded to a whole pound), the other unit to one decimal beside it.
CREATE OR REPLACE FUNCTION public.community_fmt_set(_kg numeric, _reps integer, _unit text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _kg IS NULL OR _kg <= 0 THEN NULL
         ELSE CASE WHEN _unit = 'kg'
                   THEN trim(trailing '.' FROM trim(trailing '0' FROM round(_kg, 2)::text)) || 'kg ('
                        || trim(trailing '.' FROM trim(trailing '0' FROM round(_kg * 2.2046226218, 1)::text)) || 'lbs)'
                   ELSE trim(trailing '.' FROM trim(trailing '0' FROM round(_kg * 2.2046226218, 2)::text)) || 'lbs ('
                        || trim(trailing '.' FROM trim(trailing '0' FROM round(_kg, 1)::text)) || 'kg)' END
              || CASE WHEN _reps = 1 THEN ' single' ELSE ' x ' || _reps END END
$function$;

-- 6. Every cached post's stats are worked out again with the units (derived
--    data: a read works them out live until the per-minute job stores them).
DELETE FROM public.community_workout_stats_cache;
