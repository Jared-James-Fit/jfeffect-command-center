-- Ashley Santos only: three private, canonical source definitions for the
-- at-home backup flow. This is deliberately additive and idempotent: it never
-- rewrites an existing source day or any instantiated/logged session.
DO $$
DECLARE
  v_client_id uuid := 'b970c6db-e59c-45b9-9429-6122b53b8616';
  v_block_id uuid;
  v_week_id uuid;
  v_day_id uuid;
BEGIN
  SELECT id INTO v_block_id
  FROM public.pl_blocks
  WHERE client_id = v_client_id
    AND source_template_block_key = 'at_home_backup_definitions_v1'
  LIMIT 1;

  IF v_block_id IS NULL THEN
    INSERT INTO public.pl_blocks (
      client_id, name, weeks, training_focus, goal, status, client_visible,
      sort_order, source_template_block_key, coach_notes
    ) VALUES (
      v_client_id, 'At-Home Backup — Definitions', 1, 'At-home dumbbell backup',
      'Private source definitions for Ashley Santos only', 'Draft', false,
      900, 'at_home_backup_definitions_v1',
      'Coach-editable source definitions. Do not schedule these days directly.'
    ) RETURNING id INTO v_block_id;
  END IF;

  INSERT INTO public.pl_weeks (block_id, week_index, notes)
  VALUES (v_block_id, 1, 'Private at-home backup source definitions')
  ON CONFLICT (block_id, week_index) DO UPDATE SET notes = EXCLUDED.notes
  RETURNING id INTO v_week_id;

  -- Full Body A
  SELECT id INTO v_day_id FROM public.pl_days
  WHERE week_id = v_week_id AND title = 'Full Body A' LIMIT 1;
  IF v_day_id IS NULL THEN
    INSERT INTO public.pl_days (
      week_id, day_index, title, focus, notes, duration_estimate_min
    ) VALUES (
      v_week_id, 1, 'Full Body A', 'Full body dumbbell',
      'Optional at-home backup. Log normally; this never replaces a gym workout.', 45
    ) RETURNING id INTO v_day_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pl_exercise_rows WHERE day_id = v_day_id) THEN
    INSERT INTO public.pl_exercise_rows (
      day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rest_seconds,
      notes, measurement_type, tracking_type, duration_seconds
    ) VALUES
      (v_day_id, 0, '101b1845-5862-4787-89e8-2b16f1080b6b', NULL, 3, '8-12', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 1, NULL, 'Dumbbell Romanian Deadlift', 3, '8-12', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 2, NULL, 'Dumbbell Floor Press', 3, '8-12', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 3, NULL, '1-Arm Dumbbell Row', 3, '10-12 / side', '7-8', 75, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 4, NULL, 'Dumbbell Reverse Lunge', 2, '8-10 / side', '7-8', 75, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 5, NULL, 'Dumbbell Lateral Raise', 2, '12-15', '7-8', 60, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 6, '4d787abe-feea-4ecc-81c8-6989ed2eb7bf', NULL, 2, '8-10 / side', '7-8', 45, NULL, 'reps', 'reps_weight', NULL);
  END IF;

  -- Full Body B
  SELECT id INTO v_day_id FROM public.pl_days
  WHERE week_id = v_week_id AND title = 'Full Body B' LIMIT 1;
  IF v_day_id IS NULL THEN
    INSERT INTO public.pl_days (
      week_id, day_index, title, focus, notes, duration_estimate_min
    ) VALUES (
      v_week_id, 2, 'Full Body B', 'Full body dumbbell',
      'Optional at-home backup. Log normally; this never replaces a gym workout.', 45
    ) RETURNING id INTO v_day_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pl_exercise_rows WHERE day_id = v_day_id) THEN
    INSERT INTO public.pl_exercise_rows (
      day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rest_seconds,
      notes, measurement_type, tracking_type, duration_seconds
    ) VALUES
      (v_day_id, 0, '777ca707-3be7-4f4e-ba4a-f62dfb8cfc56', NULL, 3, '8-12 / side', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 1, NULL, 'Dumbbell Sumo Deadlift', 3, '8-12', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 2, NULL, 'Dumbbell Shoulder Press', 3, '8-12', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 3, NULL, 'Bent-Over Dumbbell Row', 3, '10-12', '7-8', 75, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 4, 'd3f91cd5-c971-4198-b636-0d950a5ae636', NULL, 3, '10-15', '7-8', 75, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 5, NULL, 'Dumbbell Biceps Curl', 2, '10-15', '7-8', 60, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 6, NULL, 'Plank', 2, '30-60 sec', '7-8', 45, NULL, 'time', 'time', 60);
  END IF;

  -- Full Body C
  SELECT id INTO v_day_id FROM public.pl_days
  WHERE week_id = v_week_id AND title = 'Full Body C' LIMIT 1;
  IF v_day_id IS NULL THEN
    INSERT INTO public.pl_days (
      week_id, day_index, title, focus, notes, duration_estimate_min
    ) VALUES (
      v_week_id, 3, 'Full Body C', 'Full body dumbbell',
      'Optional at-home backup. Log normally; this never replaces a gym workout.', 45
    ) RETURNING id INTO v_day_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pl_exercise_rows WHERE day_id = v_day_id) THEN
    INSERT INTO public.pl_exercise_rows (
      day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rest_seconds,
      notes, measurement_type, tracking_type, duration_seconds
    ) VALUES
      (v_day_id, 0, '4c1a0055-97c3-47e2-baf1-252e92284cfd', NULL, 3, '8-12', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 1, NULL, 'Dumbbell Single-Leg RDL', 3, '8-10 / side', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 2, NULL, 'Dumbbell Floor Press', 3, '8-12', '7-8', 90, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 3, NULL, '1-Arm Dumbbell Row', 3, '10-12 / side', '7-8', 75, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 4, '98128944-b134-4691-b55e-0a796bfe2d8f', NULL, 2, '8-12 / side', '7-8', 75, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 5, NULL, 'Dumbbell Lateral Raise', 2, '12-15', '7-8', 60, NULL, 'reps', 'reps_weight', NULL),
      (v_day_id, 6, NULL, 'Suitcase Carry', 2, '30-60 sec / side', '7-8', 60, NULL, 'time', 'time', 60);
  END IF;
END $$;

-- The session block is intentionally created lazily by the authorized server
-- function with client_visible=true. Existing RLS then permits the unchanged
-- client logger to read its cloned day/row/result records. The app separately
-- filters this reserved block from primary-program selection and Block View.
