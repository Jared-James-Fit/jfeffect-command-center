-- Exercise demos: an exercise with no video of its own can borrow the demo of
-- the same movement (Paused Bench Press -> Barbell Bench Press, Leg Press ->
-- Leg Press Machine), so the How To never says "coming soon" for a lift we
-- already have on film. Its own upload always wins: the borrowed demo is only
-- used while the row has no video, and the sheet says whose demo it is.
alter table public.exercises
  add column if not exists demo_exercise_id uuid references public.exercises(id) on delete set null;

do $$ begin
  alter table public.exercises add constraint exercises_demo_not_self check (demo_exercise_id is null or demo_exercise_id <> id);
exception when duplicate_object then null; end $$;

comment on column public.exercises.demo_exercise_id is
  'Borrowed demo: while this exercise has no video of its own, How To plays this exercise''s demo (labelled).';

-- The most-programmed exercises with no upload yet, each paired by hand with
-- the same movement (exact names, both unique; the demo side has a video).
-- Only fills rows that still have no video and no pairing.
with pairs(missing, demo) as (values
  ('Overhead Cable Triceps Extension', 'Cable Triceps Overhead Extension (Ez Bar)'),
  ('Standing Calf Raise - Machine', 'Smith Machine Calf Raise'),
  ('Incline Dumbbell Press', 'Incline Bench Press - Dumbbell'),
  ('Leg Press', 'Leg Press Machine'),
  ('Seated Calf Raise', 'Seated Calf Machine'),
  ('Preacher Curl', 'Barbell Preacher Curl'),
  ('Cable Curl', 'Straight Bar Cable Curl'),
  ('Dumbbell Reverse Lunge', 'Dumbbell Reverse Lunge On The Spot'),
  ('Kneeling Push-Up or Full Push-Up', 'Kneeling Push Up'),
  ('Dumbbell Curl', 'Dumbbell Alternate Biceps Curl'),
  ('Decline Sit-Ups', 'Bench Decline Ab Sit Ups'),
  ('Cable Fly', 'Cable Middle Fly'),
  ('3-0-0 Tempo to Knee Sumo Deadlift', 'Barbell Sumo Deadlift'),
  ('2-Second Pause-at-Knee Sumo Deadlift', 'Barbell Sumo Deadlift'),
  ('Paused Bench Press', 'Barbell Bench Press'),
  ('2-Count Pause Bench Press', 'Barbell Bench Press'),
  ('3-Count Pause Bench Press', 'Barbell Bench Press'),
  ('TNG Bench Press', 'Barbell Bench Press'),
  ('Touch and Go Bench Press', 'Barbell Bench Press'),
  ('Bench Hamstring Curl Attachment', 'Lying Hamstring Curl - Machine'),
  ('Bench Leg Extension Attachment', 'Leg Extension - Machine'),
  ('Conventional Deadlift', 'Barbell Deadlift'),
  ('Two-Count Paused Conventional Deadlift Below Knee', 'Barbell Deadlift'),
  ('Two-Count Paused Deadlift', 'Barbell Deadlift'),
  ('2-Count Paused Deadlift Below Knee', 'Barbell Deadlift'),
  ('2-Count Paused Deadlift', 'Barbell Deadlift'),
  ('Paused Deadlift', 'Barbell Deadlift'),
  ('Paused Dumbbell Floor Press', 'Floor Press'),
  ('Chest Supported Row', 'Chest Supported Dumbbell Row'),
  ('Pallof Press', 'Band Pallof Press'),
  ('Wall Sit', 'Wall Sit Bodyweight'),
  ('Spoto Press', 'Barbell Spoto Press'),
  ('Spoto Press 1"', 'Barbell Spoto Press'),
  ('Spotto Press 1"', 'Barbell Spoto Press'),
  ('Dumbbell Russian Twist', 'Dumbbell Russian Twist With Legs Floor Off'),
  ('Dumbbell Shoulder Press', 'Seated Shoulder Press - Dumbbell'),
  ('High Step-Up', 'Dumbbell Step Up On Bench'),
  ('Landmine Belt Squat', 'Belt Squat'),
  ('Pec Deck', 'Pec Deck Fly Machine Flies'),
  ('Cable Pullover', 'Cable Lat Pullover'),
  ('Dumbbell Floor Skull Crusher', 'Dumbbell Skullcrusher'),
  ('Band Leg Curl', 'Resistance Band Leg Curl'),
  ('2-Count Paused Squat', 'Barbell Squat With 2 Sec Hold'),
  ('2-Count Pause Squat', 'Barbell Squat With 2 Sec Hold'),
  ('Paused Squat', 'Barbell Squat With 2 Sec Hold'),
  ('3-0-0 Tempo Squat', 'Barbell Full Squat'),
  ('3-Second Tempo Squat', 'Barbell Full Squat'),
  ('Front-Foot-Elevated Split Squat — Long Stride', 'Dumbbell Goblet Split Squat Front Foot Elevanted'),
  ('Weighted Pull-Up', 'Pull Up Normal Grip'),
  ('Barbell Shoulder Press', 'Barbell Shoulder Press - Standing'),
  ('45-Degree Glute Hyperextension', '45-Degree Back Extension'),
  ('Adductor Machine', 'Seated Machine Hip Adductor'),
  ('Weighted Dead Bug', 'Dead Bug'),
  ('Push-Up', 'Normal Push Up'),
  ('Band Pull-Apart', 'Resistance Band Pull Apart'),
  ('Box Squat', 'Barbell Box Squat'),
  ('Single-Arm Low Cable Lateral Raise', 'Cable Lateral Raises')
)
update public.exercises e
set demo_exercise_id = d.id
from pairs p
join public.exercises d on d.name = p.demo and coalesce(d.archived, false) = false and coalesce(d.vimeo_embed_url, '') <> ''
where e.name = p.missing
  and coalesce(e.archived, false) = false
  and e.demo_exercise_id is null
  and coalesce(e.vimeo_embed_url, '') = ''
  and coalesce(e.video_url, '') = '';
