-- Exercise library normalization, round 2.
--
--   1. exercises.movement_family  squat | bench | deadlift | accessory
--      One colour per family everywhere (yellow / blue / green / red). It is
--      the MOVEMENT, not the muscles it trains: Leg Curl is accessory, Pause
--      Squat is squat. Defaults are derived once, then coach-editable.
--   2. Canonical names + aliases for the powerlifting lifts and the
--      program-created variants that only differed by prescription detail
--      ("2-Count Pause Squat", "3-0-0 Tempo Squat", 'Spoto Press 1"').
--   3. Safe consolidation. Nothing is deleted: every reference is remapped by
--      merge_duplicate_exercise (set logs, maxes, notes, swaps, prefs,
--      favourites, warm-ups, templates), the duplicate is archived and its old
--      name is kept as an alias. Pause lengths / tempos that lived only in the
--      old exercise name are moved onto the affected prescription rows so the
--      programmed intent is unchanged.
--   4. Program rows that only carry a typed name are linked to the library
--      exercise the same name already points to in the coach's own programs
--      (>=3 linked rows and >=80% agreement), never by guess.
--   5. The duplicate guard now also catches word-order / plural / DB-BB
--      equivalents, and resolve_exercise_id() understands them.
--
-- Not touched: prescriptions (sets/reps/loads), logged results, PR/max rows
-- (their `lift` text only exists for the three Competition lifts), completed
-- workouts, pl_exercise_rows.movement_family (analytics override) and
-- pl_exercise_rows.card_color (unused on every row; colour is now derived).

-- ---------------------------------------------------------------------------
-- 1. Movement family
-- ---------------------------------------------------------------------------
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS movement_family text;
ALTER TABLE public.exercises DROP CONSTRAINT IF EXISTS exercises_movement_family_check;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_movement_family_check
  CHECK (movement_family IS NULL OR movement_family IN ('squat','bench','deadlift','accessory'));

CREATE OR REPLACE FUNCTION public.exercise_movement_family_for(
  _name text, _competition_lift_type text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  n text := ' ' || btrim(regexp_replace(lower(coalesce(_name,'')), '[^a-z0-9]+', ' ', 'g')) || ' ';
BEGIN
  IF _competition_lift_type IN ('squat','bench','deadlift') THEN RETURN _competition_lift_type; END IF;

  -- SQUAT: a bilateral squat movement. Lunges / split squats / step-ups, jumps,
  -- isometric holds, lateral + single-leg patterns and squat hybrids are accessories.
  IF n ~ ' squats? ' AND n !~ (
       ' (split|bulgarian|lunges?|step ?ups?|jump(s|ing)?|pistol|sissy|skater|cossack|curtsy|curtsey|lateral|side|'
    || 'single leg|one leg|pulses?|reach|burpees?|punch(es)?|clap|med ball|ski|ergometer|chops?|'
    || 'overhead squat|calf|stretch|thrusters?|suitcase|kneeling|jefferson|spanish|plate squat|wall|cage|'
    || 'heels? touch|side kick|in and out|ball|press|row|curl|raise|to (front|side)|balance|suspension|'
    || 'good morning|hip thrust) '
  ) THEN RETURN 'squat'; END IF;
  IF n ~ ' (hack|pendulum|belt) squats? ' AND n !~ ' (calf|landmine press) ' THEN RETURN 'squat'; END IF;

  -- BENCH: barbell / dumbbell bench-press movements. Machine, cable and smith
  -- chest presses, flyes, dips, push-ups and triceps work are accessories.
  IF n ~ (' (bench press(es)?|larsen|spoto|spotto|tng|touch and go|floor press|slingshot|dead bench|pin press|'
       || 'board press|close grip bench|cgbp|incline (barbell |dumbbell |bench )?press|decline (barbell |dumbbell )?bench) ')
     AND n !~ (' (machine|cable|smith|svend|squeeze|landmine|push ?ups?|fly|flyes?|flies|dips?|rows?|extensions?|'
       || 'curls?|raises?|pullovers?|shoulders? press|seated press|overhead|jm|hex|guillotine|stretch|step ?ups?|'
       || 'hamstring|leg curl|sit ?ups?) ')
  THEN RETURN 'bench'; END IF;

  -- DEADLIFT: conventional / sumo / trap-bar / RDL-type hinges and pulls from the
  -- floor. Single-leg, staggered, high-pull, clean/snatch and good-morning work is accessory.
  IF n ~ ' (deadlifts?|romanian|rdls?|stiff leg|rack pulls?|block pulls?) '
     AND n !~ (' (single|one|staggered|b stance|high pull|clean|snatch deadlift|good mornings?|stretch|'
       || 'kettlebell|reverse|pinch) ')
  THEN RETURN 'deadlift'; END IF;

  RETURN 'accessory';
END
$$;

CREATE OR REPLACE FUNCTION public.exercises_movement_family_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF btrim(coalesce(NEW.movement_family, '')) = '' THEN
    NEW.movement_family := public.exercise_movement_family_for(NEW.name, NEW.competition_lift_type);
  ELSE
    NEW.movement_family := lower(btrim(NEW.movement_family));
  END IF;
  -- A competition lift is always its own family.
  IF NEW.competition_lift_type IN ('squat','bench','deadlift') THEN
    NEW.movement_family := NEW.competition_lift_type;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS exercises_movement_family_default_trg ON public.exercises;
CREATE TRIGGER exercises_movement_family_default_trg
BEFORE INSERT OR UPDATE OF name, competition_lift_type, movement_family ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.exercises_movement_family_default();

-- ---------------------------------------------------------------------------
-- 2. Order/plural-insensitive identity (mirrors duplicateKey() in the app)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exercise_dup_key(_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  n text := btrim(regexp_replace(lower(coalesce(_name,'')), '[^a-z0-9]+', ' ', 'g'));
  words text[]; w text; toks text[] := '{}'; i int; dir text := '';
BEGIN
  IF n = '' THEN RETURN ''; END IF;
  words := string_to_array(n, ' ');
  FOREACH w IN ARRAY words LOOP
    w := CASE w
      WHEN 'db' THEN 'dumbbell' WHEN 'dbs' THEN 'dumbbell' WHEN 'dumbell' THEN 'dumbbell'
      WHEN 'dumbbells' THEN 'dumbbell' WHEN 'bb' THEN 'barbell' WHEN 'barbells' THEN 'barbell'
      WHEN 'comp' THEN 'competition' ELSE w END;
    CONTINUE WHEN w IN ('the','a','with','on','of','and','version','v2','2','to');
    toks := toks || regexp_replace(w, '(?<=[a-z]{3})s$', '');
  END LOOP;
  -- Direction stays significant: "high to low" is not "low to high".
  i := array_position(words, 'to');
  IF i IS NOT NULL AND i > 1 AND i < array_length(words, 1) THEN
    dir := '|' || words[i - 1] || '>' || words[i + 1];
  END IF;
  RETURN coalesce((SELECT string_agg(DISTINCT t, ' ' ORDER BY t) FROM unnest(toks) t), '') || dir;
END
$$;
CREATE INDEX IF NOT EXISTS idx_exercises_dup_key ON public.exercises (public.exercise_dup_key(name)) WHERE NOT archived;

-- ---------------------------------------------------------------------------
-- 3. Canonicalization helpers (dropped again at the end of this migration)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._canon_alias(_exercise uuid, _alias text, _source text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE akey text := public.pl_norm_exercise_name(_alias);
BEGIN
  IF akey = '' THEN RETURN; END IF;
  -- Never an alias of its own name, never shadow a different live exercise,
  -- never hijack an alias that already belongs to another live exercise.
  IF EXISTS (SELECT 1 FROM public.exercises e WHERE e.id = _exercise AND public.pl_norm_exercise_name(e.name) = akey) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.exercises e WHERE e.id <> _exercise AND NOT e.archived AND public.pl_norm_exercise_name(e.name) = akey) THEN
    RAISE NOTICE 'alias "%" skipped: it is its own live exercise', _alias; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.exercise_aliases a JOIN public.exercises e ON e.id = a.exercise_id
              WHERE a.alias_key = akey AND a.exercise_id <> _exercise AND NOT e.archived) THEN
    RAISE NOTICE 'alias "%" skipped: already belongs to another exercise', _alias; RETURN;
  END IF;
  INSERT INTO public.exercise_aliases(alias_key, alias_name, exercise_id, source)
  VALUES (akey, btrim(_alias), _exercise, _source)
  ON CONFLICT (alias_key) DO UPDATE SET exercise_id = EXCLUDED.exercise_id, alias_name = EXCLUDED.alias_name;
END
$$;

-- Prescription detail that used to live in an exercise NAME belongs on the rows.
CREATE OR REPLACE FUNCTION public._canon_row_detail(_exercise uuid, _spec jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_note  text := nullif(btrim(coalesce(_spec->>'note', '')), '');
  v_tempo text := nullif(btrim(coalesce(_spec->>'tempo', '')), '');
BEGIN
  IF v_note IS NOT NULL THEN
    UPDATE public.pl_exercise_rows r
       SET notes = CASE WHEN r.notes IS NULL OR btrim(r.notes) = '' THEN v_note ELSE r.notes || E'\n' || v_note END
     WHERE r.exercise_id = _exercise
       AND (r.notes IS NULL OR position(lower(v_note) IN lower(r.notes)) = 0);
  END IF;
  IF v_tempo IS NOT NULL THEN
    UPDATE public.pl_exercise_rows r SET tempo = v_tempo
     WHERE r.exercise_id = _exercise AND (r.tempo IS NULL OR btrim(r.tempo) = '');
  END IF;
END
$$;

-- _keep      candidate canonical names, best first (the one with the demo video)
-- _new_name  the standardized display name (NULL = keep)
-- _keep_detail  {note,tempo} added to the canonical's own rows before it is renamed
-- _dups      [{name, note?, tempo?}] same-movement entries merged in
-- _aliases   extra names that must keep resolving to the canonical
CREATE OR REPLACE FUNCTION public._canonize_exercise(
  _keep text[], _new_name text, _keep_detail jsonb, _dups jsonb, _aliases text[])
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE can public.exercises; dup public.exercises; spec jsonb; old_name text; a text;
BEGIN
  SELECT e.* INTO can FROM public.exercises e
   WHERE NOT e.archived AND e.name = ANY(_keep)
   ORDER BY array_position(_keep, e.name) LIMIT 1;
  IF can.id IS NULL THEN RAISE NOTICE 'canonize: none of % found - skipped', _keep; RETURN; END IF;

  IF _keep_detail IS NOT NULL THEN PERFORM public._canon_row_detail(can.id, _keep_detail); END IF;

  FOR spec IN SELECT * FROM jsonb_array_elements(coalesce(_dups, '[]'::jsonb)) LOOP
    SELECT e.* INTO dup FROM public.exercises e
     WHERE NOT e.archived AND e.name = spec->>'name' AND e.id <> can.id LIMIT 1;
    CONTINUE WHEN dup.id IS NULL;
    PERFORM public._canon_row_detail(dup.id, spec);
    DELETE FROM public.exercise_aliases
     WHERE exercise_id = dup.id AND alias_key = public.pl_norm_exercise_name(can.name);
    UPDATE public.exercise_aliases SET exercise_id = can.id WHERE exercise_id = dup.id;
    -- Keep the better demo: a working Vimeo beats a non-working/missing one.
    IF NOT can.vimeo_working AND dup.vimeo_working AND coalesce(dup.vimeo_embed_url, dup.video_url) IS NOT NULL THEN
      UPDATE public.exercises SET
        video_provider = dup.video_provider, video_url = dup.video_url, youtube_url = dup.youtube_url,
        vimeo_video_id = dup.vimeo_video_id, vimeo_url = dup.vimeo_url, vimeo_embed_url = dup.vimeo_embed_url,
        thumbnail_url = coalesce(dup.thumbnail_url, can.thumbnail_url), vimeo_working = dup.vimeo_working,
        video_migration_status = dup.video_migration_status
      WHERE id = can.id;
    END IF;
    PERFORM public.merge_duplicate_exercise(dup.id, can.id,
      'canonical naming: same movement; prescription detail moved to row notes/tempo');
    SELECT e.* INTO can FROM public.exercises e WHERE e.id = can.id;
  END LOOP;

  IF _new_name IS NOT NULL AND can.name <> _new_name THEN
    IF EXISTS (SELECT 1 FROM public.exercises o WHERE o.id <> can.id AND NOT o.archived
                AND (public.exercise_identity_name(o.name) = public.exercise_identity_name(_new_name)
                  OR public.exercise_dup_key(o.name) = public.exercise_dup_key(_new_name)))
       OR EXISTS (SELECT 1 FROM public.exercise_aliases x WHERE x.alias_key = public.pl_norm_exercise_name(_new_name)
                   AND x.exercise_id <> can.id) THEN
      RAISE NOTICE 'rename "%" -> "%" skipped: name already taken', can.name, _new_name;
    ELSE
      old_name := can.name;
      DELETE FROM public.exercise_aliases WHERE exercise_id = can.id AND alias_key = public.pl_norm_exercise_name(_new_name);
      UPDATE public.exercises SET name = _new_name WHERE id = can.id;
      PERFORM public._canon_alias(can.id, old_name, 'canonical');
    END IF;
  END IF;

  FOREACH a IN ARRAY coalesce(_aliases, '{}'::text[]) LOOP
    PERFORM public._canon_alias(can.id, a, 'canonical');
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Canonical powerlifting names. The three Competition lifts first.
--    "Conventional Deadlift" is intentionally NOT aliased: whether it is the
--    competition pull depends on the athlete (Competition Deadlift rows are
--    often sumo). Use Library > "Make alias" per case.
-- ---------------------------------------------------------------------------
-- SQUAT
SELECT public._canonize_exercise(ARRAY['Competition Squat'], 'Competition Squat', NULL,
  jsonb_build_array(jsonb_build_object('name','Barbell Low Bar Squat')),
  ARRAY['Comp Squat','Competition Back Squat','Comp Back Squat','Low Bar Squat','Barbell Low Bar Squat']);
SELECT public._canonize_exercise(ARRAY['Pause Squat','Paused Squat'], 'Pause Squat', NULL,
  jsonb_build_array(
    jsonb_build_object('name','2-Count Pause Squat',  'note','2-count pause'),
    jsonb_build_object('name','2-Count Paused Squat', 'note','2-count pause'),
    jsonb_build_object('name','Paused Squat')),
  ARRAY['Pause Back Squat']);
SELECT public._canonize_exercise(ARRAY['3-0-0 Tempo Squat'], 'Tempo Squat',
  jsonb_build_object('tempo','3-0-0'),
  jsonb_build_array(jsonb_build_object('name','3-Second Tempo Squat','note','3-second tempo')),
  ARRAY['Tempo Back Squat']);
SELECT public._canonize_exercise(ARRAY['Safety Squat Bar Squat','Safety Bar Squat'], 'Safety Bar Squat', NULL, NULL,
  ARRAY['SSB Squat','Safety Squat Bar Squat']);
SELECT public._canonize_exercise(ARRAY['Barbell Box Squat','Box Squat'], 'Box Squat', NULL,
  jsonb_build_array(jsonb_build_object('name','Box Squat')), NULL);
SELECT public._canonize_exercise(ARRAY['Hack Squat'], 'Hack Squat', NULL,
  jsonb_build_array(jsonb_build_object('name','Hack Squat Machine Squat')), NULL);

-- BENCH
SELECT public._canonize_exercise(ARRAY['Competition Bench','Competition Bench Press'], 'Competition Bench Press', NULL, NULL,
  ARRAY['Competition Bench','Comp Bench','Comp Bench Press','Competition Barbell Bench Press','Comp Barbell Bench Press']);
SELECT public._canonize_exercise(ARRAY['Paused Bench Press','Pause Bench Press'], 'Pause Bench Press', NULL,
  jsonb_build_array(
    jsonb_build_object('name','2-Count Pause Bench Press','note','2-count pause'),
    jsonb_build_object('name','3-Count Pause Bench Press','note','3-count pause')),
  ARRAY['Pause Bench','Paused Bench','1ct Paused Bench','2ct Paused Bench','3ct Paused Bench']);
SELECT public._canonize_exercise(ARRAY['Barbell Spoto Press','Spoto Press'], 'Spoto Press', NULL,
  jsonb_build_array(
    jsonb_build_object('name','Spoto Press'),
    jsonb_build_object('name','Spoto Press 1"',  'note','1" Spoto'),
    jsonb_build_object('name','Spotto Press 1"', 'note','1" Spoto')),
  ARRAY['Spoto Bench','Spoto Bench Press','Spotto Press']);
SELECT public._canonize_exercise(ARRAY['Touch and Go Bench Press'], 'Touch and Go Bench Press', NULL,
  jsonb_build_array(jsonb_build_object('name','TNG Bench Press')),
  ARRAY['TNG Bench','TNG Bench Press','Touch and Go Bench']);
SELECT public._canonize_exercise(ARRAY['Larsen Press'], 'Larsen Press', NULL,
  jsonb_build_array(jsonb_build_object('name','Barbell Larsen Bench Press')),
  ARRAY['Larsen Bench','Larsen Bench Press']);
SELECT public._canonize_exercise(ARRAY['Close-Grip Bench Press','Close Grip Bench Press'], 'Close Grip Bench Press', NULL,
  jsonb_build_array(jsonb_build_object('name','Close Grip Barbell Bench Press')),
  ARRAY['CGBP','Close Grip Bench','Barbell Close Grip Bench Press']);
SELECT public._canonize_exercise(ARRAY['Barbell Incline Bench Press','Incline Bench Press'], 'Incline Bench Press', NULL,
  jsonb_build_array(jsonb_build_object('name','Barbell Inclined Bench Press')),
  ARRAY['Incline Barbell Bench Press','Incline Bench','Incline Barbell Press']);
SELECT public._canonize_exercise(ARRAY['Incline Bench Press - Dumbbell','Incline Dumbbell Press'], 'Incline Dumbbell Press', NULL,
  jsonb_build_array(jsonb_build_object('name','Incline Dumbbell Press')),
  ARRAY['Incline DB Press','Incline Dumbbell Bench Press','Dumbbell Incline Press','Incline Bench Press - Dumbbell']);

-- DEADLIFT
SELECT public._canonize_exercise(ARRAY['Competition Deadlift'], 'Competition Deadlift', NULL, NULL,
  ARRAY['Comp Deadlift','Competition Conventional Deadlift','Comp Conventional Deadlift']);
SELECT public._canonize_exercise(ARRAY['Pause Deadlifts','Paused Deadlift','Pause Deadlift'], 'Pause Deadlift', NULL,
  jsonb_build_array(
    jsonb_build_object('name','Paused Deadlift'),
    jsonb_build_object('name','Two-Count Paused Deadlift','note','2-count pause'),
    jsonb_build_object('name','2-Count Paused Deadlift',  'note','2-count pause')),
  ARRAY['Paused Deadlift','Pause Deadlifts']);
-- Pausing below the knee is a different position than a generic pause pull; kept separate.
SELECT public._canonize_exercise(ARRAY['Two-Count Paused Conventional Deadlift Below Knee'], 'Pause Deadlift Below Knee',
  jsonb_build_object('note','2-count pause'),
  jsonb_build_array(jsonb_build_object('name','2-Count Paused Deadlift Below Knee','note','2-count pause')), NULL);
SELECT public._canonize_exercise(ARRAY['2-Second Pause-at-Knee Sumo Deadlift'], 'Pause Sumo Deadlift At Knee',
  jsonb_build_object('note','2-second pause'), NULL, NULL);
SELECT public._canonize_exercise(ARRAY['3-0-0 Tempo to Knee Sumo Deadlift'], 'Tempo Sumo Deadlift To Knee',
  jsonb_build_object('tempo','3-0-0'), NULL, NULL);
SELECT public._canonize_exercise(ARRAY['Deficit Conventional Deadlift'], 'Deficit Deadlift', NULL, NULL, NULL);
SELECT public._canonize_exercise(ARRAY['Romanian Deadlift'], 'Romanian Deadlift', NULL,
  jsonb_build_array(jsonb_build_object('name','Barbell Romanian Deadlift')),
  ARRAY['RDL','Barbell RDL','Barbell Romanian Deadlift']);

-- ACCESSORY: unambiguous program-created copies of an existing library movement.
SELECT public._canonize_exercise(ARRAY['Leg Press Machine','Leg Press'], 'Leg Press', NULL,
  jsonb_build_array(jsonb_build_object('name','Leg Press')), ARRAY['Machine Leg Press']);
SELECT public._canonize_exercise(ARRAY['Resistance Band Pull Apart','Band Pull-Apart'], 'Band Pull-Apart', NULL,
  jsonb_build_array(jsonb_build_object('name','Band Pull-Apart')), ARRAY['Band Pull Apart']);

-- Unused wording-only duplicates (word order / plural / typo). Zero programs, zero logs.
SELECT public._canonize_exercise(ARRAY['Barbell Good Morning'], NULL, NULL,
  jsonb_build_array(jsonb_build_object('name','Good Mornings Barbell')), NULL);
SELECT public._canonize_exercise(ARRAY['Kettlebell Sumo Deadlift With High Pull'], NULL, NULL,
  jsonb_build_array(jsonb_build_object('name','Kettlebells Sumo Deadlift With High Pull')), NULL);
SELECT public._canonize_exercise(ARRAY['Back And Shoulder Stretch'], NULL, NULL,
  jsonb_build_array(jsonb_build_object('name','Back And Shoulders Stretch')), NULL);
SELECT public._canonize_exercise(ARRAY['Elbow Back Stretch'], NULL, NULL,
  jsonb_build_array(jsonb_build_object('name','Elbows Back Stretch')), NULL);
SELECT public._canonize_exercise(ARRAY['Degree Heel Touch'], NULL, NULL,
  jsonb_build_array(jsonb_build_object('name','Degree Heels Touch')), NULL);

-- ---------------------------------------------------------------------------
-- 5. Program rows that only carry a typed name -> the library exercise the
--    coach's own programs already point that exact name to (never a guess).
-- ---------------------------------------------------------------------------
DO $evidence$
DECLARE p record;
BEGIN
  FOR p IN
    WITH unl AS (
      SELECT public.pl_norm_exercise_name(exercise_name_override) k, min(exercise_name_override) nm
        FROM public.pl_exercise_rows
       WHERE exercise_id IS NULL AND btrim(coalesce(exercise_name_override, '')) <> ''
       GROUP BY 1),
    ev AS (
      SELECT public.pl_norm_exercise_name(r.exercise_name_override) k, r.exercise_id, count(*) c
        FROM public.pl_exercise_rows r
        JOIN public.exercises e ON e.id = r.exercise_id AND NOT e.archived
       WHERE btrim(coalesce(r.exercise_name_override, '')) <> ''
       GROUP BY 1, 2),
    ranked AS (
      SELECT k, exercise_id, c, sum(c) OVER (PARTITION BY k) total,
             rank() OVER (PARTITION BY k ORDER BY c DESC) rk
        FROM ev)
    SELECT u.nm, ra.exercise_id
      FROM unl u JOIN ranked ra ON ra.k = u.k
     WHERE ra.rk = 1 AND ra.c >= 3 AND ra.c::numeric / ra.total >= 0.8
       AND public.resolve_exercise_id(u.nm) IS NULL
  LOOP
    PERFORM public._canon_alias(p.exercise_id, p.nm, 'usage');
  END LOOP;
END
$evidence$;

-- ---------------------------------------------------------------------------
-- 6. resolve_exercise_id: exact name -> alias -> word-order/plural/DB-BB match
--    (only when that match is unique).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_exercise_id(_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE k text := public.pl_norm_exercise_name(_name); hit uuid; hits int;
BEGIN
  IF k = '' THEN RETURN NULL; END IF;
  SELECT count(*), min(e.id::text)::uuid INTO hits, hit FROM public.exercises e
   WHERE NOT e.archived AND public.pl_norm_exercise_name(e.name) = k;
  IF hits = 1 THEN RETURN hit; END IF;
  SELECT a.exercise_id INTO hit FROM public.exercise_aliases a
    JOIN public.exercises e ON e.id = a.exercise_id AND NOT e.archived
   WHERE a.alias_key = k;
  IF hit IS NOT NULL THEN RETURN hit; END IF;
  SELECT count(*), min(e.id::text)::uuid INTO hits, hit FROM public.exercises e
   WHERE NOT e.archived AND public.exercise_dup_key(e.name) = public.exercise_dup_key(_name)
     AND public.exercise_dup_key(_name) <> '';
  IF hits = 1 THEN RETURN hit; END IF;
  RETURN NULL;
END
$$;
GRANT EXECUTE ON FUNCTION public.resolve_exercise_id(text) TO authenticated;

-- Link every typed-name program row that now resolves. Display names
-- (exercise_name_override) and every prescription field stay untouched.
UPDATE public.pl_exercise_rows r
   SET exercise_id = public.resolve_exercise_id(r.exercise_name_override)
 WHERE r.exercise_id IS NULL
   AND btrim(coalesce(r.exercise_name_override, '')) <> ''
   AND public.resolve_exercise_id(r.exercise_name_override) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Backfill + enforce the family on every exercise (archived too, so history
--    keeps its colour).
-- ---------------------------------------------------------------------------
UPDATE public.exercises SET movement_family = public.exercise_movement_family_for(name, competition_lift_type)
 WHERE movement_family IS NULL;
-- Deliberately no column DEFAULT / NOT NULL: a default would be applied before the
-- BEFORE INSERT trigger and stop it classifying; the trigger fills every insert.
-- App code still treats NULL as "accessory".
CREATE INDEX IF NOT EXISTS exercises_movement_family_idx ON public.exercises (movement_family) WHERE NOT archived;

-- ---------------------------------------------------------------------------
-- 8. Duplicate guard v3: exact identity, alias, AND word-order/plural/DB-BB
--    equivalents. Installed last so the cleanup above is never blocked by it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_duplicate_exercise_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE existing_id uuid;
BEGIN
  IF coalesce(NEW.archived, false) THEN RETURN NEW; END IF;
  SELECT id INTO existing_id FROM public.exercises
   WHERE id IS DISTINCT FROM NEW.id AND coalesce(archived, false) = false
     AND public.exercise_identity_name(name) = public.exercise_identity_name(NEW.name)
   ORDER BY (video_url LIKE '%player.vimeo.com%') DESC, (video_url IS NOT NULL) DESC, created_at ASC NULLS LAST
   LIMIT 1;
  IF existing_id IS NULL THEN
    SELECT a.exercise_id INTO existing_id FROM public.exercise_aliases a
     WHERE a.alias_key = public.pl_norm_exercise_name(NEW.name) AND a.exercise_id IS DISTINCT FROM NEW.id;
  END IF;
  IF existing_id IS NULL AND public.exercise_dup_key(NEW.name) <> '' THEN
    SELECT id INTO existing_id FROM public.exercises
     WHERE id IS DISTINCT FROM NEW.id AND coalesce(archived, false) = false
       AND public.exercise_dup_key(name) = public.exercise_dup_key(NEW.name)
     ORDER BY (video_url IS NOT NULL) DESC, created_at ASC NULLS LAST
     LIMIT 1;
  END IF;
  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Exercise already exists as canonical id %; reuse the existing exercise instead of creating a duplicate.', existing_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- 9. Clean up: helpers must not stay callable through the API.
-- ---------------------------------------------------------------------------
DROP FUNCTION public._canonize_exercise(text[], text, jsonb, jsonb, text[]);
DROP FUNCTION public._canon_row_detail(uuid, jsonb);
DROP FUNCTION public._canon_alias(uuid, text, text);
