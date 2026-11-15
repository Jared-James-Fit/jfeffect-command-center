-- Missing program data, the rest of the coaching clients (Nov 15 2026), after
-- Vicky's (20270325090000): everything program_gaps() found on upcoming
-- workouts nothing has touched.
--
-- Alyssa Burg (meet prep for Total Fortification, Dec 5):
--   * her Sep 7 program was replaced on Sep 28 (its prep is Completed, ended
--     Sep 27), but its last two blocks were never ended: "Block 2 — Strength
--     Intensification" (Oct 5 – Nov 1) and "Block 3 — Peak and Performance
--     Realization" (Nov 2 – 29), visible, never trained (0 sets logged), put a
--     second workout on her calendar on the days of her real meet prep. Both
--     archived, the way Delete program archives one (Archived, reversible from
--     the Training tab);
--   * her meet prep's Block 3 and 4 are a % of her 1RM with no 1RM on file, so
--     she saw no weight: each reads her estimated max from her logged sets
--     instead (she rates nearly every set; the app's own rule for a 1RM % with
--     no max, withLoadingGuard), with an RPE as the cap and the fallback, by
--     the set's job: back-offs 6.5–7, lighter work 6, primers 5;
--   * accessories with nothing to go by get an RIR: 3, optional ones 4.
-- Shaina Sagar (taper and meet week):
--   * the "very easy" optional hip abduction and the empty-bar rows: RIR 5;
--   * "Rest" (no exercise, "No real training") on the day before the meet was
--     a row standing in for a note: it becomes the day's note and the row goes.
-- Untouched workouts only, rows still as written, every row backed up first
-- in program_loading_update_backup; re-running changes nothing ('run' marker).

DO $$
DECLARE
  n_arch int := 0; n_rows int := 0; n_rest int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.program_loading_update_backup WHERE source_table = 'run' AND row_id = 'program_gaps_fill_2026_11') THEN
    RAISE NOTICE 'program gaps fill-in: already applied';
    RETURN;
  END IF;

  -- Alyssa's replaced program: only blocks with nothing logged and nothing finished
  CREATE TEMP TABLE pg_arch ON COMMIT DROP AS
  SELECT b.id FROM public.pl_blocks b
   WHERE b.id IN ('2265c0e5-d098-4107-95fc-6f18f3fc6d3a', 'bef9a82f-13c1-4f48-bbb8-6371f4026151')
     AND NOT b.archived
     AND NOT EXISTS (SELECT 1 FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
                      JOIN public.pl_exercise_rows r ON r.day_id = d.id JOIN public.pl_row_results x ON x.row_id = r.id
                     WHERE w.block_id = b.id)
     AND NOT EXISTS (SELECT 1 FROM public.pl_weeks w JOIN public.pl_days d ON d.week_id = w.id
                      JOIN public.pl_day_completions c ON c.day_id = d.id WHERE w.block_id = b.id);

  CREATE TEMP TABLE pg_fill (id uuid PRIMARY KEY, basis text, rpe text, rir text) ON COMMIT DROP;
  INSERT INTO pg_fill VALUES
    -- Alyssa, Block 3 — Intensification (week 2)
    ('53adf854-223c-4a23-8407-c28f4bafa8c0', 'est_1rm', '7', NULL),
    ('ff970696-75f9-4111-acd9-8839bbcbffce', 'est_1rm', '7', NULL),
    ('f892d1ff-9794-46f3-be5a-63eb56969cdd', 'est_1rm', '6.5', NULL),
    ('f0d1423b-c1f5-4605-9624-4edd198f5a4d', 'est_1rm', '7', NULL),
    ('91d0bf45-05c2-4d51-9737-25b643dcf3c2', 'est_1rm', '6.5', NULL),
    ('7270ae64-39af-49fc-9b8d-15ef86b52d9a', 'est_1rm', '7', NULL),
    ('704ee2f6-e0fb-4236-94d1-c4f645866e16', NULL, NULL, '3'),
    ('36d66642-ab77-465e-8ea2-481ef75ca59a', NULL, NULL, '3'),
    ('6115e663-8688-4466-8625-bd78e200d7d7', NULL, NULL, '3'),
    ('ed703251-fe97-49e8-8a0a-5b53b0efa11b', NULL, NULL, '3'),
    ('4fb920d1-91be-4c2c-850d-24bd5318aded', NULL, NULL, '3'),
    ('a4cc3e24-f215-49a5-a28d-5612fcb9b15a', NULL, NULL, '3'),
    ('6ae5a324-a4a6-4237-8d89-79f1b38da2cc', NULL, NULL, '3'),
    -- Alyssa, Block 4 — Peak + Taper
    ('28cd26df-a73c-49fe-b28a-acb822f56ec1', 'est_1rm', '6.5', NULL),
    ('67b06ce0-1869-462a-b858-b19165a3f2aa', 'est_1rm', '6.5', NULL),
    ('894e80fd-4385-4192-a61a-92c4c23248e3', 'est_1rm', '6', NULL),
    ('7f241b27-3ff6-4bec-950a-2f97233f8885', 'est_1rm', '6.5', NULL),
    ('e0da4aa0-d88b-4b00-bc1b-14b2eb893bbb', 'est_1rm', '6', NULL),
    ('8837b9eb-595d-4cd9-8648-92126aec885b', 'est_1rm', '6', NULL),
    ('6a101650-2af8-4703-8077-85bd5c0e07fe', 'est_1rm', '7', NULL),
    ('0567fe35-3c7c-4d13-b9cd-b1f0dae488a1', 'est_1rm', '6', NULL),
    ('ea66134d-2a55-4892-b1fa-20f7fc86eba2', 'est_1rm', '7', NULL),
    ('9a9bc791-57d8-4f20-98aa-01ccf3b408e2', 'est_1rm', '6', NULL),
    ('10220e3b-6268-4298-ab16-0f25b8ca1f91', 'est_1rm', '5', NULL),
    ('2ee52ce3-46ec-45e2-86e5-a598aaeb74fe', 'est_1rm', '5', NULL),
    ('4ae876c4-ff38-484f-9b5f-c1ccc55b614d', 'est_1rm', '5', NULL),
    ('a64466fd-c44b-43e0-8d95-65ea112271fa', NULL, NULL, '3'),
    ('e9f68273-48d8-4935-81da-259a3fc7a88d', NULL, NULL, '3'),
    ('864babb6-cf48-4e0f-b96c-2018724feeb9', NULL, NULL, '3'),
    ('316b0abe-9d84-4dcd-91e8-c91dc19f1453', NULL, NULL, '4'),
    ('ecd6d0fd-39ef-4c67-93c5-be4a9f1e77eb', NULL, NULL, '4'),
    -- Shaina, Block 4 — Taper and Meet Week
    ('b8fa50fb-9e06-437b-8461-e4569cae10cd', NULL, NULL, '5'),
    ('f9cef2ee-16a7-490f-a5be-817aaf9353b4', NULL, NULL, '5'),
    ('bdc1ad3d-ba82-48a1-8bf5-4be8524c7a78', NULL, NULL, '5');

  -- rows still as written (no RPE / RIR; a % still of a 1RM) on untouched workouts
  CREATE TEMP TABLE pg_live ON COMMIT DROP AS
  SELECT f.* FROM pg_fill f
    JOIN public.pl_exercise_rows r ON r.id = f.id
    JOIN public.pl_days d ON d.id = r.day_id
   WHERE NOT public.pl_day_touched(d.id, d.scheduled_date, current_date)
     AND nullif(btrim(r.rpe), '') IS NULL AND nullif(btrim(r.rir), '') IS NULL
     AND (f.basis IS NULL OR r.percentage_basis = '1rm');

  -- Shaina's "Rest" row: the day before the meet, untouched, still a bare row
  CREATE TEMP TABLE pg_rest ON COMMIT DROP AS
  SELECT r.id, r.day_id FROM public.pl_exercise_rows r JOIN public.pl_days d ON d.id = r.day_id
   WHERE r.id = '887b39ab-e00a-4c4f-965d-2bec1e10c1e9' AND r.exercise_id IS NULL AND r.exercise_name_override = 'Rest'
     AND NOT public.pl_day_touched(d.id, d.scheduled_date, current_date);

  INSERT INTO public.program_loading_update_backup (source_table, row_id, row_data)
  SELECT 'pl_blocks', b.id::text, to_jsonb(b) FROM public.pl_blocks b WHERE b.id IN (SELECT id FROM pg_arch)
  UNION ALL
  SELECT 'pl_exercise_rows', r.id::text, to_jsonb(r) FROM public.pl_exercise_rows r
   WHERE r.id IN (SELECT id FROM pg_live) OR r.id IN (SELECT id FROM pg_rest)
  UNION ALL
  SELECT 'pl_days', d.id::text, to_jsonb(d) FROM public.pl_days d WHERE d.id IN (SELECT day_id FROM pg_rest)
  UNION ALL
  SELECT 'run', 'program_gaps_fill_2026_11', jsonb_build_object('at', now());

  UPDATE public.pl_blocks b
     SET status = 'Archived', archived = true, archived_at = now()
   WHERE b.id IN (SELECT id FROM pg_arch);
  GET DIAGNOSTICS n_arch = ROW_COUNT;

  UPDATE public.pl_exercise_rows r
     SET percentage_basis = coalesce(l.basis, r.percentage_basis),
         rpe = coalesce(l.rpe, r.rpe),
         rir = coalesce(l.rir, r.rir),
         manual_override = false,
         override_of_pct = NULL
    FROM pg_live l
   WHERE r.id = l.id;
  GET DIAGNOSTICS n_rows = ROW_COUNT;

  UPDATE public.pl_days d
     SET notes = 'Required recovery day. No real training.', notes_client_visible = true
   WHERE d.id IN (SELECT day_id FROM pg_rest) AND nullif(btrim(d.notes), '') IS NULL;
  DELETE FROM public.pl_exercise_rows WHERE id IN (SELECT id FROM pg_rest);
  GET DIAGNOSTICS n_rest = ROW_COUNT;

  RAISE NOTICE 'program gaps fill-in: % blocks archived, % rows filled in, % rest row moved to its day', n_arch, n_rows, n_rest;
END $$;
