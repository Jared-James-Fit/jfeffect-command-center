-- Programs people build: blocks, weeks and days, every week written out.
--
-- Until now a member's program (athlete_programs) was one week of training
-- days repeated for `weeks` weeks, so nothing could change week to week (no
-- progression, no deload, no second block). athlete_programs.plan holds the
-- whole program:
--
--   { v: 1, blocks: [{ key, name, weeks: [{ key, days: [{ key, title, focus,
--     exercises: [{ key, exercise_id, sets, reps, rpe | rir, load + unit |
--     pct + pct_of ('1rm' | 'top_set'), rest_seconds, tempo, notes }] }] }] }] }
--
-- `key`s are how the builder finds the same day and exercise in every week
-- (an edit to "every week of Block 1" reaches each week's own copy). The
-- columns lists and cards read stay derived from it: `days` is week 1 (the
-- shape older apps read), `weeks` the total, `days_per_week` the most any
-- week has. A program saved before this has no plan and reads as its week
-- repeated (athlete_program_weeks), exactly as it ran before.
--
-- Starting one writes each block as its own pl_block (several under one
-- pl_preps program, like a JF Effect plan), each week's own days and rows,
-- with a fixed weight, a % of a max or a % of today's top set carried into
-- the logger's own columns. Editing one that's running moves the untouched
-- workouts on the calendar week by week. Nothing here changes a program
-- anyone has saved (no member had built one when this shipped).

-- ---------------------------------------------------------------------------
-- 1. The column, and room for longer programs (a 24-week meet prep)
-- ---------------------------------------------------------------------------
ALTER TABLE public.athlete_programs
  ADD COLUMN IF NOT EXISTS plan jsonb CHECK (plan IS NULL OR jsonb_typeof(plan) = 'object');
ALTER TABLE public.athlete_programs DROP CONSTRAINT IF EXISTS athlete_programs_weeks_check;
ALTER TABLE public.athlete_programs
  ADD CONSTRAINT athlete_programs_weeks_check CHECK (weeks BETWEEN 1 AND 24);

-- ---------------------------------------------------------------------------
-- 2. Checking and cleaning a plan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_program_key(_k text)
RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT CASE WHEN coalesce(_k, '') ~ '^[A-Za-z0-9_-]{1,40}$' THEN _k
              ELSE substr(md5(random()::text || clock_timestamp()::text), 1, 12) END
$$;
REVOKE ALL ON FUNCTION public.athlete_program_key(text) FROM PUBLIC, anon, authenticated;

/** One exercise of a plan, checked and cleaned; `_where` names its day in messages. */
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
    'notes', left(nullif(btrim(coalesce(e->>'notes', '')), ''), 200)));
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_clean_exercise(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_program_clean_exercise(jsonb, text) TO service_role;

/** A whole plan checked and cleaned (the builder's planIssue says the same things first). */
CREATE OR REPLACE FUNCTION public.athlete_program_clean_plan(_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  b jsonb;
  w jsonb;
  d jsonb;
  e jsonb;
  bi int := 0;
  g int := 0;
  di int;
  v_total int;
  v_title text;
  v_where text;
  out_blocks jsonb := '[]'::jsonb;
  out_weeks jsonb;
  out_days jsonb;
  out_ex jsonb;
BEGIN
  IF _plan IS NULL OR jsonb_typeof(_plan) <> 'object' OR jsonb_typeof(_plan->'blocks') <> 'array'
     OR jsonb_array_length(_plan->'blocks') = 0 THEN
    RAISE EXCEPTION 'Add at least one block of training' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_plan->'blocks') > 8 THEN
    RAISE EXCEPTION 'A program has at most 8 blocks' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(CASE WHEN jsonb_typeof(x->'weeks') = 'array' THEN jsonb_array_length(x->'weeks') ELSE 0 END), 0)
    INTO v_total FROM jsonb_array_elements(_plan->'blocks') x;
  IF v_total < 1 THEN RAISE EXCEPTION 'Add at least one week' USING ERRCODE = '22023'; END IF;
  IF v_total > 24 THEN RAISE EXCEPTION 'A program has at most 24 weeks' USING ERRCODE = '22023'; END IF;

  FOR b IN SELECT x FROM jsonb_array_elements(_plan->'blocks') WITH ORDINALITY t(x, o) ORDER BY o LOOP
    bi := bi + 1;
    IF jsonb_typeof(b) <> 'object' OR jsonb_typeof(b->'weeks') <> 'array' OR jsonb_array_length(b->'weeks') = 0 THEN
      RAISE EXCEPTION 'Block % needs at least one week', bi USING ERRCODE = '22023';
    END IF;
    out_weeks := '[]'::jsonb;
    FOR w IN SELECT x FROM jsonb_array_elements(b->'weeks') WITH ORDINALITY t(x, o) ORDER BY o LOOP
      g := g + 1;
      IF jsonb_typeof(w) <> 'object' OR jsonb_typeof(w->'days') <> 'array' OR jsonb_array_length(w->'days') = 0 THEN
        RAISE EXCEPTION 'Add a training day to week %', g USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(w->'days') > 7 THEN
        RAISE EXCEPTION 'Week % has more than 7 training days', g USING ERRCODE = '22023';
      END IF;
      out_days := '[]'::jsonb;
      di := 0;
      FOR d IN SELECT x FROM jsonb_array_elements(w->'days') WITH ORDINALITY t(x, o) ORDER BY o LOOP
        di := di + 1;
        IF jsonb_typeof(d) <> 'object' THEN
          RAISE EXCEPTION 'A day in week % is not valid', g USING ERRCODE = '22023';
        END IF;
        v_title := left(nullif(btrim(coalesce(d->>'title', '')), ''), 40);
        v_where := coalesce(v_title, 'Day ' || di) || CASE WHEN v_total > 1 THEN ' (week ' || g || ')' ELSE '' END;
        IF jsonb_typeof(d->'exercises') <> 'array' OR jsonb_array_length(d->'exercises') = 0 THEN
          RAISE EXCEPTION 'Add an exercise to %', v_where USING ERRCODE = '22023';
        END IF;
        IF jsonb_array_length(d->'exercises') > 20 THEN
          RAISE EXCEPTION '% has more than 20 exercises', v_where USING ERRCODE = '22023';
        END IF;
        out_ex := '[]'::jsonb;
        FOR e IN SELECT x FROM jsonb_array_elements(d->'exercises') WITH ORDINALITY t(x, o) ORDER BY o LOOP
          out_ex := out_ex || jsonb_build_array(public.athlete_program_clean_exercise(e, v_where));
        END LOOP;
        out_days := out_days || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'key', public.athlete_program_key(d->>'key'),
          'title', coalesce(v_title, 'Day ' || di),
          'focus', left(nullif(btrim(coalesce(d->>'focus', '')), ''), 60),
          'exercises', out_ex)));
      END LOOP;
      out_weeks := out_weeks || jsonb_build_array(jsonb_build_object(
        'key', public.athlete_program_key(w->>'key'), 'days', out_days));
    END LOOP;
    out_blocks := out_blocks || jsonb_build_array(jsonb_build_object(
      'key', public.athlete_program_key(b->>'key'),
      'name', coalesce(left(nullif(btrim(coalesce(b->>'name', '')), ''), 40), 'Block ' || bi),
      'weeks', out_weeks));
  END LOOP;
  RETURN jsonb_build_object('v', 1, 'blocks', out_blocks);
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_clean_plan(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athlete_program_clean_plan(jsonb) TO service_role;

/** Week 1's days in the shape older apps read (`athlete_programs.days`). */
CREATE OR REPLACE FUNCTION public.athlete_program_plan_first_days(_plan jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'title', d->'title',
           'focus', d->'focus',
           'exercises', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                  'exercise_id', e->'exercise_id', 'sets', e->'sets', 'reps', e->'reps',
                                  'rpe', e->'rpe', 'rest_seconds', e->'rest_seconds', 'notes', e->'notes')) ORDER BY eo),
                                '[]'::jsonb)
                           FROM jsonb_array_elements(coalesce(d->'exercises', '[]'::jsonb)) WITH ORDINALITY te(e, eo))))
           ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(_plan->'blocks'->0->'weeks'->0->'days', '[]'::jsonb)) WITH ORDINALITY t(d, o)
$$;

CREATE OR REPLACE FUNCTION public.athlete_program_plan_weeks(_plan jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(sum(jsonb_array_length(coalesce(b->'weeks', '[]'::jsonb))), 0)::int
    FROM jsonb_array_elements(coalesce(_plan->'blocks', '[]'::jsonb)) b
$$;

CREATE OR REPLACE FUNCTION public.athlete_program_plan_days_per_week(_plan jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(max(jsonb_array_length(coalesce(w->'days', '[]'::jsonb))), 0)::int
    FROM jsonb_array_elements(coalesce(_plan->'blocks', '[]'::jsonb)) b,
         jsonb_array_elements(coalesce(b->'weeks', '[]'::jsonb)) w
$$;

/**
 * Every week of a program in order: its program week (g), its block (number
 * and name), its week in the block and its days. A program saved before
 * plans is its one week repeated, in one block named for the program.
 */
CREATE OR REPLACE FUNCTION public.athlete_program_weeks(_plan jsonb, _days jsonb, _weeks integer, _title text)
RETURNS TABLE (g integer, block_no integer, block_name text, week_no integer, days jsonb)
LANGUAGE sql IMMUTABLE AS $$
  SELECT x.g, x.block_no, x.block_name, x.week_no, x.days FROM (
    SELECT (row_number() OVER (ORDER BY bo, wo))::int AS g, bo::int AS block_no,
           coalesce(nullif(btrim(blk->>'name'), ''), 'Block ' || bo) AS block_name, wo::int AS week_no,
           coalesce(wk->'days', '[]'::jsonb) AS days
      FROM jsonb_array_elements(_plan->'blocks') WITH ORDINALITY b(blk, bo),
           jsonb_array_elements(blk->'weeks') WITH ORDINALITY w(wk, wo)
     WHERE _plan IS NOT NULL
    UNION ALL
    SELECT s::int, 1, _title, s::int, coalesce(_days, '[]'::jsonb)
      FROM generate_series(1, greatest(coalesce(_weeks, 1), 1)) s
     WHERE _plan IS NULL) x
  ORDER BY x.g
$$;

/** A day's exercises as calendar rows (each in the logger's own columns). */
CREATE OR REPLACE FUNCTION public.athlete_program_insert_rows(_day uuid, _exercises jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  e jsonb;
  s int := 0;
  v_pct numeric;
  v_load numeric;
  v_unit text;
BEGIN
  FOR e IN SELECT x FROM jsonb_array_elements(coalesce(_exercises, '[]'::jsonb)) WITH ORDINALITY t(x, o) ORDER BY o LOOP
    v_pct := nullif(e->>'pct', '')::numeric;
    v_load := CASE WHEN v_pct IS NULL THEN nullif(e->>'load', '')::numeric END;
    v_unit := CASE WHEN v_load IS NULL THEN NULL WHEN e->>'unit' = 'kg' THEN 'kg' ELSE 'lb' END;
    INSERT INTO public.pl_exercise_rows (day_id, sort_order, exercise_id, sets, reps_text, rpe, rir, rest_seconds, notes, tempo,
                                         percentage, percentage_basis, load_kg, load_lb, load_unit,
                                         time_profile, measurement_type, tracking_type)
    VALUES (_day, s, (e->>'exercise_id')::uuid, (e->>'sets')::int, e->>'reps', nullif(e->>'rpe', ''), nullif(e->>'rir', ''),
            nullif(e->>'rest_seconds', '')::int, nullif(e->>'notes', ''), nullif(e->>'tempo', ''),
            v_pct, CASE WHEN v_pct IS NOT NULL THEN CASE WHEN e->>'pct_of' = 'top_set' THEN 'top_set' ELSE '1rm' END END,
            -- a fixed weight lives in its own unit's column only
            CASE WHEN v_unit = 'kg' THEN v_load END, CASE WHEN v_unit = 'lb' THEN v_load END, v_unit,
            'accessory_compound', 'reps', 'reps_weight');
    s := s + 1;
  END LOOP;
  RETURN s;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_insert_rows(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Saving
-- ---------------------------------------------------------------------------
/** Create (no id) or update your own program from its plan. Returns its id. */
CREATE OR REPLACE FUNCTION public.athlete_program_save_plan(
  _id uuid, _title text, _description text, _goal text, _level text, _plan jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan jsonb;
  v_days jsonb;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.athlete_program_can_author() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  v_plan := public.athlete_program_clean_plan(_plan);
  v_days := public.athlete_program_plan_first_days(v_plan);
  IF _id IS NULL THEN
    IF (SELECT count(*) FROM public.athlete_programs WHERE owner_id = v_uid AND archived_at IS NULL) >= 50 THEN
      RAISE EXCEPTION 'You have 50 programs. Delete one to make another.' USING ERRCODE = '54000';
    END IF;
    INSERT INTO public.athlete_programs (owner_id, title, description, goal, level, weeks, days, plan, days_per_week, exercise_count)
    VALUES (v_uid, btrim(_title), nullif(btrim(coalesce(_description, '')), ''), nullif(_goal, ''), nullif(_level, ''),
            public.athlete_program_plan_weeks(v_plan), v_days, v_plan,
            public.athlete_program_plan_days_per_week(v_plan), public.athlete_program_count_exercises(v_days))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.athlete_programs
       SET title = btrim(_title),
           description = nullif(btrim(coalesce(_description, '')), ''),
           goal = nullif(_goal, ''),
           level = nullif(_level, ''),
           weeks = public.athlete_program_plan_weeks(v_plan),
           days = v_days,
           plan = v_plan,
           days_per_week = public.athlete_program_plan_days_per_week(v_plan),
           exercise_count = public.athlete_program_count_exercises(v_days),
           updated_at = now()
     WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_save_plan(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_save_plan(uuid, text, text, text, text, jsonb) TO authenticated;

/**
 * The save an older app still sends (one week): a new program as before, but
 * never over a program that has a plan, which it would flatten to one week.
 */
CREATE OR REPLACE FUNCTION public.athlete_program_save(
  _id uuid, _title text, _description text, _goal text, _level text, _weeks integer, _days jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_days jsonb;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.athlete_program_can_author() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _id IS NOT NULL AND EXISTS (SELECT 1 FROM public.athlete_programs WHERE id = _id AND plan IS NOT NULL) THEN
    RAISE EXCEPTION 'This app is out of date. Close it and open it again to edit this program.' USING ERRCODE = '22023';
  END IF;
  v_days := public.athlete_program_clean_days(_days);
  IF _id IS NULL THEN
    IF (SELECT count(*) FROM public.athlete_programs WHERE owner_id = v_uid AND archived_at IS NULL) >= 50 THEN
      RAISE EXCEPTION 'You have 50 programs. Delete one to make another.' USING ERRCODE = '54000';
    END IF;
    INSERT INTO public.athlete_programs (owner_id, title, description, goal, level, weeks, days, days_per_week, exercise_count)
    VALUES (v_uid, btrim(_title), nullif(btrim(coalesce(_description, '')), ''), nullif(_goal, ''), nullif(_level, ''),
            least(greatest(coalesce(_weeks, 4), 1), 24), v_days, jsonb_array_length(v_days),
            public.athlete_program_count_exercises(v_days))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.athlete_programs
       SET title = btrim(_title),
           description = nullif(btrim(coalesce(_description, '')), ''),
           goal = nullif(_goal, ''),
           level = nullif(_level, ''),
           weeks = least(greatest(coalesce(_weeks, weeks), 1), 24),
           days = v_days,
           days_per_week = jsonb_array_length(v_days),
           exercise_count = public.athlete_program_count_exercises(v_days),
           updated_at = now()
     WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_save(uuid, text, text, text, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_save(uuid, text, text, text, text, integer, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading: a card says how many blocks; the detail carries the plan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_program_card(p public.athlete_programs)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'description', p.description,
    'goal', p.goal,
    'level', p.level,
    'weeks', p.weeks,
    'blocks', CASE WHEN p.plan IS NULL THEN 1 ELSE jsonb_array_length(p.plan->'blocks') END,
    'days_per_week', p.days_per_week,
    'exercise_count', p.exercise_count,
    'visibility', p.visibility,
    'published_at', p.published_at,
    'updated_at', p.updated_at,
    'save_count', p.save_count,
    'start_count', p.start_count,
    'hidden', p.hidden_at IS NOT NULL,
    'is_mine', public.community_main_account(p.owner_id) = public.community_main_account(auth.uid()),
    'author', public.community_author(p.owner_id),
    'day_titles', (SELECT coalesce(jsonb_agg(d->>'title' ORDER BY o), '[]'::jsonb)
                     FROM jsonb_array_elements(p.days) WITH ORDINALITY t(d, o)),
    -- "Based on a program by @X", unless X and the viewer blocked each other
    'forked_from', CASE WHEN p.forked_from_owner IS NOT NULL
                         AND public.community_main_account(p.forked_from_owner) NOT IN (
                               SELECT b FROM public.community_blocked_authors() b WHERE b IS NOT NULL)
                    THEN jsonb_build_object('id', p.forked_from, 'author', public.community_author(p.forked_from_owner)) END)
$$;
REVOKE ALL ON FUNCTION public.athlete_program_card(public.athlete_programs) FROM PUBLIC, anon, authenticated;

/** One program in full: its card, week 1's days with names (older apps), and the whole plan. */
CREATE OR REPLACE FUNCTION public.athlete_program_detail(_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN p.id IS NULL OR NOT public.athlete_program_visible(p.owner_id, p.visibility, p.hidden_at, p.archived_at)
              THEN NULL
         ELSE public.athlete_program_card(p) || jsonb_build_object(
           'hidden_reason', CASE WHEN public.is_community_staff() OR p.owner_id = auth.uid() THEN p.hidden_reason END,
           'can_moderate', public.is_community_staff(),
           'copied', EXISTS (SELECT 1 FROM public.athlete_programs m
                              WHERE m.owner_id = auth.uid() AND m.forked_from = p.id AND m.archived_at IS NULL),
           'days', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'title', d->>'title',
                       'focus', d->>'focus',
                       'exercises', (SELECT coalesce(jsonb_agg(e || jsonb_build_object(
                                        'name', x.name, 'muscle_group', x.muscle_group, 'equipment', x.equipment) ORDER BY eo), '[]'::jsonb)
                                       FROM jsonb_array_elements(coalesce(d->'exercises', '[]'::jsonb)) WITH ORDINALITY te(e, eo)
                                       LEFT JOIN public.exercises x ON x.id = nullif(e->>'exercise_id', '')::uuid)
                     ) ORDER BY o), '[]'::jsonb)
                      FROM jsonb_array_elements(p.days) WITH ORDINALITY t(d, o)),
           'plan', p.plan,
           -- every exercise the plan names, once: { id: { name, muscle_group, equipment } }
           'exercise_info', (SELECT coalesce(jsonb_object_agg(x.id, jsonb_build_object(
                                      'name', x.name, 'muscle_group', x.muscle_group, 'equipment', x.equipment)), '{}'::jsonb)
                               FROM public.exercises x
                              WHERE p.plan IS NOT NULL
                                AND x.id IN (SELECT DISTINCT (e->>'exercise_id')::uuid
                                               FROM jsonb_array_elements(p.plan->'blocks') b,
                                                    jsonb_array_elements(b->'weeks') w,
                                                    jsonb_array_elements(w->'days') d,
                                                    jsonb_array_elements(d->'exercises') e)))
         END
    FROM (SELECT 1) one
    LEFT JOIN public.athlete_programs p ON p.id = _id
$$;
REVOKE ALL ON FUNCTION public.athlete_program_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_detail(uuid) TO authenticated;

/** Your own copy of a program you can see (yours or a shared one), plan and all. The original never changes. */
CREATE OR REPLACE FUNCTION public.athlete_program_copy(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_id uuid;
  v_first boolean;
  v_own boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.athlete_program_can_author() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id;
  IF NOT FOUND OR NOT public.athlete_program_visible(p.owner_id, p.visibility, p.hidden_at, p.archived_at) THEN
    RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.athlete_programs WHERE owner_id = v_uid AND archived_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'You have 50 programs. Delete one to make another.' USING ERRCODE = '54000';
  END IF;
  v_own := p.owner_id = v_uid;
  v_first := NOT v_own AND NOT EXISTS (
    SELECT 1 FROM public.athlete_programs m WHERE m.owner_id = v_uid AND m.forked_from = p.id);
  INSERT INTO public.athlete_programs (owner_id, title, description, goal, level, weeks, days, plan, days_per_week, exercise_count,
                                       forked_from, forked_from_owner, hidden_at, hidden_by, hidden_reason)
  VALUES (v_uid,
          CASE WHEN v_own THEN left(p.title || ' (copy)', 80) ELSE p.title END,
          p.description, p.goal, p.level, p.weeks, p.days, p.plan, p.days_per_week, p.exercise_count,
          CASE WHEN v_own THEN p.forked_from ELSE p.id END,
          CASE WHEN v_own THEN p.forked_from_owner ELSE p.owner_id END,
          -- what the team took down can't come back up through Duplicate
          CASE WHEN v_own THEN p.hidden_at END,
          CASE WHEN v_own THEN p.hidden_by END,
          CASE WHEN v_own THEN p.hidden_reason END)
  RETURNING id INTO v_id;
  IF v_first THEN
    UPDATE public.athlete_programs SET save_count = save_count + 1 WHERE id = p.id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_copy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_copy(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Starting one: a pl_block per block (one pl_preps program over several)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_program_start(_id uuid, _start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_client uuid;
  v_tz text;
  v_today date;
  v_start date;
  v_old uuid[];
  v_new int;
  v_blocks int;
  v_weeks int;
  v_prep uuid;
  v_block uuid;
  v_first uuid;
  v_week uuid;
  v_day uuid;
  v_bstart date;
  v_wstart date;
  v_cur int := 0;
  wk record;
  d jsonb;
  i int;
  n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND c.service_tier = 'self_serve' AND coalesce(c.archived, false) = false;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Your coach writes your program, so it can''t be started here.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.member_can_consume(v_uid) THEN
    RAISE EXCEPTION 'Your account doesn''t have access right now.' USING ERRCODE = '42501';
  END IF;
  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));
  v_start := coalesce(_start, v_today);
  IF v_start < v_today - 1 THEN
    RAISE EXCEPTION 'Pick a start date from today on' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) x
                  WHERE jsonb_array_length(x.days) > 0) THEN
    RAISE EXCEPTION 'Add a training day first' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.pl_blocks b
       WHERE b.client_id = v_client AND b.created_by = v_uid AND b.created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'You''ve started 10 programs today. Try again tomorrow.' USING ERRCODE = '54000';
  END IF;

  -- the program they ran before makes way: archived, never deleted (its logs stay)
  SELECT array_agg(b.id) INTO v_old FROM public.pl_blocks b
   WHERE b.client_id = v_client AND b.created_by = v_uid AND b.archived = false
     AND coalesce(b.source_template_block_key, '') NOT LIKE 'at_home_backup%';
  IF v_old IS NOT NULL THEN
    UPDATE public.pl_blocks SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
     WHERE id = ANY (v_old);
    UPDATE public.pl_preps SET status = 'Archived', archived = true, archived_at = now(), archived_by = v_uid
     WHERE created_by = v_uid AND archived = false
       AND id IN (SELECT b.prep_id FROM public.pl_blocks b WHERE b.id = ANY (v_old) AND b.prep_id IS NOT NULL);
  END IF;

  SELECT count(DISTINCT x.block_no), count(*) INTO v_blocks, v_weeks
    FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) x;
  -- several blocks are one program, like a JF Effect plan
  IF v_blocks > 1 THEN
    INSERT INTO public.pl_preps (client_id, title, status, client_visible, start_date, end_date, total_weeks, created_by)
    VALUES (v_client, p.title, 'Active', true, v_start, v_start + (v_weeks * 7 - 1), v_weeks, v_uid)
    RETURNING id INTO v_prep;
  END IF;

  FOR wk IN SELECT * FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) ORDER BY g LOOP
    IF wk.block_no <> v_cur THEN
      v_cur := wk.block_no;
      v_bstart := v_start + (wk.g - 1) * 7;
      INSERT INTO public.pl_blocks (client_id, prep_id, name, weeks, goal, status, client_visible, start_date, end_date,
                                    sort_order, created_by, source_athlete_program_id)
      SELECT v_client, v_prep,
             CASE WHEN v_blocks > 1 THEN wk.block_name ELSE p.title END,
             count(*), p.goal,
             CASE WHEN v_cur = 1 THEN 'Active' ELSE 'Draft' END,
             true, v_bstart, v_bstart + (count(*)::int * 7 - 1), v_cur - 1, v_uid, p.id
        FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) y
       WHERE y.block_no = wk.block_no
      RETURNING id INTO v_block;
      v_first := coalesce(v_first, v_block);
    END IF;
    v_wstart := v_start + (wk.g - 1) * 7;
    INSERT INTO public.pl_weeks (block_id, week_index, start_date, end_date)
    VALUES (v_block, wk.week_no, v_wstart, v_wstart + 6)
    RETURNING id INTO v_week;
    n := jsonb_array_length(wk.days);
    i := 0;
    FOR d IN SELECT x FROM jsonb_array_elements(wk.days) WITH ORDINALITY t(x, o) ORDER BY o LOOP
      i := i + 1;
      INSERT INTO public.pl_days (week_id, day_index, title, focus, scheduled_date, schedule_source)
      VALUES (v_week, i, coalesce(nullif(d->>'title', ''), 'Day ' || i), nullif(d->>'focus', ''),
              v_wstart + public.pl_week_day_offset(i, n), 'builder_assignment')
      RETURNING id INTO v_day;
      PERFORM public.athlete_program_insert_rows(v_day, d->'exercises');
    END LOOP;
  END LOOP;

  -- "started by N people": each person once, on the program and the original it was copied from
  INSERT INTO public.athlete_program_starts (program_id, user_id) VALUES (p.id, v_uid) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  IF v_new > 0 THEN
    UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.id;
  END IF;
  IF p.forked_from IS NOT NULL AND p.forked_from_owner IS DISTINCT FROM v_uid THEN
    INSERT INTO public.athlete_program_starts (program_id, user_id)
    SELECT p.forked_from, v_uid WHERE EXISTS (SELECT 1 FROM public.athlete_programs o WHERE o.id = p.forked_from)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      UPDATE public.athlete_programs SET start_count = start_count + 1 WHERE id = p.forked_from;
    END IF;
  END IF;
  RETURN jsonb_build_object('block_id', v_first, 'prep_id', v_prep, 'client_id', v_client,
                            'replaced', coalesce(array_length(v_old, 1), 0));
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_start(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_start(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. The running copy follows edits, week by week
-- ---------------------------------------------------------------------------
-- Program week g is the running copy's g-th week, counted across its blocks
-- in order. A workout that's past, started or has anything logged never
-- changes (pl_day_touched); the rest take that week's own days. Weeks the
-- program grew by go on the end of its last block; weeks past its new length
-- go once nothing is left in them. Block names follow the plan's.
CREATE OR REPLACE FUNCTION public.athlete_program_sync_running(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  p public.athlete_programs%ROWTYPE;
  v_client uuid;
  v_tz text;
  v_today date;
  v_start date;
  v_blocks uuid[];
  v_last uuid;
  v_prep uuid;
  v_total int;
  v_have int;
  v_lastidx int;
  v_next date;
  v_day uuid;
  v_wend date;
  v_days jsonb;
  v_per int;
  rw record;
  dy record;
  d jsonb;
  n int;
  i int;
  s int;
  v_bid uuid;
  v_updated int := 0;
  v_added int := 0;
  v_removed int := 0;
  v_kept int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.athlete_programs WHERE id = _id AND owner_id = v_uid AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002'; END IF;
  SELECT c.id, c.timezone INTO v_client, v_tz FROM public.clients c
   WHERE c.user_id = v_uid AND coalesce(c.archived, false) = false LIMIT 1;
  IF v_client IS NULL THEN RETURN NULL; END IF;

  SELECT array_agg(b.id ORDER BY b.start_date NULLS LAST, b.sort_order, b.created_at), max(b.prep_id::text)::uuid
    INTO v_blocks, v_prep
    FROM public.pl_blocks b
   WHERE b.client_id = v_client AND b.created_by = v_uid AND b.source_athlete_program_id = _id AND b.archived = false;
  IF v_blocks IS NULL THEN RETURN NULL; END IF;
  v_last := v_blocks[array_length(v_blocks, 1)];

  v_today := public.pt_local_today(coalesce(v_tz, 'America/Winnipeg'));
  SELECT min(b.start_date) INTO v_start FROM public.pl_blocks b WHERE b.id = ANY (v_blocks);
  v_start := coalesce(v_start, v_today);
  SELECT count(*), coalesce(max(jsonb_array_length(x.days)), 0) INTO v_total, v_per
    FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) x;
  IF v_total = 0 OR v_per = 0 THEN RAISE EXCEPTION 'Add a training day first' USING ERRCODE = '22023'; END IF;

  -- weeks the program grew by go on the end of its last block
  SELECT count(*) INTO v_have
    FROM public.pl_weeks w
   WHERE w.block_id = ANY (v_blocks) AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL;
  IF v_have < v_total THEN
    SELECT coalesce(max(w.week_index), 0), max(w.end_date) INTO v_lastidx, v_next
      FROM public.pl_weeks w
     WHERE w.block_id = v_last AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL;
    v_next := coalesce(v_next + 1, v_start + v_have * 7);
    FOR i IN 1..(v_total - v_have) LOOP
      INSERT INTO public.pl_weeks (block_id, week_index, start_date, end_date)
      VALUES (v_last, v_lastidx + i, v_next + (i - 1) * 7, v_next + (i - 1) * 7 + 6);
    END LOOP;
  END IF;

  FOR rw IN
    SELECT w.id, w.block_id, w.week_index, w.start_date, w.end_date,
           row_number() OVER (ORDER BY array_position(v_blocks, w.block_id), w.week_index)::int AS g
      FROM public.pl_weeks w
     WHERE w.block_id = ANY (v_blocks) AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL
     ORDER BY array_position(v_blocks, w.block_id), w.week_index
  LOOP
    SELECT x.days INTO v_days FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) x WHERE x.g = rw.g;
    n := CASE WHEN v_days IS NULL THEN 0 ELSE jsonb_array_length(v_days) END;
    FOR dy IN
      SELECT x.id, x.day_index, x.scheduled_date FROM public.pl_days x
       WHERE x.week_id = rw.id AND coalesce(x.archived, false) = false AND x.deleted_at IS NULL
       ORDER BY x.day_index
    LOOP
      IF public.pl_day_touched(dy.id, dy.scheduled_date, v_today) THEN
        v_kept := v_kept + 1;
        CONTINUE;
      END IF;
      IF rw.g > v_total OR dy.day_index > n THEN
        DELETE FROM public.pl_days WHERE id = dy.id;
        v_removed := v_removed + 1;
        CONTINUE;
      END IF;
      d := v_days -> (dy.day_index - 1);
      UPDATE public.pl_days
         SET title = coalesce(nullif(d->>'title', ''), 'Day ' || dy.day_index),
             focus = nullif(d->>'focus', ''),
             updated_at = now()
       WHERE id = dy.id;
      -- the cardio plan's row stays (program_cardio_sync owns it), after the new exercises
      DELETE FROM public.pl_exercise_rows WHERE day_id = dy.id AND cardio_target_id IS NULL;
      s := public.athlete_program_insert_rows(dy.id, d->'exercises');
      UPDATE public.pl_exercise_rows SET sort_order = s WHERE day_id = dy.id AND cardio_target_id IS NOT NULL;
      v_updated := v_updated + 1;
    END LOOP;

    IF rw.g <= v_total THEN
      -- workouts the week gained, in a week that isn't over yet
      v_wend := coalesce(rw.end_date, v_start + rw.g * 7 - 1);
      IF v_wend >= v_today THEN
        FOR i IN 1..n LOOP
          CONTINUE WHEN EXISTS (SELECT 1 FROM public.pl_days x
                                 WHERE x.week_id = rw.id AND x.day_index = i
                                   AND coalesce(x.archived, false) = false AND x.deleted_at IS NULL);
          d := v_days -> (i - 1);
          INSERT INTO public.pl_days (week_id, day_index, title, focus, scheduled_date, schedule_source)
          VALUES (rw.id, i, coalesce(nullif(d->>'title', ''), 'Day ' || i), nullif(d->>'focus', ''),
                  greatest(coalesce(rw.start_date, v_start + (rw.g - 1) * 7) + public.pl_week_day_offset(i, n), v_today),
                  'builder_assignment')
          RETURNING id INTO v_day;
          PERFORM public.athlete_program_insert_rows(v_day, d->'exercises');
          v_added := v_added + 1;
        END LOOP;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.pl_days x WHERE x.week_id = rw.id) THEN
      -- a week past the program's new length with nothing left in it
      DELETE FROM public.pl_weeks WHERE id = rw.id;
    END IF;
  END LOOP;

  -- each block's length, dates and name (several blocks: the plan block its first week falls in)
  FOREACH v_bid IN ARRAY v_blocks LOOP
    UPDATE public.pl_blocks b
       SET weeks = greatest(coalesce(x.cnt, 1), 1),
           start_date = coalesce(x.first_start, b.start_date),
           end_date = coalesce(x.last_end, b.end_date),
           name = CASE WHEN array_length(v_blocks, 1) = 1 THEN p.title ELSE coalesce(x.plan_block, b.name) END,
           goal = coalesce(p.goal, b.goal),
           updated_at = now()
      FROM (SELECT count(*) AS cnt, min(w.start_date) AS first_start, max(w.end_date) AS last_end,
                   (SELECT y.block_name FROM public.athlete_program_weeks(p.plan, p.days, p.weeks, p.title) y
                     WHERE y.g = (SELECT count(*) + 1 FROM public.pl_weeks w2
                                   WHERE w2.block_id = ANY (v_blocks)
                                     AND coalesce(w2.archived, false) = false AND w2.deleted_at IS NULL
                                     AND (array_position(v_blocks, w2.block_id) < array_position(v_blocks, v_bid)))) AS plan_block
              FROM public.pl_weeks w
             WHERE w.block_id = v_bid AND coalesce(w.archived, false) = false AND w.deleted_at IS NULL) x
     WHERE b.id = v_bid;
  END LOOP;
  IF v_prep IS NOT NULL THEN
    UPDATE public.pl_preps pr
       SET title = p.title,
           total_weeks = v_total,
           end_date = (SELECT max(b.end_date) FROM public.pl_blocks b WHERE b.id = ANY (v_blocks)),
           updated_at = now()
     WHERE pr.id = v_prep AND pr.created_by = v_uid;
  END IF;

  RETURN jsonb_build_object('block_id', v_blocks[1], 'client_id', v_client, 'updated', v_updated, 'added', v_added,
                            'removed', v_removed, 'kept', v_kept, 'days_per_week', v_per);
END;
$$;
REVOKE ALL ON FUNCTION public.athlete_program_sync_running(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athlete_program_sync_running(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. A merged duplicate exercise moves out of plans too
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_exercise_merge_athlete_programs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.duplicate_id IS NULL OR NEW.canonical_id IS NULL OR NEW.duplicate_id = NEW.canonical_id THEN
    RETURN NEW;
  END IF;
  UPDATE public.athlete_programs
     SET days = replace(days::text, NEW.duplicate_id::text, NEW.canonical_id::text)::jsonb
   WHERE days @> jsonb_build_array(jsonb_build_object('exercises',
           jsonb_build_array(jsonb_build_object('exercise_id', NEW.duplicate_id::text))));
  UPDATE public.athlete_programs
     SET plan = replace(plan::text, NEW.duplicate_id::text, NEW.canonical_id::text)::jsonb
   WHERE plan IS NOT NULL AND plan::text LIKE '%' || NEW.duplicate_id::text || '%';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_exercise_merge_athlete_programs() FROM PUBLIC, anon, authenticated;
