-- Nov 15 2026, after 20270323090000: the same fixed weights on the finished
-- workouts of those four programs (Colten, Fionna, Marc, Nicolas), so no program in
-- the app still reads "Start with X lb" anywhere. Text only (logged sets untouched),
-- only notes still exactly as written, old text in program_note_weight_backup.

WITH map(old_notes, new_notes) AS (
  VALUES
    ($q$Station 1. Start with 165lb (last block top set). Focus on bracing to protect low back. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 5lb if RPE is met.$q$, $q$Station 1. Focus on bracing to protect low back. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 5lb if RPE is met.$q$),
    ($q$Glute bias: long stride, slight forward lean. · Progress: Double progression. Start at 20lb. · Swap if needed: Dumbbell Reverse Lunge$q$, $q$Glute bias: long stride, slight forward lean. · Progress: Double progression. · Swap if needed: Dumbbell Reverse Lunge$q$),
    ($q$Keep the momentum! Start with 95lb. · Progress: Add 2.5-5lb when 12 reps reached. · Swap if needed: Single-Arm Bent-Over Dumbbell Row$q$, $q$Keep the momentum! · Progress: Add 2.5-5lb when 12 reps reached. · Swap if needed: Single-Arm Bent-Over Dumbbell Row$q$),
    ($q$Station 1: Rack. Start with 145lb (last block's top set). Focus on depth and bracing. · Progress: Add 5lb weekly if RPE ≤ target. · Swap if needed: High Bar Squat$q$, $q$Station 1: Rack. Focus on depth and bracing. · Progress: Add 5lb weekly if RPE ≤ target. · Swap if needed: High Bar Squat$q$),
    ($q$Station 1. Start with 135lb. Priority lift. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 2.5-5lb if RPE is met.$q$, $q$Station 1. Priority lift. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 2.5-5lb if RPE is met.$q$),
    ($q$2-second pause at the top. Drive through heels. · Progress: Double progression. Start at 65lb. · Swap if needed: Hip Thrust Machine$q$, $q$2-second pause at the top. Drive through heels. · Progress: Double progression. · Swap if needed: Hip Thrust Machine$q$),
    ($q$Station 2. Use 50lb DBs. Rest 90s after both legs are done. · Progress: Double progression. Add weight when 12 reps are hit at RPE 8.$q$, $q$Station 2. Rest 90s after both legs are done. · Progress: Double progression. Add weight when 12 reps are hit at RPE 8.$q$),
    ($q$Station 2. Use 50lb DBs. Superset with calf raises: both legs, rest 30s, calf raises, rest 60s, then split squats again. · Progress: Double progression. Add weight when 12 reps are hit at RPE 8.$q$, $q$Station 2. Superset with calf raises: both legs, rest 30s, calf raises, rest 60s, then split squats again. · Progress: Double progression. Add weight when 12 reps are hit at RPE 8.$q$),
    ($q$Superset with cable lateral raises: belt squat, rest 45s, lateral raises (both arms), rest 75s, then belt squat again. · Start with 75lb. Great for quad volume without ankle/back stress. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$, $q$Superset with cable lateral raises: belt squat, rest 45s, lateral raises (both arms), rest 75s, then belt squat again. Great for quad volume without ankle/back stress. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$),
    ($q$Superset with Lateral Raises to save time. · Progress: Double progression. Start at 35lb. · Swap if needed: Dumbbells Single Arm Row$q$, $q$Superset with Lateral Raises to save time. · Progress: Double progression. · Swap if needed: Dumbbells Single Arm Row$q$),
    ($q$Superset with lateral raises: RDL, rest 60s, lateral raises, rest 60s, then RDL again. · Start with 135lb. Focus on hip hinge depth. · Progress: Add 5lb when all sets hit 12 reps. · Swap if needed: Barbell Romanian Deadlift$q$, $q$Superset with lateral raises: RDL, rest 60s, lateral raises, rest 60s, then RDL again. Focus on hip hinge depth. · Progress: Add 5lb when all sets hit 12 reps. · Swap if needed: Barbell Romanian Deadlift$q$),
    ($q$Superset with the close-grip pulldown: bench, rest 60s, pulldown, rest 75s, then bench again. · Watch left wrist comfort. Start with 110lb. · Progress: Add 2.5-5lb when all sets hit 8 reps. · Swap if needed: Touch and Go Bench Press$q$, $q$Superset with the close-grip pulldown: bench, rest 60s, pulldown, rest 75s, then bench again. · Watch left wrist comfort. · Progress: Add 2.5-5lb when all sets hit 8 reps. · Swap if needed: Touch and Go Bench Press$q$),
    ($q$Watch neck pain; ensure head is supported. Start ~85lb. · Progress: Add 2.5lb per week. · Swap if needed: Barbell Bench Press$q$, $q$Watch neck pain; ensure head is supported. · Progress: Add 2.5lb per week. · Swap if needed: Barbell Bench Press$q$),
    ($q$Monitor right ankle. If tight, use a small heel elevation. Start with 140lb. · Progress: Add 5lb when all sets hit 8 reps at RPE 8. · Swap if needed: High Bar Squat$q$, $q$Monitor right ankle. If tight, use a small heel elevation. · Progress: Add 5lb when all sets hit 8 reps at RPE 8. · Swap if needed: High Bar Squat$q$),
    ($q$Start with 75lb. Great for quad volume without ankle/back stress. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$, $q$Great for quad volume without ankle/back stress. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$),
    ($q$Station 2: Belt Squat. High-value quad volume without spinal loading. · Progress: Double progression. Start with 85lb. · Swap if needed: Landmine Belt Squat$q$, $q$Station 2: Belt Squat. High-value quad volume without spinal loading. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$),
    ($q$Station 2. Superset with the split squats. Use 45lb DB. · Progress: Double progression.$q$, $q$Station 2. Superset with the split squats. · Progress: Double progression.$q$),
    ($q$Station 2. Use 45lb DB. · Progress: Double progression.$q$, $q$Station 2. · Progress: Double progression.$q$)
), scope AS (
  SELECT r.id, r.notes AS old_notes, m.new_notes
  FROM public.pl_exercise_rows r
  JOIN map m ON m.old_notes = r.notes
  JOIN public.pl_days d ON d.id = r.day_id
  JOIN public.pl_weeks w ON w.id = d.week_id
  WHERE w.block_id IN ('8eafa1a8-298b-4efd-9eb4-28e3872fb536', 'd844a77f-61c9-439c-9188-3728be9130e7', 'e83859f9-eabf-4247-aaad-3c26e737f5f4', '2a67e938-8c2a-4615-8d64-b26086679746')
), saved AS (
  INSERT INTO public.program_note_weight_backup (row_id, old_notes, new_notes)
  SELECT id, old_notes, new_notes FROM scope
  ON CONFLICT (row_id) DO NOTHING
  RETURNING row_id
)
UPDATE public.pl_exercise_rows r
SET notes = s.new_notes, updated_at = now()
FROM scope s
WHERE r.id = s.id AND r.notes = s.old_notes;
