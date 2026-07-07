ALTER TABLE public.pl_exercise_rows ADD COLUMN IF NOT EXISTS movement_family text;

ALTER TABLE public.pl_exercise_rows DROP CONSTRAINT IF EXISTS pl_exercise_rows_movement_family_check;
ALTER TABLE public.pl_exercise_rows ADD CONSTRAINT pl_exercise_rows_movement_family_check
  CHECK (movement_family IS NULL OR movement_family IN ('squat','bench','deadlift','upper','lower','other'));

UPDATE public.pl_exercise_rows r
SET movement_family = e.competition_lift_type
FROM public.exercises e
WHERE r.exercise_id = e.id
  AND r.movement_family IS NULL
  AND e.competition_lift_type IN ('squat','bench','deadlift');