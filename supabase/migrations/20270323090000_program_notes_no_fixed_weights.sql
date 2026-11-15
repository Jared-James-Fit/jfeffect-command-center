-- Nov 15 2026: notes Generate Next Program wrote on Nov 2 carried a fixed weight to lift
-- ("Start ~430lb", "Start with 145lb (last block's top set)", "Use 50lb DBs"), repeated on
-- every week of the block. Nicolas Galli's "Start ~430lb" deadlift came from his Oct 10
-- 205 lb set stored as 205 kg (repaired Nov 8); the note kept it. The same cleaning as
-- withoutFixedLoads (src/lib/program-intel/loading.ts), which now runs on every generated
-- block, takes the weight out: on workouts with nothing logged, and on Nicolas's deadlift
-- everywhere (the number is wrong). Only notes still exactly as the program wrote them
-- change; the old text is kept in program_note_weight_backup (no client or staff access).

CREATE TABLE IF NOT EXISTS public.program_note_weight_backup (
  row_id uuid PRIMARY KEY,
  old_notes text NOT NULL,
  new_notes text,
  fixed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_note_weight_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_note_weight_backup FROM anon, authenticated;

WITH map(old_notes, new_notes) AS (
  VALUES
    ($q$Superset with the close-grip pulldown: bench, rest 60s, pulldown, rest 75s, then bench again. · Watch left wrist comfort. Start with 110lb. · Progress: Add 2.5-5lb when all sets hit 8 reps. · Swap if needed: Touch and Go Bench Press$q$, $q$Superset with the close-grip pulldown: bench, rest 60s, pulldown, rest 75s, then bench again. · Watch left wrist comfort. · Progress: Add 2.5-5lb when all sets hit 8 reps. · Swap if needed: Touch and Go Bench Press$q$),
    ($q$Superset with lateral raises: RDL, rest 60s, lateral raises, rest 60s, then RDL again. · Start with 135lb. Focus on hip hinge depth. · Progress: Add 5lb when all sets hit 12 reps. · Swap if needed: Barbell Romanian Deadlift$q$, $q$Superset with lateral raises: RDL, rest 60s, lateral raises, rest 60s, then RDL again. Focus on hip hinge depth. · Progress: Add 5lb when all sets hit 12 reps. · Swap if needed: Barbell Romanian Deadlift$q$),
    ($q$Keep the momentum! Start with 95lb. · Progress: Add 2.5-5lb when 12 reps reached. · Swap if needed: Single-Arm Bent-Over Dumbbell Row$q$, $q$Keep the momentum! · Progress: Add 2.5-5lb when 12 reps reached. · Swap if needed: Single-Arm Bent-Over Dumbbell Row$q$),
    ($q$Superset with the cable row: DB press, rest 60s, cable row, rest 75s, then DB press again. · Start with 35lb DBs. Focus on deep stretch. · Progress: Increase DB weight when 12 reps reached. · Swap if needed: Flat Bench Press - Dumbbell$q$, $q$Superset with the cable row: DB press, rest 60s, cable row, rest 75s, then DB press again. Focus on deep stretch. · Progress: Increase DB weight when 12 reps reached. · Swap if needed: Flat Bench Press - Dumbbell$q$),
    ($q$Superset with the DB press. · Start with 80lb. Squeeze shoulder blades. · Progress: Double progression. · Swap if needed: Seated Cable Row V Bar Machine$q$, $q$Superset with the DB press. Squeeze shoulder blades. · Progress: Double progression. · Swap if needed: Seated Cable Row V Bar Machine$q$),
    ($q$Start with 40lb DBs. Keep DBs close to legs. · Progress: Double progression. · Swap if needed: Dumbbell Stiff Leg Deadlift$q$, $q$Keep DBs close to legs. · Progress: Double progression. · Swap if needed: Dumbbell Stiff Leg Deadlift$q$),
    ($q$Monitor right ankle. If tight, use a small heel elevation. Start with 140lb. · Progress: Add 5lb when all sets hit 8 reps at RPE 8. · Swap if needed: High Bar Squat$q$, $q$Monitor right ankle. If tight, use a small heel elevation. · Progress: Add 5lb when all sets hit 8 reps at RPE 8. · Swap if needed: High Bar Squat$q$),
    ($q$Superset with cable lateral raises: belt squat, rest 45s, lateral raises (both arms), rest 75s, then belt squat again. · Start with 75lb. Great for quad volume without ankle/back stress. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$, $q$Superset with cable lateral raises: belt squat, rest 45s, lateral raises (both arms), rest 75s, then belt squat again. Great for quad volume without ankle/back stress. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$),
    ($q$2-second pause at the top. Drive through heels. · Progress: Double progression. Start at 65lb. · Swap if needed: Hip Thrust Machine$q$, $q$2-second pause at the top. Drive through heels. · Progress: Double progression. · Swap if needed: Hip Thrust Machine$q$),
    ($q$Glute bias: long stride, slight forward lean. · Progress: Double progression. Start at 20lb. · Swap if needed: Dumbbell Reverse Lunge$q$, $q$Glute bias: long stride, slight forward lean. · Progress: Double progression. · Swap if needed: Dumbbell Reverse Lunge$q$),
    ($q$Superset with Lateral Raises to save time. · Progress: Double progression. Start at 35lb. · Swap if needed: Dumbbells Single Arm Row$q$, $q$Superset with Lateral Raises to save time. · Progress: Double progression. · Swap if needed: Dumbbells Single Arm Row$q$),
    ($q$Moved from Day 2 to Day 3 to meet 2x/week Back strategy and manage session time. · Progress: Double progression. Start at 15lb. · Swap if needed: Seated Cable Row V Bar Machine$q$, $q$Moved from Day 2 to Day 3 to meet 2x/week Back strategy and manage session time. · Progress: Double progression. · Swap if needed: Seated Cable Row V Bar Machine$q$),
    ($q$Slow eccentric to feel the stretch in glutes/hams. · Progress: Double progression. Start at 20lb. · Swap if needed: Single Leg Romanian Deadlift Dumbbell$q$, $q$Slow eccentric to feel the stretch in glutes/hams. · Progress: Double progression. · Swap if needed: Single Leg Romanian Deadlift Dumbbell$q$),
    ($q$Station 1. Start with 165lb (last block top set). Focus on bracing to protect low back. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 5lb if RPE is met.$q$, $q$Station 1. Focus on bracing to protect low back. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 5lb if RPE is met.$q$),
    ($q$Station 1. Start with 135lb. Priority lift. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 2.5-5lb if RPE is met.$q$, $q$Station 1. Priority lift. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 2.5-5lb if RPE is met.$q$),
    ($q$Station 2. Use 50lb DBs. Superset with calf raises: both legs, rest 30s, calf raises, rest 60s, then split squats again. · Progress: Double progression. Add weight when 12 reps are hit at RPE 8.$q$, $q$Station 2. Superset with calf raises: both legs, rest 30s, calf raises, rest 60s, then split squats again. · Progress: Double progression. Add weight when 12 reps are hit at RPE 8.$q$),
    ($q$Station 2. Superset with the split squats. Use 45lb DB. · Progress: Double progression.$q$, $q$Station 2. Superset with the split squats. · Progress: Double progression.$q$),
    ($q$Station 1: Rack. Start with 145lb (last block's top set). Focus on depth and bracing. · Progress: Add 5lb weekly if RPE ≤ target. · Swap if needed: High Bar Squat$q$, $q$Station 1: Rack. Focus on depth and bracing. · Progress: Add 5lb weekly if RPE ≤ target. · Swap if needed: High Bar Squat$q$),
    ($q$Station 1: Barbell. Start ~430lb. Focus on slack pull and wedge. · Progress: Add 5-10lb weekly if RPE ≤ target. · Swap if needed: Conventional Deadlift$q$, $q$Station 1: Barbell. Focus on slack pull and wedge. · Progress: Add 5-10lb weekly if RPE ≤ target. · Swap if needed: Conventional Deadlift$q$),
    ($q$Station 2: Belt Squat. High-value quad volume without spinal loading. · Progress: Double progression. Start with 85lb. · Swap if needed: Landmine Belt Squat$q$, $q$Station 2: Belt Squat. High-value quad volume without spinal loading. · Progress: Double progression. · Swap if needed: Landmine Belt Squat$q$),
    ($q$Station 3: Bench Attachment. Drop bench to flat. Start with 30lb. · Progress: Target 15 reps. Finish all sets before switching to extensions. · Swap if needed: Band Leg Curl$q$, $q$Station 3: Bench Attachment. Drop bench to flat. · Progress: Target 15 reps. Finish all sets before switching to extensions. · Swap if needed: Band Leg Curl$q$)
), scope AS (
  SELECT r.id, r.notes AS old_notes, m.new_notes
  FROM public.pl_exercise_rows r
  JOIN map m ON m.old_notes = r.notes
  JOIN public.pl_days d ON d.id = r.day_id
  JOIN public.pl_weeks w ON w.id = d.week_id
  JOIN public.pl_blocks b ON b.id = w.block_id
  WHERE b.id IN ('8eafa1a8-298b-4efd-9eb4-28e3872fb536', 'd844a77f-61c9-439c-9188-3728be9130e7', 'e83859f9-eabf-4247-aaad-3c26e737f5f4', '2a67e938-8c2a-4615-8d64-b26086679746')
    AND (NOT EXISTS (SELECT 1 FROM public.pl_row_results x WHERE x.row_id = r.id) OR r.notes LIKE '%Start ~430lb%')
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
