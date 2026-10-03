-- Exercise Library integrity: primary/secondary muscle tagging, safe duplicate
-- consolidation, alias-based resolution, and Jared's current-program relink.
--
-- Taxonomy: the existing 18 PRIMARY_MUSCLE_GROUPS labels (src/lib/exercise-taxonomy.ts)
-- keyed 1:1 to the snake_case keys analytics already uses (src/lib/volume.ts):
--   Chest↔chest, Lats↔lats, Upper Back↔upper_back, Traps↔traps,
--   Front/Side/Rear Delts↔front_/side_/rear_delts, Biceps, Triceps, Forearms,
--   Quads, Hamstrings, Glutes, Adductors, Calves, Abs/Core↔core,
--   Lower Back↔lower_back (spinal erectors), Other↔other.
--
-- Columns:
--   primary_muscle_group      legacy single label (kept; = label of muscle_groups[1])
--   muscle_groups             PRIMARY muscles (keys)       → analytics weight 1.0
--   secondary_muscle_groups   SECONDARY muscles (keys, new) → analytics weight 0.5
--
-- Nothing here touches prescriptions (sets, reps, RPE, %, loads, notes, dates).

-- ---------------------------------------------------------------------------
-- 1. Taxonomy helpers
-- ---------------------------------------------------------------------------
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS secondary_muscle_groups text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.muscle_key_from_label(_label text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(coalesce(_label,'')))
    WHEN 'chest' THEN 'chest' WHEN 'lats' THEN 'lats' WHEN 'upper back' THEN 'upper_back'
    WHEN 'traps' THEN 'traps' WHEN 'front delts' THEN 'front_delts' WHEN 'side delts' THEN 'side_delts'
    WHEN 'rear delts' THEN 'rear_delts' WHEN 'biceps' THEN 'biceps' WHEN 'triceps' THEN 'triceps'
    WHEN 'forearms' THEN 'forearms' WHEN 'quads' THEN 'quads' WHEN 'hamstrings' THEN 'hamstrings'
    WHEN 'glutes' THEN 'glutes' WHEN 'adductors' THEN 'adductors' WHEN 'calves' THEN 'calves'
    WHEN 'abs/core' THEN 'core' WHEN 'lower back' THEN 'lower_back' WHEN 'other' THEN 'other'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.muscle_label_from_key(_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _key
    WHEN 'chest' THEN 'Chest' WHEN 'lats' THEN 'Lats' WHEN 'upper_back' THEN 'Upper Back'
    WHEN 'traps' THEN 'Traps' WHEN 'front_delts' THEN 'Front Delts' WHEN 'side_delts' THEN 'Side Delts'
    WHEN 'rear_delts' THEN 'Rear Delts' WHEN 'biceps' THEN 'Biceps' WHEN 'triceps' THEN 'Triceps'
    WHEN 'forearms' THEN 'Forearms' WHEN 'quads' THEN 'Quads' WHEN 'hamstrings' THEN 'Hamstrings'
    WHEN 'glutes' THEN 'Glutes' WHEN 'adductors' THEN 'Adductors' WHEN 'calves' THEN 'Calves'
    WHEN 'core' THEN 'Abs/Core' WHEN 'lower_back' THEN 'Lower Back' WHEN 'other' THEN 'Other'
    ELSE NULL END
$$;

-- ---------------------------------------------------------------------------
-- 2. Movement-based classifier. Tags what is useful for training analytics,
--    not every muscle that technically contributes. matched=false means no
--    movement rule fired and the caller should fall back to the stored label.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exercise_muscle_profile(_name text, _category text DEFAULT NULL)
RETURNS TABLE(primary_muscles text[], secondary_muscles text[], matched boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  n text := ' ' || regexp_replace(lower(coalesce(_name,'')), '[^a-z0-9]+', ' ', 'g') || ' ';
  c text := lower(coalesce(_category,''));
  free_weight_barbell boolean;
BEGIN
  free_weight_barbell := n !~ ' (dumbbells?|db|machine|smith|cable|band|bands|resistance|kettlebell|landmine|plate|suspension) ';

  -- Stretching / mobility / yoga: no strength movement → stored label.
  IF c ~ '(stretch|mobility|yoga)' OR n ~ ' (stretch|stretches|pose|foam roll|circles?|swings?|mobility) ' AND n !~ ' (kettlebell|dumbbell) swing' THEN
    RETURN QUERY SELECT NULL::text[], NULL::text[], false; RETURN;
  END IF;

  IF n ~ ' (kettlebell|dumbbell|kb) (swing|swings) ' THEN RETURN QUERY SELECT '{glutes,hamstrings}'::text[], '{lower_back}'::text[], true; RETURN; END IF;
  IF n ~ ' (snatch|clean|cleans|jerk) ' AND n !~ ' clean grip ' THEN
    IF n ~ ' (jerk|press) ' THEN RETURN QUERY SELECT '{quads,glutes,front_delts}'::text[], '{triceps,traps}'::text[], true; RETURN; END IF;
    RETURN QUERY SELECT '{glutes,hamstrings,quads}'::text[], '{traps,upper_back}'::text[], true; RETURN;
  END IF;
  IF n ~ ' thrusters? ' THEN RETURN QUERY SELECT '{quads,glutes,front_delts}'::text[], '{triceps,core}'::text[], true; RETURN; END IF;

  -- Delts / traps
  IF n ~ '( rear delt| rear lateral| reverse (pec|fly|flye|flyes|machine fly)| face ?pulls?| facepull| pull ?aparts?| rear fly| prone [ytw] | bent over (reverse|lateral) raise)' THEN
    RETURN QUERY SELECT '{rear_delts}'::text[], '{upper_back}'::text[], true; RETURN; END IF;
  IF n ~ ' upright rows? ' THEN RETURN QUERY SELECT '{side_delts}'::text[], '{traps}'::text[], true; RETURN; END IF;
  IF n ~ ' (lateral|side|y) raises? ' THEN RETURN QUERY SELECT '{side_delts}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' front raises? ' THEN RETURN QUERY SELECT '{front_delts}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' shrugs? ' THEN RETURN QUERY SELECT '{traps}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' (farmer|farmers|farmer s|suitcase) (carry|walk|walks|carries) ' THEN RETURN QUERY SELECT '{traps,forearms}'::text[], '{core}'::text[], true; RETURN; END IF;

  -- Lower legs first so "Leg Press Calf Raise" / "Hack Squat Calf Raise" are calves.
  IF n ~ ' (calf|calve|calves|tibialis) ' THEN RETURN QUERY SELECT '{calves}'::text[], '{}'::text[], true; RETURN; END IF;

  -- Hinges
  IF n ~ ' glute (hyperextension|hyper|back extension) ' THEN RETURN QUERY SELECT '{glutes}'::text[], '{hamstrings,lower_back}'::text[], true; RETURN; END IF;
  IF n ~ ' (back extensions?|hyperextensions?|reverse hyper|reverse hyperextension) ' THEN
    RETURN QUERY SELECT '{lower_back,glutes}'::text[], '{hamstrings}'::text[], true; RETURN; END IF;
  IF n ~ ' good mornings? ' THEN RETURN QUERY SELECT '{hamstrings,lower_back}'::text[], '{glutes}'::text[], true; RETURN; END IF;
  IF n ~ ' (romanian|rdl|rdls|stiff leg|stiff legged|sldl|single leg deadlift|one leg deadlift) ' THEN
    RETURN QUERY SELECT '{hamstrings,glutes}'::text[], '{lower_back}'::text[], true; RETURN; END IF;
  IF n ~ ' sumo deadlifts? ' THEN RETURN QUERY SELECT '{glutes,adductors,quads}'::text[], '{hamstrings,lower_back,upper_back}'::text[], true; RETURN; END IF;
  IF n ~ ' (trap|hex) bar deadlifts? ' THEN RETURN QUERY SELECT '{quads,glutes}'::text[], '{hamstrings,lower_back,traps}'::text[], true; RETURN; END IF;
  IF n ~ ' (rack|block) pulls? ' THEN RETURN QUERY SELECT '{glutes,lower_back,traps}'::text[], '{hamstrings,upper_back,forearms}'::text[], true; RETURN; END IF;
  IF n ~ ' deadlifts? ' THEN RETURN QUERY SELECT '{glutes,hamstrings,lower_back}'::text[], '{lats,upper_back,traps,forearms}'::text[], true; RETURN; END IF;
  IF n ~ ' (hip thrusts?|glute bridges?|hip bridges?|frog pumps?) ' THEN RETURN QUERY SELECT '{glutes}'::text[], '{hamstrings}'::text[], true; RETURN; END IF;
  IF n ~ ' (pull through|pullthrough|pull throughs) ' THEN RETURN QUERY SELECT '{glutes}'::text[], '{hamstrings}'::text[], true; RETURN; END IF;

  -- Knee flexion / extension, hip ad/abduction
  IF n ~ ' (leg curls?|hamstring curls?|ham curls?|nordic|nordics|glute ham|ghr) ' THEN
    RETURN QUERY SELECT '{hamstrings}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' (leg extensions?|leg ext|sissy squats?) ' THEN RETURN QUERY SELECT '{quads}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' (adduction|adductors?|copenhagen|inner thigh) ' THEN RETURN QUERY SELECT '{adductors}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' (abduction|abductors?|clams?|clamshells?|fire hydrants?|glute kickbacks?|cable kickbacks?|donkey kicks?|band walks?|monster walks?|rear kick) '
     OR (n ~ ' glutes? ' AND n !~ ' (squat|lunge|press) ') THEN
    RETURN QUERY SELECT '{glutes}'::text[], '{}'::text[], true; RETURN; END IF;

  -- Jumps / plyometrics
  IF n ~ ' (jumps?|jumping|bounds?|hops?|plyo) ' AND n !~ ' rope ' THEN
    RETURN QUERY SELECT '{quads,glutes}'::text[], '{calves}'::text[], true; RETURN; END IF;

  -- Squat pattern
  IF n ~ ' (hack squat|pendulum squat) ' THEN RETURN QUERY SELECT '{quads}'::text[], '{glutes}'::text[], true; RETURN; END IF;
  IF n ~ ' leg press ' THEN RETURN QUERY SELECT '{quads,glutes}'::text[], '{adductors}'::text[], true; RETURN; END IF;
  IF n ~ ' belt squats? ' THEN RETURN QUERY SELECT '{quads,glutes}'::text[], '{adductors}'::text[], true; RETURN; END IF;
  IF n ~ ' (split squats?|bulgarian|lunges?|lunge|step ?ups?|pistol|single leg squats?|skater squats?) ' THEN
    RETURN QUERY SELECT '{quads,glutes}'::text[], '{adductors}'::text[], true; RETURN; END IF;
  IF n ~ ' (front squats?|zercher|goblet) ' THEN RETURN QUERY SELECT '{quads,glutes}'::text[], '{upper_back,core}'::text[], true; RETURN; END IF;
  IF n ~ ' (safety squat bar|safety bar|ssb) ' THEN
    RETURN QUERY SELECT '{quads,glutes,adductors}'::text[], '{upper_back,lower_back,core}'::text[], true; RETURN; END IF;
  IF n ~ ' (wall sit|wall squat) ' THEN RETURN QUERY SELECT '{quads}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' squats? ' THEN
    IF n ~ ' (bodyweight|air|prisoner|smith) ' THEN RETURN QUERY SELECT '{quads,glutes}'::text[], '{adductors}'::text[], true; RETURN; END IF;
    RETURN QUERY SELECT '{quads,glutes,adductors}'::text[], '{lower_back,core}'::text[], true; RETURN;
  END IF;

  -- Arms
  IF n ~ ' (wrist|wrists|finger|fingers|gripper|grip trainer|plate pinch|forearms?) ' THEN RETURN QUERY SELECT '{forearms}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' (hammer curls?|reverse curls?|reverse grip curls?|reverse biceps curls?|zottman) '
     OR (n ~ ' hammer ' AND n ~ ' curls? ' AND n !~ ' leg ') THEN
    RETURN QUERY SELECT '{biceps}'::text[], '{forearms}'::text[], true; RETURN; END IF;
  IF n ~ ' (curls?|biceps?|preacher|bayesian) ' AND n !~ ' (leg|legs|hamstring|jefferson) curl' THEN
    RETURN QUERY SELECT '{biceps}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' chest dips? ' THEN RETURN QUERY SELECT '{chest}'::text[], '{triceps,front_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' dips? ' THEN RETURN QUERY SELECT '{triceps}'::text[], '{chest,front_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' (triceps?|push ?downs?|pushdowns?|press ?downs?|pressdowns?|skull ?crushers?|skullcrushers?|kickbacks?|french press|tate press|jm press) '
     OR n ~ ' (overhead|lying) .*extensions? ' THEN
    RETURN QUERY SELECT '{triceps}'::text[], '{}'::text[], true; RETURN; END IF;

  -- Pulls
  IF n ~ ' (pullovers?|pull overs?|straight arm) ' THEN RETURN QUERY SELECT '{lats}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' (pull ?ups?|pullups?|chin ?ups?|chinups?|pull ?downs?|pulldowns?|lat pull|muscle ?ups?) ' THEN
    RETURN QUERY SELECT '{lats}'::text[], '{biceps,upper_back}'::text[], true; RETURN; END IF;
  IF n ~ ' (rows?|pendlay|t bar|tbar|meadows|kroc|seal row) ' THEN
    IF n ~ ' (bent over|pendlay|barbell row|bb row|yates) ' AND free_weight_barbell THEN
      RETURN QUERY SELECT '{upper_back,lats}'::text[], '{biceps,rear_delts,lower_back}'::text[], true; RETURN; END IF;
    RETURN QUERY SELECT '{upper_back,lats}'::text[], '{biceps,rear_delts}'::text[], true; RETURN;
  END IF;

  -- Presses
  IF n ~ ' (close grip bench|close grip barbell bench|cgbp|close grip press|close grip floor press) ' THEN
    RETURN QUERY SELECT '{triceps,chest}'::text[], '{front_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' floor press ' THEN RETURN QUERY SELECT '{chest,triceps}'::text[], '{front_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' incline ' AND n ~ ' (press|bench) ' THEN RETURN QUERY SELECT '{chest,front_delts}'::text[], '{triceps}'::text[], true; RETURN; END IF;
  IF n ~ ' decline ' AND n ~ ' (press|bench) ' THEN RETURN QUERY SELECT '{chest,triceps}'::text[], '{front_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' (bench press|bench presses|larsen|spoto|spotto|pin press|board press|competition bench|paused bench|pause bench|tempo bench|touch and go) '
     OR n ~ ' bench $' OR (n ~ ' bench ' AND n ~ ' press ') THEN
    IF free_weight_barbell THEN RETURN QUERY SELECT '{chest,triceps,front_delts}'::text[], '{upper_back}'::text[], true; RETURN; END IF;
    RETURN QUERY SELECT '{chest,triceps,front_delts}'::text[], '{}'::text[], true; RETURN;
  END IF;
  IF n ~ ' (chest press|hex press|squeeze press|svend|guillotine) ' THEN RETURN QUERY SELECT '{chest}'::text[], '{triceps,front_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' (push ?ups?|pushups?) ' THEN
    IF n ~ ' (diamond|close grip|narrow) ' THEN RETURN QUERY SELECT '{triceps,chest}'::text[], '{front_delts}'::text[], true; RETURN; END IF;
    IF n ~ ' (pike|handstand) ' THEN RETURN QUERY SELECT '{front_delts,triceps}'::text[], '{side_delts}'::text[], true; RETURN; END IF;
    RETURN QUERY SELECT '{chest}'::text[], '{triceps,front_delts}'::text[], true; RETURN;
  END IF;
  IF n ~ ' (fly|flys|flye|flyes|flies|pec deck|crossovers?|cable machine high to low|cable machine low to high) ' THEN
    RETURN QUERY SELECT '{chest}'::text[], '{}'::text[], true; RETURN; END IF;
  IF n ~ ' (overhead press|ohp|military|shoulders? press|push press|arnold|z press|landmine press|behind neck press|seated press|standing press|handstand) '
     OR (n ~ ' press ' AND n ~ ' (dumbbells?|kettlebell|barbell|band) ' AND n ~ ' (seated|standing|alternate|alternating|single arm|one arm|palms in) ') THEN
    RETURN QUERY SELECT '{front_delts,triceps}'::text[], '{side_delts}'::text[], true; RETURN; END IF;

  -- Shoulder health / accessory patterns that the main rules miss
  IF n ~ ' (external rotations?|internal rotations?|external shoulder rotation|external rotatio|cuban press|t raises?|ytw|swimmers?) ' THEN
    RETURN QUERY SELECT '{rear_delts}'::text[], '{upper_back}'::text[], true; RETURN; END IF;
  IF n ~ ' (scapular retraction|scap retraction|back squeeze) ' THEN RETURN QUERY SELECT '{upper_back}'::text[], '{rear_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' (scott press|w press|seesaw press|anti gravity press|shoulder pres|press under|single arm press) ' THEN
    RETURN QUERY SELECT '{front_delts,triceps}'::text[], '{side_delts}'::text[], true; RETURN; END IF;
  IF n ~ ' (side lying leg lift|side kick|hip extension|rear kick|leg half circle) ' THEN RETURN QUERY SELECT '{glutes}'::text[], '{}'::text[], true; RETURN; END IF;

  -- Trunk
  IF n ~ ' (crunch|crunches|sit ?ups?|situps?|leg raises?|knee raises?|knee tucks?|ab wheel|rollouts?|roll outs?|planks?|pallof|wood ?chops?|woodchops?|dead ?bugs?|bird dogs?|russian twists?|hollow|v ups?|toes to bar|obliques?|side bends?|mountain climbers?|flutter kicks?|abs?|core|l sit|dragon flag|windshield wipers?|jackknife) ' THEN
    RETURN QUERY SELECT '{core}'::text[], '{}'::text[], true; RETURN; END IF;

  RETURN QUERY SELECT NULL::text[], NULL::text[], false;
END;
$$;

-- Derive the stored tag set for one exercise (movement rule, else legacy label).
CREATE OR REPLACE FUNCTION public.exercise_derived_muscles(_name text, _category text, _primary_label text,
  OUT primary_muscles text[], OUT secondary_muscles text[], OUT matched boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.exercise_muscle_profile(_name, _category);
  IF r.matched THEN
    primary_muscles := r.primary_muscles; secondary_muscles := r.secondary_muscles; matched := true;
  ELSE
    primary_muscles := ARRAY[coalesce(public.muscle_key_from_label(_primary_label), 'other')];
    secondary_muscles := '{}'; matched := false;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Validation: every active exercise carries valid primary muscle keys.
--    Empty tags are derived automatically; invalid keys are rejected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exercises_muscle_tags()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  d record;
  allowed constant text[] := ARRAY['chest','upper_back','lats','traps','front_delts','side_delts','rear_delts',
    'biceps','triceps','forearms','quads','hamstrings','glutes','adductors','calves','core','lower_back','other'];
  bad text;
  label_key text;
BEGIN
  -- Normalize keys but keep the author's order: muscle_groups[1] is the main muscle.
  NEW.muscle_groups := ARRAY(SELECT k FROM (
      SELECT regexp_replace(lower(btrim(m)), '[^a-z]+', '_', 'g') k, min(ord) o
        FROM unnest(coalesce(NEW.muscle_groups,'{}')) WITH ORDINALITY u(m, ord) GROUP BY 1
    ) x WHERE k <> '' ORDER BY o);
  NEW.secondary_muscle_groups := ARRAY(SELECT DISTINCT k FROM (
      SELECT regexp_replace(lower(btrim(m)), '[^a-z]+', '_', 'g') k FROM unnest(coalesce(NEW.secondary_muscle_groups,'{}')) m
    ) x WHERE k <> '');

  IF cardinality(NEW.muscle_groups) = 0 THEN
    d := public.exercise_derived_muscles(NEW.name, NEW.category, NEW.primary_muscle_group);
    NEW.muscle_groups := d.primary_muscles;
    IF cardinality(NEW.secondary_muscle_groups) = 0 THEN NEW.secondary_muscle_groups := d.secondary_muscles; END IF;
    IF d.matched AND coalesce(NEW.primary_muscle_group,'Other') = 'Other' THEN
      NEW.primary_muscle_group := public.muscle_label_from_key(d.primary_muscles[1]);
      NEW.needs_muscle_review := false;
    END IF;
  END IF;

  -- The legacy single label must always be one of the primaries.
  label_key := public.muscle_key_from_label(NEW.primary_muscle_group);
  IF label_key IS NOT NULL AND label_key <> 'other' AND NOT (label_key = ANY(NEW.muscle_groups)) THEN
    IF TG_OP = 'UPDATE' AND NEW.primary_muscle_group IS DISTINCT FROM OLD.primary_muscle_group THEN
      NEW.muscle_groups := array_prepend(label_key, array_remove(NEW.muscle_groups, 'other'));
    ELSE
      NEW.primary_muscle_group := public.muscle_label_from_key(NEW.muscle_groups[1]);
    END IF;
  ELSIF (label_key IS NULL OR label_key = 'other') AND NEW.muscle_groups[1] IS DISTINCT FROM 'other' THEN
    NEW.primary_muscle_group := public.muscle_label_from_key(NEW.muscle_groups[1]);
  END IF;
  IF cardinality(NEW.muscle_groups) > 1 THEN NEW.muscle_groups := array_remove(NEW.muscle_groups, 'other'); END IF;

  NEW.secondary_muscle_groups := ARRAY(SELECT m FROM unnest(NEW.secondary_muscle_groups) m
    WHERE m <> 'other' AND NOT (m = ANY(NEW.muscle_groups)) ORDER BY array_position(allowed, m));

  SELECT m INTO bad FROM unnest(NEW.muscle_groups || NEW.secondary_muscle_groups) m WHERE NOT (m = ANY(allowed)) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown muscle group "%". Use one of: %', bad, array_to_string(allowed, ', ') USING ERRCODE = '23514';
  END IF;
  IF NOT coalesce(NEW.archived,false) AND cardinality(NEW.muscle_groups) = 0 THEN
    RAISE EXCEPTION 'Exercise "%" needs at least one primary muscle group.', NEW.name USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Runs after exercises_autoclassify_trg (alphabetical) so the legacy label is set first.
DROP TRIGGER IF EXISTS exercises_muscle_tags_trg ON public.exercises;
CREATE TRIGGER exercises_muscle_tags_trg
BEFORE INSERT OR UPDATE OF name, category, primary_muscle_group, muscle_groups, secondary_muscle_groups, archived
ON public.exercises FOR EACH ROW EXECUTE FUNCTION public.exercises_muscle_tags();

-- ---------------------------------------------------------------------------
-- 4. Backfill every exercise (archived ones too, so history stays tagged).
--    Movement rules win over the old single-label guess (e.g. Safety Squat Bar
--    Squat was "Upper Back", Larsen Press "Front Delts", Spoto Press "Other").
-- ---------------------------------------------------------------------------
UPDATE public.exercises e SET
  muscle_groups = d.primary_muscles,
  secondary_muscle_groups = d.secondary_muscles,
  primary_muscle_group = CASE WHEN d.matched THEN public.muscle_label_from_key(d.primary_muscles[1]) ELSE e.primary_muscle_group END,
  needs_muscle_review = CASE WHEN d.matched THEN false ELSE e.needs_muscle_review END
FROM (SELECT x.id, (public.exercise_derived_muscles(x.name, x.category, x.primary_muscle_group)).* FROM public.exercises x) d
WHERE d.id = e.id AND cardinality(e.muscle_groups) = 0;  -- never overwrite coach-entered tags

-- ---------------------------------------------------------------------------
-- 5. Aliases: names that must resolve to an existing canonical exercise.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exercise_aliases (
  alias_key text PRIMARY KEY,
  alias_name text NOT NULL,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exercise_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "All auth read exercise aliases" ON public.exercise_aliases;
CREATE POLICY "All auth read exercise aliases" ON public.exercise_aliases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin manage exercise aliases" ON public.exercise_aliases;
CREATE POLICY "Admin manage exercise aliases" ON public.exercise_aliases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.exercise_dedupe_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin read exercise dedupe audit" ON public.exercise_dedupe_audit;
CREATE POLICY "Admin read exercise dedupe audit" ON public.exercise_dedupe_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- One resolver for every create/import/assign path: exact active name first,
-- then an alias. Returns NULL when nothing canonical exists.
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
  RETURN hit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_exercise_id(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pl_exercise_rows_autolink()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.exercise_id IS NULL AND btrim(coalesce(NEW.exercise_name_override, '')) <> '' THEN
    NEW.exercise_id := public.resolve_exercise_id(NEW.exercise_name_override);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pl_exercise_rows_autolink ON public.pl_exercise_rows;
CREATE TRIGGER trg_pl_exercise_rows_autolink
BEFORE INSERT OR UPDATE OF exercise_id, exercise_name_override ON public.pl_exercise_rows
FOR EACH ROW EXECUTE FUNCTION public.pl_exercise_rows_autolink();

-- Creating a library exercise whose name is a known alias is a duplicate.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_exercise_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE existing_id uuid;
BEGIN
  IF coalesce(NEW.archived,false) THEN RETURN NEW; END IF;
  SELECT id INTO existing_id FROM public.exercises
   WHERE id IS DISTINCT FROM NEW.id AND coalesce(archived,false)=false
     AND public.exercise_identity_name(name)=public.exercise_identity_name(NEW.name)
   ORDER BY (video_url LIKE '%player.vimeo.com%') DESC, (video_url IS NOT NULL) DESC, created_at ASC NULLS LAST
   LIMIT 1;
  IF existing_id IS NULL THEN
    SELECT a.exercise_id INTO existing_id FROM public.exercise_aliases a
     WHERE a.alias_key = public.pl_norm_exercise_name(NEW.name) AND a.exercise_id IS DISTINCT FROM NEW.id;
  END IF;
  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Exercise already exists as canonical id %; reuse the existing exercise instead of creating a duplicate.', existing_id
      USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS exercises_prevent_duplicate_identity ON public.exercises;
CREATE TRIGGER exercises_prevent_duplicate_identity
BEFORE INSERT OR UPDATE OF name, archived ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_exercise_identity();

-- ---------------------------------------------------------------------------
-- 6. Safe consolidation: remap every reference, keep the duplicate's video if
--    the canonical has none, archive (never delete) the duplicate, record an
--    alias so the old name keeps resolving.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_duplicate_exercise(_dup uuid, _canonical uuid, _reason text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE dup public.exercises; can public.exercises;
BEGIN
  SELECT * INTO dup FROM public.exercises WHERE id = _dup;
  SELECT * INTO can FROM public.exercises WHERE id = _canonical;
  IF dup.id IS NULL OR can.id IS NULL OR dup.id = can.id THEN RETURN; END IF;

  UPDATE public.pl_exercise_rows SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.member_set_logs SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.pl_client_maxes SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.pl_client_maxes SET source_exercise_id=_canonical WHERE source_exercise_id=_dup;
  UPDATE public.pl_exercise_notes SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.member_exercise_notes SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.member_exercise_swaps SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.warmup_assignments SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.logged_set_edit_audit SET exercise_id=_canonical WHERE exercise_id=_dup;
  DELETE FROM public.client_exercise_unit_prefs p WHERE p.exercise_id=_dup
    AND EXISTS (SELECT 1 FROM public.client_exercise_unit_prefs c WHERE c.client_id=p.client_id AND c.exercise_id=_canonical);
  UPDATE public.client_exercise_unit_prefs SET exercise_id=_canonical WHERE exercise_id=_dup;
  DELETE FROM public.member_exercise_unit_prefs p WHERE p.exercise_id=_dup
    AND EXISTS (SELECT 1 FROM public.member_exercise_unit_prefs c WHERE c.user_id=p.user_id AND c.exercise_id=_canonical);
  UPDATE public.member_exercise_unit_prefs SET exercise_id=_canonical WHERE exercise_id=_dup;
  DELETE FROM public.pl_exercise_favorites p WHERE p.exercise_id=_dup
    AND EXISTS (SELECT 1 FROM public.pl_exercise_favorites c WHERE c.user_id=p.user_id AND c.exercise_id=_canonical);
  UPDATE public.pl_exercise_favorites SET exercise_id=_canonical WHERE exercise_id=_dup;
  UPDATE public.pl_templates SET payload = replace(payload::text, _dup::text, _canonical::text)::jsonb
   WHERE payload::text LIKE '%' || _dup::text || '%';

  -- Preserve demo media and coaching text the canonical is missing.
  IF coalesce(can.vimeo_embed_url, can.video_url, can.youtube_url) IS NULL
     AND coalesce(dup.vimeo_embed_url, dup.video_url, dup.youtube_url) IS NOT NULL THEN
    UPDATE public.exercises SET
      video_provider=dup.video_provider, video_url=dup.video_url, youtube_url=dup.youtube_url,
      vimeo_video_id=dup.vimeo_video_id, vimeo_url=dup.vimeo_url, vimeo_embed_url=dup.vimeo_embed_url,
      thumbnail_url=coalesce(can.thumbnail_url, dup.thumbnail_url), vimeo_working=dup.vimeo_working,
      video_migration_status=dup.video_migration_status
    WHERE id=_canonical;
  END IF;
  UPDATE public.exercises SET
    cues = coalesce(nullif(cues,''), dup.cues),
    common_mistakes = coalesce(nullif(common_mistakes,''), dup.common_mistakes),
    equipment = coalesce(nullif(equipment,''), dup.equipment)
  WHERE id=_canonical;

  UPDATE public.exercises SET archived=true, archived_at=now() WHERE id=_dup;
  INSERT INTO public.exercise_aliases(alias_key, alias_name, exercise_id, source)
  VALUES (public.pl_norm_exercise_name(dup.name), dup.name, _canonical, 'dedupe')
  ON CONFLICT (alias_key) DO UPDATE SET exercise_id=EXCLUDED.exercise_id, alias_name=EXCLUDED.alias_name, source='dedupe';
  INSERT INTO public.exercise_dedupe_audit(duplicate_id, canonical_id, duplicate_name, canonical_name, reason)
  VALUES (_dup, _canonical, dup.name, can.name, _reason);
END;
$$;
REVOKE ALL ON FUNCTION public.merge_duplicate_exercise(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Confirmed word-order / spelling duplicates of the same movement. "(Version 2)"
-- entries are alternate demo videos and stay; opposite movements (high→low vs
-- low→high) are different exercises and stay.
DO $merge$
DECLARE grp text[]; can_id uuid; d record;
  groups text[][] := ARRAY[
    ARRAY['Chest Fly - Machine','Machine Chest Fly',''],
    ARRAY['Lying Hamstring Curl - Machine','Lying Leg Curl Machine',''],
    ARRAY['Wide-Grip Lat Pulldown','Lat Pull Down Wide Grip',''],
    ARRAY['Rear Delt Cable Fly','Cable Rear Delt Fly',''],
    ARRAY['Seated Lateral Raise - Dumbbell','Dumbbell Seated Lateral Raise',''],
    ARRAY['Seated Front Raise - Dumbbell','Dumbbell Seated Front Raise',''],
    ARRAY['Seated Shoulder Press - Dumbbell','Dumbbell Seated Shoulder Press',''],
    ARRAY['Incline Bench Press - Dumbbell','Dumbbell Incline Bench Press',''],
    ARRAY['Hip Thrust - Barbell','Barbell Hip Thrust',''],
    ARRAY['Barbell Shoulder Press - Standing','Barbell Standing Shoulder Press',''],
    ARRAY['Barbell Incline Bench Press','Barbell Bench Press Incline','Incline Barbell Bench Press'],
    ARRAY['Barbell Close Grip Bench Press','Close Grip Barbell Bench Press',''],
    ARRAY['Barbell Bent Over Row','Bent-Over Barbell Row',''],
    ARRAY['Dumbbell Bent Over Row','Dumbbells Bent Over Row',''],
    ARRAY['Barbell Wide Grip Biceps Curl','Barbell Bicep Curl Wide Grip',''],
    ARRAY['Barbell Curl','BB Curl',''],
    ARRAY['Barbell Romanian Deadlift','Romanian Deadlift Barbell',''],
    ARRAY['Barbell Front Raise','Front Raises Barbell',''],
    ARRAY['Barbell Upright Row','Upright Row Barbell',''],
    ARRAY['Chest Press Machine','Machine Chest Press',''],
    ARRAY['Hip Thrust Machine','Machine Hip Thrust',''],
    ARRAY['Hack Squat Machine','Hack Squat Machine Squat',''],
    ARRAY['Pec Deck Fly Machine','Pec Deck Fly Machine Flies',''],
    ARRAY['Close Reverse Grip Chin Up','Chin Up Reverse Close Grip',''],
    ARRAY['Smith Machine Press Incline','Incline Smith Machine Press',''],
    ARRAY['Bodyweight Wall Squat','Wall Squat Bodyweight',''],
    ARRAY['Dumbbell Alternate Seated Hammer Curl','Alternate Hammer Curl Seated Dumbbells',''],
    ARRAY['Alternate Single Leg Raise Plank','Alternate Single Leg Raises Plank',''],
    ARRAY['Dynamic Back Stretch','Back Stretch Dynamic',''],
    ARRAY['Back And Forward Leg Swings','Back Forward Leg Swings','']
  ];
BEGIN
  FOREACH grp SLICE 1 IN ARRAY groups LOOP
    -- Canonical = coach-filmed working Vimeo video, then any video, then most used, then oldest.
    SELECT e.id INTO can_id FROM public.exercises e
     WHERE NOT e.archived AND e.name = ANY(array_remove(grp, ''))
     ORDER BY e.vimeo_working DESC,
              (coalesce(e.vimeo_embed_url, e.video_url, e.youtube_url) IS NOT NULL) DESC,
              (SELECT count(*) FROM public.pl_exercise_rows r WHERE r.exercise_id = e.id) DESC,
              e.created_at ASC
     LIMIT 1;
    CONTINUE WHEN can_id IS NULL;
    FOR d IN SELECT e.id FROM public.exercises e
              WHERE NOT e.archived AND e.name = ANY(array_remove(grp, '')) AND e.id <> can_id LOOP
      PERFORM public.merge_duplicate_exercise(d.id, can_id, 'same movement, different word order/spelling');
    END LOOP;
  END LOOP;
END
$merge$;

-- ---------------------------------------------------------------------------
-- 7. Generic programming slot names → canonical library exercises.
-- ---------------------------------------------------------------------------
INSERT INTO public.exercise_aliases(alias_key, alias_name, exercise_id, source)
SELECT public.pl_norm_exercise_name(v.alias), v.alias, e.id, 'slot'
FROM (VALUES
  ('Back Extension', '45-Degree Back Extension'),
  ('Biceps Curl', 'EZ Bar Curl'),
  ('Calf Raise', 'Standing Calf Raise - Machine'),
  ('Chest Fly', 'Chest Fly - Machine'),
  ('Horizontal Row', 'Chest Supported Dumbbell Row'),
  ('Lateral Raise', 'Lateral Raise Dumbbell - Constant Tension'),
  ('Leg Curl', 'Lying Hamstring Curl - Machine'),
  ('Triceps Extension', 'Overhead Cable Triceps Extension'),
  ('Vertical Row', 'Chin-Grip Lat Pulldown')
) v(alias, canonical)
JOIN public.exercises e ON e.name = v.canonical AND NOT e.archived
ON CONFLICT (alias_key) DO NOTHING;

-- Jared McIntyre's current program: link exercise_id only. Display names
-- (exercise_name_override) and every prescription field stay untouched.
UPDATE public.pl_exercise_rows r
   SET exercise_id = public.resolve_exercise_id(r.exercise_name_override)
  FROM public.pl_days d
  JOIN public.pl_weeks w ON w.id = d.week_id
  JOIN public.pl_blocks b ON b.id = w.block_id
 WHERE r.day_id = d.id
   AND b.client_id = '3a548c6a-a07c-4832-aa32-92fdfdbe3282'
   AND b.start_date >= '2026-09-27'
   AND r.exercise_id IS NULL
   AND public.resolve_exercise_id(r.exercise_name_override) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. Exercise families: FAMILY → CANONICAL EXERCISE → ALIASES.
--    A family groups distinct, related variations (Competition Bench, Spoto
--    Press, Close-Grip Bench). Aliases are other names for ONE exercise.
-- ---------------------------------------------------------------------------
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS exercise_family text;

CREATE OR REPLACE FUNCTION public.exercise_family_for(_name text, _category text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  n text := ' ' || regexp_replace(lower(coalesce(_name,'')), '[^a-z0-9]+', ' ', 'g') || ' ';
  c text := lower(coalesce(_category,''));
BEGIN
  IF c ~ '(stretch|mobility|yoga)' OR n ~ ' (stretch|stretches|pose|foam roll|circles?|mobility) ' THEN RETURN 'Mobility'; END IF;
  IF n ~ ' (kettlebell|dumbbell|kb) swings? ' THEN RETURN 'Hip Hinge'; END IF;
  IF n ~ ' (snatch|clean|cleans|jerk|thrusters?) ' AND n !~ ' clean grip ' THEN RETURN 'Olympic Lift'; END IF;
  IF n ~ '( rear delt| rear lateral| reverse (pec|fly|flye|flyes|machine fly)| face ?pulls?| facepull| pull ?aparts?| rear fly| bent over (reverse|lateral) raise)' THEN RETURN 'Rear Delt'; END IF;
  IF n ~ ' upright rows? ' THEN RETURN 'Upright Row'; END IF;
  IF n ~ ' (lateral|side|y) raises? ' THEN RETURN 'Lateral Raise'; END IF;
  IF n ~ ' front raises? ' THEN RETURN 'Front Raise'; END IF;
  IF n ~ ' (shrugs?|farmer|farmers|suitcase) ' THEN RETURN 'Shrug & Carry'; END IF;
  IF n ~ ' (calf|calve|calves|tibialis) ' THEN RETURN 'Calf Raise'; END IF;
  IF n ~ ' (back extensions?|hyperextensions?|reverse hyper|reverse hyperextension|glute hyperextension) ' THEN RETURN 'Back Extension'; END IF;
  IF n ~ ' (good mornings?|romanian|rdl|rdls|stiff leg|stiff legged|sldl|single leg deadlift|one leg deadlift|pull through|pullthrough) ' THEN RETURN 'Hip Hinge'; END IF;
  IF n ~ ' (deadlifts?|rack pulls?|block pulls?) ' THEN RETURN 'Deadlift'; END IF;
  IF n ~ ' (hip thrusts?|glute bridges?|hip bridges?|frog pumps?) ' THEN RETURN 'Hip Thrust'; END IF;
  IF n ~ ' (leg curls?|hamstring curls?|ham curls?|nordic|nordics|glute ham|ghr) ' THEN RETURN 'Leg Curl'; END IF;
  IF n ~ ' (leg extensions?|leg ext|sissy squats?) ' THEN RETURN 'Leg Extension'; END IF;
  IF n ~ ' (adduction|adductors?|copenhagen|inner thigh) ' THEN RETURN 'Hip Adduction'; END IF;
  IF n ~ ' (abduction|abductors?|clams?|clamshells?|fire hydrants?|glute kickbacks?|cable kickbacks?|donkey kicks?|band walks?|monster walks?|side lying leg lift|side kick|hip extension|rear kick) ' THEN RETURN 'Glute Isolation'; END IF;
  IF n ~ ' (jumps?|jumping|bounds?|hops?|plyo) ' AND n !~ ' rope ' THEN RETURN 'Plyometric'; END IF;
  IF n ~ ' leg press ' THEN RETURN 'Leg Press'; END IF;
  IF n ~ ' (split squats?|bulgarian|lunges?|lunge|step ?ups?|pistol|single leg squats?|skater squats?) ' THEN RETURN 'Lunge & Split Squat'; END IF;
  IF n ~ ' (squats?|squat|wall sit) ' THEN RETURN 'Squat'; END IF;
  IF n ~ ' (wrist|wrists|finger|fingers|gripper|grip trainer|plate pinch|forearms?) ' THEN RETURN 'Forearm & Grip'; END IF;
  IF n ~ ' (curls?|biceps?|preacher|bayesian|zottman) ' AND n !~ ' (leg|legs|hamstring|jefferson) curl' THEN RETURN 'Curl'; END IF;
  IF n ~ ' dips? ' THEN RETURN 'Dip'; END IF;
  IF n ~ ' (triceps?|push ?downs?|pushdowns?|press ?downs?|pressdowns?|skull ?crushers?|skullcrushers?|kickbacks?|french press|tate press|jm press) '
     OR n ~ ' (overhead|lying) .*extensions? ' THEN RETURN 'Triceps Extension'; END IF;
  IF n ~ ' (pullovers?|pull overs?|straight arm) ' THEN RETURN 'Pullover'; END IF;
  IF n ~ ' (pull ?ups?|pullups?|chin ?ups?|chinups?|pull ?downs?|pulldowns?|lat pull|muscle ?ups?) ' THEN RETURN 'Pulldown & Pull-Up'; END IF;
  IF n ~ ' (rows?|pendlay|t bar|tbar|meadows|kroc|seal row) ' THEN RETURN 'Row'; END IF;
  IF n ~ ' incline ' AND n ~ ' (press|bench) ' THEN RETURN 'Incline Press'; END IF;
  IF n ~ ' (bench press|bench presses|larsen|spoto|spotto|pin press|board press|competition bench|paused bench|pause bench|tempo bench|touch and go|floor press|close grip bench|cgbp) '
     OR n ~ ' bench $' OR (n ~ ' bench ' AND n ~ ' press ') OR (n ~ ' decline ' AND n ~ ' press ') THEN RETURN 'Bench Press'; END IF;
  IF n ~ ' (chest press|hex press|squeeze press|svend|guillotine) ' THEN RETURN 'Chest Press'; END IF;
  IF n ~ ' (push ?ups?|pushups?) ' THEN RETURN 'Push-Up'; END IF;
  IF n ~ ' (fly|flys|flye|flyes|flies|pec deck|crossovers?|cable machine high to low|cable machine low to high) ' THEN RETURN 'Chest Fly'; END IF;
  IF n ~ ' (external rotations?|internal rotations?|external shoulder rotation|external rotatio|cuban press|t raises?|ytw|swimmers?|scapular retraction|scap retraction) ' THEN RETURN 'Shoulder Health'; END IF;
  IF n ~ ' (overhead press|ohp|military|shoulders? press|shoulder pres|push press|arnold|z press|landmine press|behind neck press|seated press|standing press|handstand|scott press|w press|seesaw press|anti gravity press|press under|single arm press) '
     OR (n ~ ' press ' AND n ~ ' (dumbbells?|kettlebell|barbell|band) ') THEN RETURN 'Overhead Press'; END IF;
  IF n ~ ' (crunch|crunches|sit ?ups?|situps?|leg raises?|knee raises?|knee tucks?|ab wheel|rollouts?|roll outs?|planks?|pallof|wood ?chops?|woodchops?|dead ?bugs?|bird dogs?|russian twists?|hollow|v ups?|toes to bar|obliques?|side bends?|mountain climbers?|flutter kicks?|abs?|core|l sit|dragon flag|windshield wipers?|jackknife) ' THEN RETURN 'Core'; END IF;
  IF n ~ ' supermans? ' THEN RETURN 'Back Extension'; END IF;
  IF n ~ ' glute (kick ?back|extension) ' THEN RETURN 'Glute Isolation'; END IF;
  IF c ~ 'triceps' AND n ~ ' extension ' THEN RETURN 'Triceps Extension'; END IF;
  IF c ~ 'abdominal' OR n ~ ' (twist|twists|twisting|chop|chopper|choppers|heel touch|heels touch|heel touches|toe touch|toe touches|bicycles?|scissors|dragonfly|fallout|knees to elbows|hip raise|walkout|body saw|jack knives) ' THEN RETURN 'Core'; END IF;
  IF c ~ '(cardio|calisthenics)' OR n ~ ' (bike|rowing|run|running|walk|sprint|treadmill|elliptical|skipping|jump rope|burpees?|cardio|erg|ergometer|stair) ' THEN RETURN 'Conditioning'; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.exercises_family_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF btrim(coalesce(NEW.exercise_family,'')) = '' THEN
    NEW.exercise_family := public.exercise_family_for(NEW.name, NEW.category);
  ELSE
    NEW.exercise_family := btrim(NEW.exercise_family);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS exercises_family_default_trg ON public.exercises;
CREATE TRIGGER exercises_family_default_trg
BEFORE INSERT OR UPDATE OF name, category, exercise_family ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.exercises_family_default();

UPDATE public.exercises SET exercise_family = public.exercise_family_for(name, category)
 WHERE exercise_family IS NULL;
CREATE INDEX IF NOT EXISTS exercises_family_idx ON public.exercises (exercise_family) WHERE NOT archived;

-- "Keep separate" decisions from the duplicate-review queue.
CREATE TABLE IF NOT EXISTS public.exercise_duplicate_dismissals (
  exercise_a uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  exercise_b uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  dismissed_by uuid,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exercise_a, exercise_b),
  CHECK (exercise_a < exercise_b)
);
ALTER TABLE public.exercise_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin manage duplicate dismissals" ON public.exercise_duplicate_dismissals;
CREATE POLICY "Admin manage duplicate dismissals" ON public.exercise_duplicate_dismissals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
