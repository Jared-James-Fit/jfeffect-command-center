-- Backfill movement_family from competition lifts (idempotent — same as prior template migration)
UPDATE public.pl_exercise_rows r
SET movement_family = e.competition_lift_type
FROM public.exercises e
WHERE r.exercise_id = e.id
  AND r.movement_family IS NULL
  AND e.competition_lift_type IN ('squat','bench','deadlift');

-- Backfill movement_family from variation pl_lift_group when it maps to squat/bench/deadlift
UPDATE public.pl_exercise_rows r
SET movement_family = e.pl_lift_group
FROM public.exercises e
WHERE r.exercise_id = e.id
  AND r.movement_family IS NULL
  AND e.exercise_category = 'variation'
  AND e.pl_lift_group IN ('squat','bench','deadlift');