
-- 1. Add new columns (idempotent)
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS primary_muscle_group TEXT,
  ADD COLUMN IF NOT EXISTS needs_muscle_review BOOLEAN NOT NULL DEFAULT false;

-- 2. Canonical list as a constant via CHECK (allow NULL only transiently)
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_primary_muscle_group_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_primary_muscle_group_check
  CHECK (primary_muscle_group IS NULL OR primary_muscle_group IN (
    'Chest','Lats','Upper Back','Traps','Front Delts','Side Delts','Rear Delts',
    'Biceps','Triceps','Forearms','Quads','Hamstrings','Glutes','Adductors',
    'Calves','Abs/Core','Lower Back','Other'
  ));

-- 3. Normalization helper: name-pattern + existing-bucket → canonical group
CREATE OR REPLACE FUNCTION public.classify_exercise_muscle(p_name TEXT, p_existing TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n TEXT := lower(coalesce(p_name, ''));
  e TEXT := lower(coalesce(p_existing, ''));
BEGIN
  -- ===== Name-based mapping (priority) =====
  -- Rear delts (check before generic delt/row)
  IF n ~ '(rear[- ]?delt|reverse pec|rear fly|face pull|reverse fly|rear-?delt)' THEN RETURN 'Rear Delts'; END IF;
  -- Side delts
  IF n ~ '(lateral raise|side raise|side delt|cable lateral|machine lateral|leaning lateral|y[- ]raise|upright row)' THEN RETURN 'Side Delts'; END IF;
  -- Front delts / overhead pressing
  IF n ~ '(front raise|front delt|overhead press|ohp|military press|shoulder press|arnold press|landmine press|push press|z press|seated press|standing press|pike push)' THEN RETURN 'Front Delts'; END IF;
  -- Chest
  IF n ~ '(bench press|bench-press|chest press|pec deck|pec fly|chest fly|cable fly|dumbbell fly|db fly|push[- ]?up|pushup|incline (bb|db|dumbbell|barbell|cable)|decline (bb|db|dumbbell|barbell)|svend press|hex press|squeeze press|floor press|crossover|cable crossover|chest dip)' THEN RETURN 'Chest'; END IF;
  -- Lats
  IF n ~ '(lat pulldown|pulldown|pull[- ]?up|pullup|chin[- ]?up|chinup|straight[- ]?arm pull|pullover|lat row|lat-biased|one[- ]arm pulldown|kneeling pulldown|assisted pull|assisted chin)' THEN RETURN 'Lats'; END IF;
  -- Traps (shrugs / farmer carries)
  IF n ~ '(shrug|farmer carry|farmers carry|farmer walk|trap raise|rack pull|suitcase carry)' THEN RETURN 'Traps'; END IF;
  -- Upper back (rows)
  IF n ~ '(row\b|pendlay|seal row|t[- ]?bar|tbar|meadows|chest[- ]?supported|seated cable row|seated row|barbell row|bb row|db row|dumbbell row|inverted row|ring row|machine row|landmine row|kroc row|helms row|yates row|gorilla row)' THEN RETURN 'Upper Back'; END IF;
  -- Biceps
  IF n ~ '(curl)' AND n !~ '(leg curl|hamstring curl|ham curl|wrist curl|reverse wrist|nordic|jefferson curl)' THEN RETURN 'Biceps'; END IF;
  IF n ~ '(biceps|preacher|bayesian|spider curl|concentration|zottman|drag curl|hammer)' THEN RETURN 'Biceps'; END IF;
  -- Triceps
  IF n ~ '(triceps|tricep|pushdown|push[- ]?down|skull crush|skullcrusher|jm press|overhead extension|tate press|close[- ]?grip bench|cgbp|kickback|french press|dips?$|tricep dip|bench dip|diamond push)' THEN RETURN 'Triceps'; END IF;
  -- Forearms
  IF n ~ '(wrist curl|wrist roller|grip trainer|hand gripper|plate pinch|finger curl|reverse curl|forearm)' THEN RETURN 'Forearms'; END IF;
  -- Quads (squat variants, leg press, extension, lunge)
  IF n ~ '(squat|leg press|leg extension|leg ext|hack squat|sissy squat|bulgarian|split squat|step[- ]?up|lunge|belt squat|smith squat|front squat|safety bar|sbs)' THEN RETURN 'Quads'; END IF;
  -- Hamstrings
  IF n ~ '(romanian deadlift|rdl|stiff[- ]?leg|sldl|leg curl|hamstring curl|ham curl|nordic|glute[- ]?ham raise|ghr|good morning)' THEN RETURN 'Hamstrings'; END IF;
  IF n ~ '(conventional deadlift|deadlift)' AND n !~ '(sumo|romanian|stiff|trap bar|hex bar)' THEN RETURN 'Hamstrings'; END IF;
  -- Glutes
  IF n ~ '(hip thrust|glute bridge|glute kickback|cable kickback|frog pump|glute|sumo deadlift|hip abduction|abduction)' THEN RETURN 'Glutes'; END IF;
  -- Adductors
  IF n ~ '(adduct|adductor|copenhagen|inner thigh)' THEN RETURN 'Adductors'; END IF;
  -- Calves
  IF n ~ '(calf raise|calf|donkey calf|tibialis)' THEN RETURN 'Calves'; END IF;
  -- Lower back
  IF n ~ '(back extension|hyperextension|reverse hyper|jefferson curl|good morning|lower back|sorensen|45 extension|45-degree extension)' THEN RETURN 'Lower Back'; END IF;
  -- Abs / core
  IF n ~ '(crunch|sit[- ]?up|situp|leg raise|knee raise|ab wheel|plank|pallof|wood chop|woodchop|dead bug|deadbug|bird dog|russian twist|hollow|v[- ]?up|v-up|toes to bar|hanging knee|hanging leg|cable crunch|oblique|side bend|ab roller|mountain climber|flutter kick|abs?\b|core)' THEN RETURN 'Abs/Core'; END IF;
  -- Trap bar / hex bar deadlift → Quads (more quad-dominant)
  IF n ~ '(trap bar|hex bar)' THEN RETURN 'Quads'; END IF;

  -- ===== Existing bucket fallback =====
  IF e = 'chest' THEN RETURN 'Chest'; END IF;
  IF e = 'biceps' THEN RETURN 'Biceps'; END IF;
  IF e = 'triceps' THEN RETURN 'Triceps'; END IF;
  IF e = 'forearms' THEN RETURN 'Forearms'; END IF;
  IF e = 'calves' THEN RETURN 'Calves'; END IF;
  IF e = 'quads' THEN RETURN 'Quads'; END IF;
  IF e = 'glutes' THEN RETURN 'Glutes'; END IF;
  IF e ~ '^abdominals?$' OR e ~ '^abs' OR e = 'core' OR e ~ 'abs, lower back' THEN RETURN 'Abs/Core'; END IF;
  IF e ~ 'lower back' OR e ~ 'spinal erector' THEN RETURN 'Lower Back'; END IF;
  IF e ~ 'rear delt' THEN RETURN 'Rear Delts'; END IF;
  IF e ~ 'side delt' THEN RETURN 'Side Delts'; END IF;
  IF e ~ 'front delt' THEN RETURN 'Front Delts'; END IF;
  IF e ~ 'glute medius|hip stabiliz' THEN RETURN 'Glutes'; END IF;
  IF e ~ 'adductor|groin' THEN RETURN 'Adductors'; END IF;
  IF e ~ 'hamstring' THEN RETURN 'Hamstrings'; END IF;
  IF e ~ 'lats' AND e ~ 'upper back' THEN RETURN 'Lats'; END IF;
  IF e = 'lats' THEN RETURN 'Lats'; END IF;
  IF e ~ 'upper back' THEN RETURN 'Upper Back'; END IF;
  IF e = 'traps' OR e ~ '^traps' THEN RETURN 'Traps'; END IF;
  IF e ~ 'brachialis' THEN RETURN 'Biceps'; END IF;
  IF e ~ 'rotator cuff' THEN RETURN 'Rear Delts'; END IF;

  RETURN NULL;  -- caller flags for review
END;
$$;

-- 4. Backfill every exercise (idempotent: only update where primary_muscle_group is missing/Other)
UPDATE public.exercises ex
SET primary_muscle_group = COALESCE(public.classify_exercise_muscle(ex.name, ex.muscle_group), 'Other'),
    needs_muscle_review  = (public.classify_exercise_muscle(ex.name, ex.muscle_group) IS NULL)
WHERE ex.primary_muscle_group IS NULL OR ex.primary_muscle_group = 'Other';

-- 5. Index for filter perf
CREATE INDEX IF NOT EXISTS exercises_primary_muscle_group_idx
  ON public.exercises(primary_muscle_group);
CREATE INDEX IF NOT EXISTS exercises_needs_muscle_review_idx
  ON public.exercises(needs_muscle_review) WHERE needs_muscle_review = true;

-- 6. Auto-classify trigger on insert/update when not provided
CREATE OR REPLACE FUNCTION public.exercises_autoclassify()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  guess TEXT;
BEGIN
  IF NEW.primary_muscle_group IS NULL OR NEW.primary_muscle_group = '' THEN
    guess := public.classify_exercise_muscle(NEW.name, NEW.muscle_group);
    IF guess IS NOT NULL THEN
      NEW.primary_muscle_group := guess;
      NEW.needs_muscle_review := false;
    ELSE
      NEW.primary_muscle_group := 'Other';
      NEW.needs_muscle_review := true;
    END IF;
  ELSE
    NEW.needs_muscle_review := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exercises_autoclassify_trg ON public.exercises;
CREATE TRIGGER exercises_autoclassify_trg
  BEFORE INSERT OR UPDATE OF name, muscle_group, primary_muscle_group ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.exercises_autoclassify();
