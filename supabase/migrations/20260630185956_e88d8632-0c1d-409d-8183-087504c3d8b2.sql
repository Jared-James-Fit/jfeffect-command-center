
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
  -- Rear delts
  IF n ~ '(rear[- ]?delt|reverse pec|rear fly|face pull|reverse fly|rear-?delt|prone (y|t|w))' THEN RETURN 'Rear Delts'; END IF;
  -- Side delts
  IF n ~ '(lateral raise|side raise|side delt|cable lateral|machine lateral|leaning lateral|y[- ]raise|upright row)' THEN RETURN 'Side Delts'; END IF;
  -- Front delts
  IF n ~ '(front raise|front delt|overhead press|\yohp\y|military press|shoulder press|arnold press|landmine press|push press|z press|seated press|standing press|pike push|handstand)' THEN RETURN 'Front Delts'; END IF;
  -- Chest
  IF n ~ '(bench press|bench-press|chest press|pec deck|pec fly|chest fly|cable fly|dumbbell fly|db fly|push[- ]?up|pushup|push up|svend press|hex press|squeeze press|floor press|crossover|cable crossover|chest dip|guillotine press|larsen press)' THEN RETURN 'Chest'; END IF;
  -- Lats
  IF n ~ '(lat ?pull[- ]?down|pull[- ]?down|pull[- ]?up|pullup|pull up|chin[- ]?up|chinup|chin up|straight[- ]?arm pull|pullover|lat ?row|lat-biased|one[- ]arm pulldown|kneeling pulldown|assisted pull|assisted chin|muscle[- ]?up|lat prayer)' THEN RETURN 'Lats'; END IF;
  -- Traps
  IF n ~ '(shrug|farmer.{0,3} (carry|walk)|trap raise|rack pull|suitcase carry|scapula retraction|scap retraction)' THEN RETURN 'Traps'; END IF;
  -- Upper back (rows + supermans)
  IF n ~ '(\yrow\y|pendlay|seal row|t[- ]?bar|\ytbar\y|meadows|chest[- ]?supported|seated cable|seated row|barbell row|bb row|db row|dumbbell row|inverted row|ring row|machine row|landmine row|kroc|helms row|yates row|gorilla|lawnmower|renegade row|superman|deadstop row)' THEN RETURN 'Upper Back'; END IF;
  -- Biceps
  IF n ~ '(curl)' AND n !~ '(leg curl|hamstring curl|ham curl|wrist curl|reverse wrist|nordic|jefferson curl)' THEN RETURN 'Biceps'; END IF;
  IF n ~ '(biceps|preacher|bayesian|spider curl|concentration|zottman|drag curl|hammer)' THEN RETURN 'Biceps'; END IF;
  -- Triceps
  IF n ~ '(triceps|tricep|push[- ]?down|skull crush|skullcrusher|jm press|overhead extension|tate press|close[- ]?grip bench|\ycgbp\y|kickback|french press|tricep dip|bench dip|diamond push)' THEN RETURN 'Triceps'; END IF;
  IF n ~ '(\ydips?\y)' AND n !~ '(chest dip)' THEN RETURN 'Triceps'; END IF;
  -- Forearms
  IF n ~ '(wrist curl|wrist roller|grip trainer|hand gripper|plate pinch|finger curl|reverse curl|forearm)' THEN RETURN 'Forearms'; END IF;
  -- Quads
  IF n ~ '(squat|leg press|leg extension|leg ext|hack squat|sissy squat|bulgarian|split squat|step[- ]?up|lunge|belt squat|smith squat|front squat|safety bar|\ysbs\y|wall sit|pistol)' THEN RETURN 'Quads'; END IF;
  -- Hamstrings
  IF n ~ '(romanian deadlift|\yrdl\y|stiff[- ]?leg|\ysldl\y|leg curl|hamstring curl|ham curl|nordic|glute[- ]?ham raise|\yghr\y|good morning)' THEN RETURN 'Hamstrings'; END IF;
  IF n ~ '(deadlift)' AND n !~ '(sumo|romanian|stiff|trap bar|hex bar)' THEN RETURN 'Hamstrings'; END IF;
  -- Glutes
  IF n ~ '(hip thrust|glute bridge|glute kickback|cable kickback|frog pump|glute|sumo deadlift|hip abduction|abduction|donkey kick|fire hydrant|clamshell)' THEN RETURN 'Glutes'; END IF;
  -- Adductors
  IF n ~ '(adduct|copenhagen|inner thigh)' THEN RETURN 'Adductors'; END IF;
  -- Calves
  IF n ~ '(calf raise|calf|donkey calf|tibialis)' THEN RETURN 'Calves'; END IF;
  -- Lower back
  IF n ~ '(back extension|hyperextension|reverse hyper|jefferson curl|good morning|lower back|sorensen|45 extension|45-degree)' THEN RETURN 'Lower Back'; END IF;
  -- Abs / core
  IF n ~ '(crunch|sit[- ]?up|situp|leg raise|knee raise|ab wheel|plank|pallof|wood chop|woodchop|dead bug|deadbug|bird dog|russian twist|hollow|v[- ]?up|toes to bar|hanging knee|hanging leg|cable crunch|oblique|side bend|ab roller|mountain climber|flutter kick|\yabs?\y|\ycore\y)' THEN RETURN 'Abs/Core'; END IF;
  -- Trap/hex bar
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
  IF e = 'lats' THEN RETURN 'Lats'; END IF;
  IF e ~ 'lats' AND e ~ 'upper back' THEN RETURN 'Lats'; END IF;
  IF e ~ 'upper back' THEN RETURN 'Upper Back'; END IF;
  IF e ~ '^traps' THEN RETURN 'Traps'; END IF;
  IF e ~ 'brachialis' THEN RETURN 'Biceps'; END IF;
  IF e ~ 'rotator cuff' THEN RETURN 'Rear Delts'; END IF;
  -- Broad buckets we cannot split further → flag for review by returning NULL
  IF e = 'back' THEN RETURN NULL; END IF;
  IF e = 'shoulders' THEN RETURN NULL; END IF;
  IF e = 'legs' THEN RETURN NULL; END IF;
  -- Generic cardio / mobility / yoga → Other (NOT flagged for review)
  IF e ~ 'calisthenics|cardio|plyo|functional|yoga|stretch|mobility' THEN RETURN 'Other'; END IF;

  RETURN NULL;
END;
$$;

-- Re-run backfill across rows still flagged
UPDATE public.exercises ex
SET primary_muscle_group = COALESCE(public.classify_exercise_muscle(ex.name, ex.muscle_group), 'Other'),
    needs_muscle_review  = (public.classify_exercise_muscle(ex.name, ex.muscle_group) IS NULL)
WHERE ex.needs_muscle_review = true OR ex.primary_muscle_group = 'Other' OR ex.primary_muscle_group IS NULL;
