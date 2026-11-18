-- Accessory selection pass (Nov 18 2026; exercise-standard.ts EXERCISE_SELECTION).
-- The coach found accessories picked for convenience over quality (floor skull
-- crushers so a superset could keep the bench for leg curls). Every live client
-- program and template was reviewed by hand; only these four workouts change, and
-- only the exercise (plus the cue that describes it and its superset partner's
-- note). Sets, reps, effort, rest, order, main lifts and anything logged stay.
-- Rollout: Colten and Nicolas are among the three whose remaining workouts may
-- change this week; everyone else's programs needed nothing.
--   * Colten, Full Body C (Nov 20, Nov 27): Dumbbell Floor Skull Crusher ->
--     Cable Triceps Overhead Extension (Ez Bar). The floor stops the elbows before
--     the long head's stretch; he has the cable (he rows on it earlier in the same
--     session), has progressed on this exact exercise (20 -> 35 lb x 15), and a
--     rope keeps his left wrist neutral.
--   * Nicolas, Strength & Hypertrophy A (Nov 21, Nov 28): Bent Over Rear Delt Fly
--     Dumbbell -> Lying Rear Delt Fly - Dumbbell, chest supported on the bench and
--     dumbbells he's already at, right after bent-over barbell rows: the rear delts
--     end the set, not a second unsupported hinge.
-- Every change:
--   * touches only a workout nothing has been logged in, that isn't finished and
--     isn't in the past (public.pl_day_touched), checked again at apply time;
--   * applies to a row only while it still holds what was read (exercise, notes);
--   * is backed up first in public.accessory_flow_backup, so it can be put back.
-- Re-running it changes nothing.

DO $$
DECLARE
  _today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  _swapped int := 0;
  _notes int := 0;
BEGIN
  CREATE TEMP TABLE _sel_plan (row_id uuid, old_exercise uuid, new_exercise uuid, new_profile text, old_notes text, new_notes text) ON COMMIT DROP;
  INSERT INTO _sel_plan VALUES
    -- Colten: floor skull crusher -> overhead cable extension (EZ bar), Nov 20 and Nov 27
    ('c189a6ac-9f3c-43bb-85c8-32272d4dcdbe', 'd9290843-d54c-4132-b2d9-bae0d06cd050', 'e3ec61fe-7408-41a9-9efc-628d9e0eca31', 'accessory_isolation',
     'Superset with the leg curl. · Keep elbows tucked. · Progress: Double progression. · Swap if needed: Dumbbell Overhead Triceps Extension',
     'Superset with the leg curl. · Low cable behind you, elbows up by your ears; a rope works too if the left wrist prefers it. · Progress: Double progression. · Swap if needed: Dumbbell Overhead Triceps Extension'),
    ('84ab7894-1340-408e-92d8-f8358548878a', 'd9290843-d54c-4132-b2d9-bae0d06cd050', 'e3ec61fe-7408-41a9-9efc-628d9e0eca31', 'accessory_isolation',
     'Superset with the leg curl. · Keep elbows tucked. · Progress: Double progression. · Swap if needed: Dumbbell Overhead Triceps Extension',
     'Superset with the leg curl. · Low cable behind you, elbows up by your ears; a rope works too if the left wrist prefers it. · Progress: Double progression. · Swap if needed: Dumbbell Overhead Triceps Extension'),
    -- Nicolas: bent-over rear delt fly -> chest-supported rear delt fly, Nov 21 and Nov 28
    ('e8a6477d-8b0e-4175-a831-34e99aa3132f', 'ae61bcd3-0f06-46c4-bed9-7fe29ef8fbc5', '96142975-f791-4528-a4c1-eb3581adf40a', 'accessory_isolation',
     'Station 2: Dumbbells. New addition for 3D shoulder look. · Progress: Double progression. · Swap if needed: Lying Rear Delt Fly - Dumbbell',
     'Station 2: Dumbbells. Chest down on the bench at a low incline, arms long, lead with the elbows. · Progress: Double progression. · Swap if needed: Bent Over Rear Delt Fly Dumbbell'),
    ('62df043f-9fb9-4792-8499-a091d9e83e85', 'ae61bcd3-0f06-46c4-bed9-7fe29ef8fbc5', '96142975-f791-4528-a4c1-eb3581adf40a', 'accessory_isolation',
     'Station 2: Dumbbells. New addition for 3D shoulder look. · Progress: Double progression. · Swap if needed: Lying Rear Delt Fly - Dumbbell',
     'Station 2: Dumbbells. Chest down on the bench at a low incline, arms long, lead with the elbows. · Progress: Double progression. · Swap if needed: Bent Over Rear Delt Fly Dumbbell');

  -- the superset partner's note names the exercise that changed (Colten's leg curl, Nov 20 and Nov 27)
  CREATE TEMP TABLE _sel_notes (row_id uuid, old_text text, new_text text) ON COMMIT DROP;
  INSERT INTO _sel_notes VALUES
    ('c7e8dbc8-9545-4f15-a379-26937801bcf2', 'Superset with skull crushers: leg curl, rest 30s, skull crushers, rest 60s, then leg curl again.', 'Superset with the overhead triceps extensions: leg curl, rest 30s, triceps extensions, rest 60s, then leg curl again.'),
    ('607551cb-49be-418a-ab17-ec0370016056', 'Superset with skull crushers: leg curl, rest 30s, skull crushers, rest 60s, then leg curl again.', 'Superset with the overhead triceps extensions: leg curl, rest 30s, triceps extensions, rest 60s, then leg curl again.');

  -- rows still as read, in workouts still untouched
  CREATE TEMP TABLE _sel_ok ON COMMIT DROP AS
  SELECT p.*, r.day_id, b.client_id, r.time_profile AS old_profile
    FROM _sel_plan p
    JOIN public.pl_exercise_rows r ON r.id = p.row_id AND r.exercise_id = p.old_exercise AND r.notes IS NOT DISTINCT FROM p.old_notes
    JOIN public.pl_days d ON d.id = r.day_id AND d.deleted_at IS NULL AND NOT coalesce(d.archived, false)
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
   WHERE NOT public.pl_day_touched(d.id, coalesce((SELECT min(s.scheduled_date) FROM public.pl_scheduled_workouts s WHERE s.source_day_id = d.id), d.scheduled_date), _today);

  INSERT INTO public.accessory_flow_backup (batch, row_id, day_id, client_id, field, old_value, new_value)
  SELECT 'accessory_selection_2026_11_18', k.row_id, k.day_id, k.client_id, f.field, f.old_value, f.new_value
    FROM _sel_ok k
    CROSS JOIN LATERAL (VALUES
      ('exercise_id', k.old_exercise::text, k.new_exercise::text),
      ('time_profile', k.old_profile, k.new_profile),
      ('notes', k.old_notes, k.new_notes)
    ) AS f(field, old_value, new_value)
   WHERE NOT EXISTS (SELECT 1 FROM public.accessory_flow_backup x WHERE x.batch = 'accessory_selection_2026_11_18' AND x.row_id = k.row_id AND x.field = f.field);

  UPDATE public.pl_exercise_rows r
     SET exercise_id = k.new_exercise, time_profile = k.new_profile, notes = k.new_notes
    FROM _sel_ok k
   WHERE r.id = k.row_id AND r.exercise_id = k.old_exercise;
  GET DIAGNOSTICS _swapped = ROW_COUNT;

  -- the partner notes, only in workouts whose swap went through
  INSERT INTO public.accessory_flow_backup (batch, row_id, day_id, client_id, field, old_value, new_value)
  SELECT 'accessory_selection_2026_11_18', r.id, r.day_id, b.client_id, 'notes', r.notes, replace(r.notes, n.old_text, n.new_text)
    FROM _sel_notes n
    JOIN public.pl_exercise_rows r ON r.id = n.row_id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
    JOIN public.pl_blocks b ON b.id = w.block_id
   WHERE position(n.old_text in coalesce(r.notes, '')) > 0
     AND EXISTS (SELECT 1 FROM public.pl_exercise_rows s WHERE s.day_id = r.day_id AND s.exercise_id = 'e3ec61fe-7408-41a9-9efc-628d9e0eca31')
     AND NOT public.pl_day_touched(d.id, coalesce((SELECT min(s.scheduled_date) FROM public.pl_scheduled_workouts s WHERE s.source_day_id = d.id), d.scheduled_date), _today)
     AND NOT EXISTS (SELECT 1 FROM public.accessory_flow_backup x WHERE x.batch = 'accessory_selection_2026_11_18' AND x.row_id = r.id AND x.field = 'notes');

  UPDATE public.pl_exercise_rows r SET notes = bk.new_value
    FROM public.accessory_flow_backup bk
   WHERE bk.batch = 'accessory_selection_2026_11_18' AND bk.field = 'notes' AND bk.row_id = r.id AND r.notes = bk.old_value
     AND r.id IN (SELECT row_id FROM _sel_notes);
  GET DIAGNOSTICS _notes = ROW_COUNT;

  RAISE NOTICE 'accessory selection: % exercises swapped, % superset notes updated', _swapped, _notes;
END $$;
