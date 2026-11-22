-- The program builder's set groups (Nov 22 2026, program-plan.ts): one
-- exercise written as several prescriptions (a top set, its back-offs,
-- warm-ups, groups the person names), each its own entry in the day, next to
-- each other, sharing `group`:
--
--   { key, exercise_id, sets, reps, rpe | rir, load + unit | pct + pct_of,
--     rest_seconds, tempo, notes,
--     role: 'warmup' | 'top' | 'backoff' | null, label: text | null,
--     group: key | null, round: 'fine' | null }
--
-- 1. athlete_program_clean_exercise keeps role, label (40 characters),
--    group and round (only on a % of the top set); everything else as before.
-- 2. pl_exercise_rows.load_round: how a % of the top set rounds in the logger
--    ('fine' = 2.5 lb / 1 kg; null = 5 lb / 2.5 kg, as before).
-- 3. athlete_program_insert_rows, which starting a program and saving one
--    that's running both use: each working set group is its own row, its
--    name its purpose label ("Top Set", "Back-off", or the person's own), so
--    the logger names the sets the same way; a % of the top set reads its own
--    exercise's top set (basis_row_id), never a back-off above it; warm-up
--    groups are never working rows (they'd count as working sets): they're
--    written at the top of the exercise's note ("Warm-up: 2 × 5 @ 60% of top
--    set"), and the logger's own warm-up rows log them. A warm-up group with
--    no working sets after it stays a row, so nothing written is lost.
--
-- No program anyone has saved changes: none has set groups yet (no member
-- program existed when this shipped), and an exercise without them is
-- written exactly as before.

-- ---------------------------------------------------------------------------
-- 1. Rounding a % of the top set
-- ---------------------------------------------------------------------------
ALTER TABLE public.pl_exercise_rows ADD COLUMN IF NOT EXISTS load_round text;
ALTER TABLE public.pl_exercise_rows DROP CONSTRAINT IF EXISTS pl_exercise_rows_load_round_check;
ALTER TABLE public.pl_exercise_rows
  ADD CONSTRAINT pl_exercise_rows_load_round_check CHECK (load_round IS NULL OR load_round = 'fine');
COMMENT ON COLUMN public.pl_exercise_rows.load_round IS
  'How a % of the top set rounds in the logger: ''fine'' = 2.5 lb / 1 kg (small plates); null = 5 lb / 2.5 kg.';

-- ---------------------------------------------------------------------------
-- 2. Cleaning an exercise: set groups kept
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_program_clean_exercise(e jsonb, _where text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid;
  v_ex record;
  v_sets int;
  v_reps text;
  v_rpe text;
  v_rir text;
  v_rest int;
  v_pct numeric;
  v_pct_of text;
  v_load numeric;
  v_unit text;
  v_role text;
  v_group text;
BEGIN
  IF jsonb_typeof(e) <> 'object' THEN
    RAISE EXCEPTION 'An exercise on % is not valid', _where USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_id := nullif(e->>'exercise_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_id := NULL;
  END;
  v_ex := NULL;
  IF v_id IS NOT NULL THEN
    SELECT x.name, coalesce(x.archived, false) AS archived INTO v_ex FROM public.exercises x WHERE x.id = v_id;
  END IF;
  IF v_id IS NULL OR v_ex.name IS NULL THEN
    RAISE EXCEPTION 'Pick each exercise from the library' USING ERRCODE = '22023';
  END IF;
  IF v_ex.archived THEN
    RAISE EXCEPTION '% is no longer in the library. Swap it for another exercise on %.', v_ex.name, _where
      USING ERRCODE = '22023';
  END IF;
  v_sets := CASE WHEN coalesce(e->>'sets', '') ~ '^\d{1,2}$' THEN (e->>'sets')::int END;
  IF v_sets IS NULL OR v_sets < 1 OR v_sets > 20 THEN
    RAISE EXCEPTION 'Sets must be 1 to 20 (%)', _where USING ERRCODE = '22023';
  END IF;
  v_reps := left(nullif(btrim(coalesce(e->>'reps', '')), ''), 20);
  IF v_reps IS NULL THEN
    RAISE EXCEPTION 'Every exercise needs reps, like 8 or 8-10 (%)', _where USING ERRCODE = '22023';
  END IF;
  v_rpe := nullif(btrim(coalesce(e->>'rpe', '')), '');
  IF v_rpe IS NOT NULL AND v_rpe !~ '^(10|[1-9](\.5)?)(-(10|[1-9](\.5)?))?$' THEN
    RAISE EXCEPTION 'RPE is 1 to 10, like 8 or 7-8 (%)', _where USING ERRCODE = '22023';
  END IF;
  -- one effort scale at a time: RPE wins
  v_rir := CASE WHEN v_rpe IS NULL THEN nullif(btrim(coalesce(e->>'rir', '')), '') END;
  IF v_rir IS NOT NULL AND v_rir !~ '^(10|[0-9](\.5)?)(-(10|[0-9](\.5)?))?$' THEN
    RAISE EXCEPTION 'RIR is 0 to 10, like 2 or 1-2 (%)', _where USING ERRCODE = '22023';
  END IF;
  -- a percentage or a fixed weight, never both (the percentage wins)
  v_pct := CASE WHEN coalesce(e->>'pct', '') ~ '^\d{1,3}(\.\d+)?$' THEN round((e->>'pct')::numeric, 2) END;
  IF v_pct IS NOT NULL AND (v_pct <= 0 OR v_pct > 150) THEN
    RAISE EXCEPTION 'A percentage is 1 to 150 (%)', _where USING ERRCODE = '22023';
  END IF;
  v_pct_of := CASE WHEN v_pct IS NULL THEN NULL WHEN e->>'pct_of' = 'top_set' THEN 'top_set' ELSE '1rm' END;
  v_load := CASE WHEN v_pct IS NULL AND coalesce(e->>'load', '') ~ '^\d{1,4}(\.\d+)?$'
                 THEN round((e->>'load')::numeric, 2) END;
  IF v_load IS NOT NULL AND (v_load <= 0 OR v_load > 1500) THEN
    RAISE EXCEPTION 'Check the weight (%)', _where USING ERRCODE = '22023';
  END IF;
  v_unit := CASE WHEN v_load IS NULL THEN NULL WHEN e->>'unit' = 'kg' THEN 'kg' ELSE 'lb' END;
  v_rest := CASE WHEN coalesce(e->>'rest_seconds', '') ~ '^\d{1,4}$' THEN (e->>'rest_seconds')::int END;
  IF v_rest IS NOT NULL AND v_rest > 900 THEN v_rest := 900; END IF;
  -- set groups: what the group is, the group it's in, how a % of the top set rounds
  v_role := CASE WHEN e->>'role' IN ('warmup', 'top', 'backoff') THEN e->>'role' END;
  v_group := CASE WHEN coalesce(e->>'group', '') ~ '^[A-Za-z0-9_-]{1,40}$' THEN e->>'group' END;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'key', public.athlete_program_key(e->>'key'),
    'exercise_id', v_id,
    'sets', v_sets,
    'reps', v_reps,
    'rpe', v_rpe,
    'rir', v_rir,
    'load', v_load,
    'unit', v_unit,
    'pct', v_pct,
    'pct_of', v_pct_of,
    'rest_seconds', v_rest,
    'tempo', left(nullif(btrim(coalesce(e->>'tempo', '')), ''), 12),
    'notes', left(nullif(btrim(coalesce(e->>'notes', '')), ''), 200),
    'role', v_role,
    'label', left(nullif(btrim(coalesce(e->>'label', '')), ''), 40),
    'group', v_group,
    'round', CASE WHEN e->>'round' = 'fine' AND v_pct_of = 'top_set' THEN 'fine' END));
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_clean_exercise(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_program_clean_exercise(jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. A day's exercises as calendar rows
-- ---------------------------------------------------------------------------

/** "2 × 5 @ 60% of top set" · "1 × 3 @ RPE 6" · "2 × 5 @ 135 lb": a warm-up group as words. */
CREATE OR REPLACE FUNCTION public.athlete_program_warmup_words(e jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT (e->>'sets') || ' × ' || coalesce(e->>'reps', '') ||
         CASE
           WHEN coalesce(e->>'pct', '') <> '' THEN
             ' @ ' || trim_scale((e->>'pct')::numeric)::text || '% of ' || CASE WHEN e->>'pct_of' = 'top_set' THEN 'top set' ELSE 'max' END
           WHEN coalesce(e->>'load', '') <> '' THEN
             ' @ ' || trim_scale((e->>'load')::numeric)::text || ' ' || CASE WHEN e->>'unit' = 'kg' THEN 'kg' ELSE 'lb' END
           WHEN coalesce(e->>'rpe', '') <> '' THEN ' @ RPE ' || (e->>'rpe')
           WHEN coalesce(e->>'rir', '') <> '' THEN ' @ ' || (e->>'rir') || ' RIR'
           ELSE ''
         END
$$;

CREATE OR REPLACE FUNCTION public.athlete_program_insert_rows(_day uuid, _exercises jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
  e jsonb;
  s int := 0;
  v_pct numeric;
  v_load numeric;
  v_unit text;
  v_group text;
  v_role text;
  v_notes text;
  v_label text;
  v_basis uuid;
  v_row uuid;
  -- a group's warm-ups, waiting for its first working row
  v_warm text := NULL;
  v_warm_group text := NULL;
  -- each group's top set row (its 'top', else its first working row)
  v_tops jsonb := '{}'::jsonb;
  v_locked jsonb := '{}'::jsonb;
BEGIN
  FOR r IN SELECT x AS e, o FROM jsonb_array_elements(coalesce(_exercises, '[]'::jsonb)) WITH ORDINALITY t(x, o) ORDER BY o LOOP
    e := r.e;
    v_group := nullif(e->>'group', '');
    v_role := e->>'role';
    -- a warm-up group goes into its exercise's note, unless no working sets follow it
    IF v_role = 'warmup' AND v_group IS NOT NULL AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(_exercises) WITH ORDINALITY y(x, o2)
          WHERE y.o2 > r.o AND y.x->>'group' = v_group AND coalesce(y.x->>'role', '') <> 'warmup') THEN
      v_warm := CASE WHEN v_warm IS NULL OR v_warm_group IS DISTINCT FROM v_group
                     THEN 'Warm-up: ' || public.athlete_program_warmup_words(e)
                     ELSE v_warm || ', ' || public.athlete_program_warmup_words(e) END;
      v_warm_group := v_group;
      CONTINUE;
    END IF;

    v_pct := nullif(e->>'pct', '')::numeric;
    v_load := CASE WHEN v_pct IS NULL THEN nullif(e->>'load', '')::numeric END;
    v_unit := CASE WHEN v_load IS NULL THEN NULL WHEN e->>'unit' = 'kg' THEN 'kg' ELSE 'lb' END;
    v_notes := nullif(e->>'notes', '');
    IF v_warm IS NOT NULL AND v_warm_group = v_group THEN
      v_notes := v_warm || coalesce(E'\n' || v_notes, '');
      v_warm := NULL;
      v_warm_group := NULL;
    END IF;
    -- its name in the workout: the person's own, else the role ("Top Set" / "Back-off" read as such everywhere)
    v_label := coalesce(
      left(nullif(btrim(coalesce(e->>'label', '')), ''), 40),
      CASE v_role WHEN 'top' THEN 'Top Set' WHEN 'backoff' THEN 'Back-off' WHEN 'warmup' THEN 'Warm-up' END);
    -- a % of the top set reads its own exercise's top set, never a back-off above it
    v_basis := CASE WHEN v_pct IS NOT NULL AND e->>'pct_of' = 'top_set' AND v_group IS NOT NULL
                    THEN (v_tops->>v_group)::uuid END;

    INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, sets, reps_text, rpe, rir, rest_seconds, notes, tempo,
                                         percentage, percentage_basis, load_kg, load_lb, load_unit,
                                         time_profile, measurement_type, tracking_type,
                                         purpose_label, basis_row_id, load_round)
    VALUES (_day, s, (e->>'exercise_id')::uuid, (e->>'sets')::int, e->>'reps', nullif(e->>'rpe', ''), nullif(e->>'rir', ''),
            nullif(e->>'rest_seconds', '')::int, v_notes, nullif(e->>'tempo', ''),
            v_pct, CASE WHEN v_pct IS NOT NULL THEN CASE WHEN e->>'pct_of' = 'top_set' THEN 'top_set' ELSE '1rm' END END,
            -- a fixed weight lives in its own unit's column only
            CASE WHEN v_unit = 'kg' THEN v_load END, CASE WHEN v_unit = 'lb' THEN v_load END, v_unit,
            'accessory_compound', 'reps', 'reps_weight',
            v_label, v_basis,
            CASE WHEN e->>'round' = 'fine' AND v_pct IS NOT NULL AND e->>'pct_of' = 'top_set' THEN 'fine' END)
    RETURNING id INTO v_row;
    s := s + 1;

    IF v_group IS NOT NULL AND coalesce(v_role, '') <> 'warmup' THEN
      IF v_role = 'top' AND NOT (v_locked ? v_group) THEN
        v_tops := v_tops || jsonb_build_object(v_group, v_row);
        v_locked := v_locked || jsonb_build_object(v_group, true);
      ELSIF NOT (v_tops ? v_group) THEN
        v_tops := v_tops || jsonb_build_object(v_group, v_row);
      END IF;
    END IF;
  END LOOP;
  RETURN s;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_insert_rows(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.athlete_program_warmup_words(jsonb) FROM PUBLIC, anon, authenticated;
