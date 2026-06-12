-- Exercise metadata system
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS is_competition_lift boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS competition_lift_type text,
  ADD COLUMN IF NOT EXISTS exercise_category text NOT NULL DEFAULT 'assistance';

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_competition_lift_type_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_competition_lift_type_check
  CHECK (competition_lift_type IS NULL OR competition_lift_type = ANY (ARRAY['squat','bench','deadlift']));

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_exercise_category_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_exercise_category_check
  CHECK (exercise_category = ANY (ARRAY['competition','variation','assistance']));

-- Backfill from existing pl_lift_group / is_powerlifting. Treat any exercise
-- whose name is exactly "Competition Squat/Bench Press/Deadlift" (case-insensitive)
-- as a competition lift; all other pl_lift_group rows are variations.
UPDATE public.exercises
   SET is_competition_lift = true,
       competition_lift_type = pl_lift_group,
       exercise_category = 'competition'
 WHERE is_powerlifting = true
   AND pl_lift_group IN ('squat','bench','deadlift')
   AND (
     lower(btrim(name)) IN ('competition squat','competition bench','competition bench press','competition deadlift')
   );

UPDATE public.exercises
   SET exercise_category = 'variation'
 WHERE exercise_category = 'assistance'
   AND is_powerlifting = true
   AND pl_lift_group IN ('squat','bench','deadlift')
   AND is_competition_lift = false;

CREATE INDEX IF NOT EXISTS idx_exercises_category ON public.exercises(exercise_category);
CREATE INDEX IF NOT EXISTS idx_exercises_competition ON public.exercises(competition_lift_type) WHERE is_competition_lift = true;

-- Per-instance overrides on the programmed row
ALTER TABLE public.pl_exercise_rows
  ADD COLUMN IF NOT EXISTS purpose_label text,
  ADD COLUMN IF NOT EXISTS rest_seconds_override integer;

-- Preserve any coach-entered rest by copying existing rest_seconds into the override.
-- Going forward `rest_seconds` is the resolved/effective value; `rest_seconds_override`
-- tracks whether the coach has overridden the category default.
UPDATE public.pl_exercise_rows
   SET rest_seconds_override = rest_seconds
 WHERE rest_seconds IS NOT NULL
   AND rest_seconds_override IS NULL;
