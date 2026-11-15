-- Vicky Tshibasu's peak and max test (Nov 15 2026): "Block 3 — Strength
-- Realization / Peak" (from Mon Nov 16) and "Block 4 — Taper / Max Testing"
-- (mock meet Sat Dec 12) were written with prescriptions the logger can't
-- show: back-offs with no %, RPE or RIR ("Backoff — 12% below" in the notes
-- only), accessories marked "easy" with no RIR, light taper singles with the %
-- only in the notes ("55–60%"), "manual" % rows with no weight typed (the
-- athlete saw no load at all), the taper's optional back-offs sitting after
-- all three singles instead of after their own lift, and the mock meet as one
-- 3 × 1 row per lift with all three attempts' %s in one note.
--
-- Filled in from the program's own numbers, the low end of every range (the
-- app's rule for a range), with an RPE as the cap and the fallback while no
-- max is on file:
--   * a back-off "N% below" the top set is (100 − N)% of today's top set
--     (top_set, linked to its top set), capped at RPE 7;
--   * a % of the "projected max" is a % of his estimated max (est_1rm): he has
--     no maxes on file, and the logger works one out from his logged
--     competition sets (loggedE1rm), so the light singles, primers and
--     attempts show a weight;
--   * "easy" accessories are RIR 4, "very easy" RIR 5;
--   * Block 4 Week 1 Thursday: each optional back-off right after its single;
--   * the mock meet: three rows per lift (opener, second, third attempt), each
--     one single at its own % with its own note, 5 minutes apart;
--   * both blocks "Active" instead of "Draft": he sees them and they're dated,
--     and a dated Draft is skipped by the overlap checks (setBlockScheduleFn
--     saves a visible block as Active for that reason).
--
-- Only workouts nothing has touched change (pl_day_touched: not past, not
-- opened, nothing logged), only rows still as the program wrote them, and
-- every row is backed up first in program_loading_update_backup. Re-running
-- changes nothing (the 'run' marker). His template (84bce858…) is left as it
-- is: the coach's library copy, not his program.

DO $$
DECLARE
  c_b3   constant uuid := 'dfe6df2d-03e6-4b1f-a0d4-2df37166c6d3';
  c_b4   constant uuid := '4c9cc111-6fb6-4007-80c5-ee413e8ff8ed';
  c_thu  constant uuid := '6ab1bffe-84b7-478b-a4e1-522f1ad75d27';  -- Block 4 W1 Thursday
  c_test constant uuid := 'd1cdcc23-ff07-4a19-9f16-7061f461a614';  -- Block 4 W2 Saturday mock meet
  n_rows int := 0; n_sort int := 0; n_new int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pl_blocks WHERE id = c_b3)
     OR NOT EXISTS (SELECT 1 FROM public.pl_blocks WHERE id = c_b4) THEN
    RAISE NOTICE 'vicky peak: blocks not here, skipped';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.program_loading_update_backup WHERE source_table = 'run' AND row_id = 'vicky_peak_2026_11') THEN
    RAISE NOTICE 'vicky peak: already applied';
    RETURN;
  END IF;

  -- what each blank row becomes (notes NULL = keep the program's own)
  CREATE TEMP TABLE vp_fill (
    id uuid PRIMARY KEY, pct numeric, basis text, basis_row uuid, rpe text, rir text, notes text
  ) ON COMMIT DROP;
  INSERT INTO vp_fill VALUES
    -- Block 3 W1 Friday: back-offs off the day's top singles
    ('300ee85a-f652-47ad-9e01-c09c5aed3ce8', 88, 'top_set', '10f186ff-a156-4a47-b079-4686c3486bf1', '7', NULL, NULL),
    ('ee2cde4b-484b-4ce3-b272-603fd45d6fe2', 90, 'top_set', 'c9984a40-2d2b-4cbe-88f0-94a9c3e9b793', '7', NULL, NULL),
    ('c52539ad-a165-4c2b-b400-886f5b739bfe', 88, 'top_set', 'd7820a8b-5065-490d-9bf2-750c43664c46', '7', NULL, NULL),
    -- Block 3 W2 Tuesday: "easy" hamstring curl
    ('e335eb60-e6a4-40a8-bc2f-51503b8b41fa', NULL, NULL, NULL, NULL, '4', NULL),
    -- Block 3 W2 Friday: optional back-offs after the singles
    ('17341cad-c719-402b-bcfd-aacbd94aa8e2', 75, 'est_1rm', NULL, '6', NULL, 'Optional back-off: 75% of your estimated max.'),
    ('00720b26-3dad-4488-b0a7-424604f04f6d', 75, 'est_1rm', NULL, '6', NULL, 'Optional back-off: 75% of your estimated max.'),
    ('26e8cfc5-968a-4191-a03c-ff92507c82fd', 70, 'est_1rm', NULL, '6', NULL, 'Optional back-off: 70% of your estimated max.'),
    -- Block 4 W1 Tuesday: "easy" cable row
    ('bdda4f9c-4338-4388-afdb-2fe705ae8d1f', NULL, NULL, NULL, NULL, '4', NULL),
    -- Block 4 W1 Thursday: optional back-offs
    ('e1993f6a-7456-45d7-9d49-51115de2bb4d', 65, 'est_1rm', NULL, '5', NULL, 'Optional back-off: 65–70% of your estimated max.'),
    ('444579df-1e8f-4886-87c8-77b4a1fb9465', 65, 'est_1rm', NULL, '5', NULL, 'Optional back-off: 65–70% of your estimated max.'),
    ('e84242b7-c492-4c5c-93bc-d0e3136aa110', 65, 'est_1rm', NULL, '5', NULL, 'Optional back-off: 65–70% of your estimated max.'),
    -- Block 4 W1 Friday
    ('a2eea1ae-332f-427e-b033-3d26b0255d14', 50, 'est_1rm', NULL, '4', NULL, 'Light: 50–55% of your estimated max. Fast and crisp.'),
    ('409925bf-84ef-42e4-a440-50ce16da8a68', NULL, NULL, NULL, NULL, '5', NULL),
    -- Block 4 W2 Monday
    ('d7e418d1-2e49-4ffc-94bd-1d859522fcc7', 55, 'est_1rm', NULL, '4', NULL, 'Light: 55–60% of your estimated max. Fast and crisp.'),
    ('1d26af97-e562-402f-9c1b-3f201f55f24d', 55, 'est_1rm', NULL, '4', NULL, 'Light: 55–60% of your estimated max. Fast and crisp.'),
    ('bf847f19-ba1c-43e1-94c3-4fa0d7da9acb', 50, 'est_1rm', NULL, '4', NULL, 'Light: 50–55% of your estimated max. Fast and crisp.'),
    -- Block 4 W2 Tuesday
    ('124b0b3d-1724-4714-b81c-73d7da86c5cf', 45, 'est_1rm', NULL, '3', NULL, 'Light: 45–50% of your estimated max. Fast and crisp.'),
    -- Block 4 W2 Friday: primers the day before the test
    ('91639768-7096-48ee-b4c5-5f2803ffc28d', 40, 'est_1rm', NULL, '3', NULL, 'Primer: 40–45% of your estimated max. Fast, then go home.'),
    ('bfa9eff6-4684-4862-ba6e-dc86b8d73caa', 40, 'est_1rm', NULL, '3', NULL, 'Primer: 40–45% of your estimated max. Fast, then go home.'),
    ('31d1838d-962c-43aa-b214-c694d862ea1a', 40, 'est_1rm', NULL, '3', NULL, 'Primer: 40–45% of your estimated max. One or two fast singles.');

  -- the rows that change: blank as written, on workouts nothing has touched
  CREATE TEMP TABLE vp_live ON COMMIT DROP AS
  SELECT f.*
    FROM vp_fill f
    JOIN public.pl_exercise_rows r ON r.id = f.id
    JOIN public.pl_days d ON d.id = r.day_id
    JOIN public.pl_weeks w ON w.id = d.week_id
   WHERE w.block_id IN (c_b3, c_b4)
     AND NOT public.pl_day_touched(d.id, d.scheduled_date, current_date)
     AND r.rpe IS NULL AND r.rir IS NULL AND r.load_kg IS NULL AND r.load_lb IS NULL
     AND coalesce(r.percentage_basis, 'manual') = 'manual';

  -- Thursday's order and the mock meet, only while those workouts are untouched
  CREATE TEMP TABLE vp_days ON COMMIT DROP AS
  SELECT d.id
    FROM public.pl_days d
   WHERE d.id IN (c_thu, c_test)
     AND NOT public.pl_day_touched(d.id, d.scheduled_date, current_date);

  -- back up first: every row on those workouts and every row filled in, plus the run marker
  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  SELECT 'pl_exercise_rows', r.id::text, to_jsonb(r)
    FROM public.pl_exercise_rows r
   WHERE r.id IN (SELECT id FROM vp_live) OR r.day_id IN (SELECT id FROM vp_days)
  UNION ALL
  SELECT 'run', 'vicky_peak_2026_11', jsonb_build_object('at', now(), 'blocks', jsonb_build_array(c_b3, c_b4));

  UPDATE public.pl_exercise_rows r
     SET percentage = l.pct,
         percentage_basis = l.basis,
         basis_row_id = l.basis_row,
         rpe = coalesce(l.rpe, r.rpe),
         rir = coalesce(l.rir, r.rir),
         notes = coalesce(l.notes, r.notes),
         manual_override = false,
         override_of_pct = NULL
    FROM vp_live l
   WHERE r.id = l.id
     AND (l.pct IS NOT NULL OR l.rpe IS NOT NULL OR l.rir IS NOT NULL);
  GET DIAGNOSTICS n_rows = ROW_COUNT;

  -- Block 4 W1 Thursday: each optional back-off right after its own single
  IF c_thu IN (SELECT id FROM vp_days) THEN
    UPDATE public.pl_exercise_rows r
       SET sort_order = o.pos
      FROM (VALUES
        ('fada28a3-8cf5-4065-a67b-2f8a10e6cfac'::uuid, 0),  -- squat single
        ('e1993f6a-7456-45d7-9d49-51115de2bb4d'::uuid, 1),  -- squat back-off
        ('1bdec5ec-9cb4-4d5d-9e78-7b69372b95c1'::uuid, 2),  -- bench single
        ('444579df-1e8f-4886-87c8-77b4a1fb9465'::uuid, 3),  -- bench back-off
        ('53b5b157-bb22-42f6-bd9c-a24f6396a330'::uuid, 4),  -- deadlift single
        ('e84242b7-c492-4c5c-93bc-d0e3136aa110'::uuid, 5),  -- deadlift back-off
        ('029b66f2-f33d-4f39-b828-adb9aa8712a4'::uuid, 6)   -- walk
      ) AS o(id, pos)
     WHERE r.id = o.id AND r.day_id = c_thu AND r.sort_order IS DISTINCT FROM o.pos;
    GET DIAGNOSTICS n_sort = ROW_COUNT;
  END IF;

  -- the mock meet: each lift's 3 × 1 becomes its opener, second and third attempt
  IF c_test IN (SELECT id FROM vp_days)
     AND (SELECT count(*) FROM public.pl_exercise_rows
           WHERE day_id = c_test AND sets = 3 AND rpe IS NULL AND percentage IS NULL
             AND id IN ('e24d0efb-d381-40e2-a136-6e9cfc5537e3', '8adc6b23-b8ef-4219-93ae-0175dc1f8f21', 'c08a35f3-8538-4e1c-9e12-9f6201a1b39d')) = 3 THEN
    CREATE TEMP TABLE vp_attempts (
      src uuid, step int, pct numeric, rpe text, notes text, pos int
    ) ON COMMIT DROP;
    INSERT INTO vp_attempts VALUES
      ('e24d0efb-d381-40e2-a136-6e9cfc5537e3', 1, 90,  '7–8',    'Opener: 90–92% of your estimated max. A weight you''d make on a bad day.', 0),
      ('e24d0efb-d381-40e2-a136-6e9cfc5537e3', 2, 96,  '8.5–9',  'Second attempt: 96–98%. Pick it from how the opener moved.', 1),
      ('e24d0efb-d381-40e2-a136-6e9cfc5537e3', 3, 100, '9.5–10', 'Third attempt: 100–103%, only if the second moved well. If it was slow, take a small jump or repeat it.', 2),
      ('8adc6b23-b8ef-4219-93ae-0175dc1f8f21', 1, 90,  '7–8',    'Opener: 90–92% of your estimated max. A weight you''d make on a bad day.', 3),
      ('8adc6b23-b8ef-4219-93ae-0175dc1f8f21', 2, 96,  '8.5–9',  'Second attempt: 96–98%. Pick it from how the opener moved.', 4),
      ('8adc6b23-b8ef-4219-93ae-0175dc1f8f21', 3, 100, '9.5–10', 'Third attempt: 100–103%, only if the second moved well. If it was slow, take a small jump or repeat it.', 5),
      ('c08a35f3-8538-4e1c-9e12-9f6201a1b39d', 1, 88,  '7–8',    'Opener: 88–91% of your estimated max. A weight you''d make on a bad day.', 6),
      ('c08a35f3-8538-4e1c-9e12-9f6201a1b39d', 2, 95,  '8.5–9',  'Second attempt: 95–98%. Pick it from how the opener moved.', 7),
      ('c08a35f3-8538-4e1c-9e12-9f6201a1b39d', 3, 100, '9.5–10', 'Third attempt: about 100%, picked from how squat and bench went and the total you want.', 8);

    -- the existing row is the opener
    UPDATE public.pl_exercise_rows r
       SET sets = 1, reps_text = '1', percentage = a.pct, percentage_basis = 'est_1rm',
           basis_row_id = NULL, rpe = a.rpe, notes = a.notes, sort_order = a.pos,
           manual_override = false, override_of_pct = NULL
      FROM vp_attempts a
     WHERE a.step = 1 AND r.id = a.src;

    -- the second and third attempts: copies of it at their own %
    INSERT INTO public.pl_exercise_rows (
      day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rir,
      percentage, percentage_basis, basis_row_id, load_kg, load_lb, rest_seconds, tempo,
      time_profile, intensity_techniques, progression_method, notes, estimated_seconds,
      estimated_seconds_override, manual_override, override_of_pct, load_unit, card_color,
      purpose_label, rest_seconds_override, measurement_type, duration_seconds, tracking_type,
      movement_family, cardio_target_id
    )
    SELECT s.day_id, a.pos, s.exercise_id, s.exercise_name_override, 1, '1', a.rpe, NULL,
           a.pct, 'est_1rm', NULL, NULL, NULL, s.rest_seconds, s.tempo,
           s.time_profile, s.intensity_techniques, s.progression_method, a.notes, s.estimated_seconds,
           s.estimated_seconds_override, false, NULL, s.load_unit, s.card_color,
           s.purpose_label, s.rest_seconds_override, s.measurement_type, s.duration_seconds, s.tracking_type,
           s.movement_family, NULL
      FROM vp_attempts a
      JOIN public.pl_exercise_rows s ON s.id = a.src
     WHERE a.step > 1;
    GET DIAGNOSTICS n_new = ROW_COUNT;

    UPDATE public.pl_exercise_rows
       SET sort_order = 9
     WHERE id = '436be7e1-9fb2-4f95-ad93-49f8dc5e4df6' AND day_id = c_test;
  END IF;

  -- visible and dated: live, like Start saves it
  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  SELECT 'pl_blocks', b.id::text, to_jsonb(b) FROM public.pl_blocks b
   WHERE b.id IN (c_b3, c_b4) AND b.status = 'Draft' AND b.client_visible AND NOT b.archived AND b.start_date IS NOT NULL;
  UPDATE public.pl_blocks b SET status = 'Active'
   WHERE b.id IN (c_b3, c_b4) AND b.status = 'Draft' AND b.client_visible AND NOT b.archived AND b.start_date IS NOT NULL;

  RAISE NOTICE 'vicky peak: % rows filled in, % reordered, % attempts added', n_rows, n_sort, n_new;
END $$;
