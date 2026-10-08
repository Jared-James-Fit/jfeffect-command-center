-- Exercise library: movement family by powerlifting logic, so client program
-- cards show the right colour.
--
--   squat = yellow   bench = blue   deadlift = green   accessory = red
--
-- Green/yellow/blue are for the competition lifts AND the exercises that aid
-- them: variations that keep the competition movement and change the stimulus
-- (pause, tempo, deficit, box/pin, safety squat bar, front squat, close-grip,
-- Spoto, Larsen, floor/pin/board/slingshot press, rack/block pulls, snatch-
-- grip, trap bar...). Everything else — hinge/posterior-chain work (RDL, good
-- mornings, curls, back extensions), machines, dumbbell/single-leg work,
-- isolation, GPP — is an accessory (red).
--
-- Grounded in the coach's own program labels (purpose_label), not just names:
--   * Primary / Secondary / Tertiary / Quaternary "<lift>" tiers  -> that lift
--       (Paused Bench, High Bar Squat, Spoto, Larsen, Close-Grip, SSB, and the
--        Quaternary "limiters": Belt Squat -> squat, Incline DB Press -> bench)
--   * "Isolation <lift>", GPP, Assistance, "... Accessory"        -> accessory
--       (leg extension, hamstring curl, back extension, flyes, lateral raises,
--        RDL variations are labelled accessory/isolation in lift-named tiers)
-- Generic tier labels with no lift named ("Secondary", "Tertiary") are just the
-- position in a day and sit on rows, hip thrusts, split squats too, so they are
-- NOT used as evidence.
--
-- Supersedes the heuristic in exercise_movement_family_for() from
-- 20261005230000 (same name/signature; CREATE OR REPLACE). Safe in either
-- order: this only fills families that are still NULL, so coach edits and an
-- earlier backfill are never overwritten.
--
-- Judgement calls (flip one by editing a single exercise in the library, or the
-- rule here): Romanian/stiff-leg deadlifts and good mornings are accessories;
-- hack/pendulum/leg-press are accessories (belt squat is the coach's own tiered
-- limiter); dumbbell flat bench is an accessory (the coach labels it so) while
-- Incline DB Press is bench (the coach tiers it Quaternary Bench).

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

  -- The coach's own tiered "limiters".
  IF n ~ ' belt squats? ' THEN RETURN 'squat'; END IF;
  IF n ~ ' (incline dumbbell press|incline bench press dumbbell|dumbbell chest press incline bench) ' THEN RETURN 'bench'; END IF;

  -- SQUAT: barbell squat variations (back / front / SSB / box / pin / pause / tempo).
  IF n ~ ' squats? '
     AND n !~ (' (split|bulgarian|lunges?|jefferson|jump(s|ing)?|hop|burpee|kneeling|sissy|pistol|cossack|curtsy|skater|'
       || 'lateral|side|single leg|one leg|goblet|dumbbells?|kettlebells?|smith|machine|hack|pendulum|landmine|plate|band|'
       || 'cable|bodyweight|wall|spanish|suspension|ball|med|ski|press|curl|row|raise|stretch|calf|incline|punch|clap|'
       || 'in and out|heel touch|kick|sumo|zercher|overhead|rotational|chops?|suitcase|offset|balance|assisted|reach|exercise) ')
     AND n ~ ' (competition|high bar|low bar|barbell|box|pin|safety squat bar|ssb|paus(e|ed)?|tempo|anderson|front) '
  THEN RETURN 'squat'; END IF;

  -- BENCH: barbell bench variations (comp, pause, TNG, close-grip, Spoto, Larsen,
  -- floor / pin / board / slingshot, incline / decline barbell).
  IF n ~ ' (competition bench|bench press|close grip (bench )?press|larsen|spoto|spotto|floor press|dead bench|pin press|board press|slingshot|touch and go|tng) '
     AND n !~ (' (dumbbells?|kettlebells?|machine|cable|smith|svend|fly|flyes?|flies|dips?|push ?ups?|rows?|curls?|raises?|'
       || 'extensions?|skull|shoulder|military|overhead|step ups?|squats?|pull ups?|chin|stretch|rotation|plank|crunch|'
       || 'sit ups?|jm|squeeze|wrist|landmine|hamstring|leg|prone|diamond|assisted|lying) ')
  THEN RETURN 'bench'; END IF;

  -- DEADLIFT: floor-pull variations (comp, conventional / sumo, deficit, pause,
  -- tempo, snatch-grip, block / rack pull, trap bar). Hinges from the top (RDL,
  -- stiff-leg, good morning) are accessories.
  IF n ~ ' (deadlifts?|rack pull|block pull) '
     AND n !~ (' (romanian|rdl|stiff|straight leg|good mornings?|single leg|single arm|one arm|staggered|b stance|dumbbells?|'
       || 'kettlebells?|plate|landmine|cable|bodyweight|clean|high pull|shrugs?|reverse|goblet|pinch|machine) ')
     AND n ~ ' (competition|conventional|barbell|sumo|deficit|paus(e|ed)?|tempo|snatch|block pull|rack pull|trap bar|hex bar|coan|band|2 count|two count|2 second) '
  THEN RETURN 'deadlift'; END IF;

  RETURN 'accessory';
END
$$;

-- Backfill only what's still unset (never overwrite a coach's choice). Quiet the
-- updated_at / default-volume triggers so this touches nothing but the family.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exercises_updated_at', 'exercises_default_volume_multiplier'] LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.exercises'::regclass AND tgname = t) THEN
      EXECUTE format('ALTER TABLE public.exercises DISABLE TRIGGER %I', t);
    END IF;
  END LOOP;

  UPDATE public.exercises
     SET movement_family = public.exercise_movement_family_for(name, competition_lift_type)
   WHERE movement_family IS NULL;

  FOREACH t IN ARRAY ARRAY['exercises_updated_at', 'exercises_default_volume_multiplier'] LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.exercises'::regclass AND tgname = t) THEN
      EXECUTE format('ALTER TABLE public.exercises ENABLE TRIGGER %I', t);
    END IF;
  END LOOP;
END $$;

-- New / renamed exercises classify themselves (editable afterwards in the library).
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

CREATE INDEX IF NOT EXISTS exercises_movement_family_idx ON public.exercises (movement_family) WHERE NOT archived;
