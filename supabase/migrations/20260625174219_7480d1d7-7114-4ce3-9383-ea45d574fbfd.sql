DO $$
DECLARE
  prog jsonb;
  block_names text[] := ARRAY['Accumulation', 'Overload', 'Intensification'];
  scheme_sets int[] := ARRAY[3, 4, 4];
  scheme_reps text[] := ARRAY['8-12', '6-10', '4-8'];
  v_payload jsonb;
  v_blocks jsonb;
  v_weeks jsonb;
  v_days jsonb;
  v_rows jsonb;
  v_template_id uuid;
  ex_names text[];
  bi int; wi int; di int; ri int;
  programs jsonb := $j$[
    {"name":"Full Body Foundation — Beginner • 3-Day • Bodybuilding",
      "d1":["Leg Press","Machine Chest Press","Neutral-Grip Lat Pulldown","Seated Leg Curl","Cable Lateral Raise","Cable Curl","Standing Calf Raise"],
      "d2":["Dumbbell Romanian Deadlift","Incline Dumbbell Press","Chest-Supported Machine Row","Leg Extension","Machine Shoulder Press","Rope Triceps Pressdown","Cable Crunch"],
      "d3":["Hack Squat","Machine Hip Thrust","Seated Cable Row","Machine Pec Deck","Machine Rear-Delt Fly","Dumbbell Hammer Curl","Overhead Cable Triceps Extension"]},
    {"name":"Machine Muscle Builder — Beginner • 3-Day • Full Body",
      "d1":["Leg Press","Machine Chest Press","Lat Pulldown","Seated Leg Curl","Machine Shoulder Press","Cable Curl","Triceps Pressdown"],
      "d2":["Hack Squat","Machine Pec Deck","Machine Row","Leg Extension","Machine Lateral Raise","Machine Preacher Curl","Machine Triceps Dip"],
      "d3":["Machine Hip Thrust","Incline Chest Press Machine","Machine Pullover","Glute Kickback Machine","Machine Rear-Delt Fly","Cable Hammer Curl","Overhead Cable Triceps Extension"]},
    {"name":"Free-Weight Skill Builder — Beginner • 3-Day • Bodybuilding",
      "d1":["Goblet Squat","Dumbbell Bench Press","Dumbbell Row","Dumbbell Romanian Deadlift","Dumbbell Lateral Raise","Dumbbell Curl","Dumbbell Calf Raise"],
      "d2":["Dumbbell Lunge","Incline Dumbbell Press","Assisted Pull-up","Dumbbell Hip Thrust","Dumbbell Shoulder Press","Dumbbell Hammer Curl","Dumbbell Skullcrusher"],
      "d3":["Back Squat","Bench Press","Bent-Over Row","Romanian Deadlift","Standing Overhead Press","Barbell Curl","Close-Grip Bench Press"]},
    {"name":"Balanced Hypertrophy — Intermediate • 3-Day • Bodybuilding",
      "d1":["Back Squat","Bench Press","Lat Pulldown","Seated Leg Curl","Dumbbell Lateral Raise","EZ-Bar Curl","Standing Calf Raise"],
      "d2":["Romanian Deadlift","Incline Dumbbell Press","Chest-Supported Row","Leg Extension","Cable Lateral Raise","Cable Triceps Pressdown","Cable Crunch"],
      "d3":["Hack Squat","Dumbbell Shoulder Press","Seated Cable Row","Machine Pec Deck","Rear-Delt Fly","Hammer Curl","Overhead Triceps Extension"]},
    {"name":"Full-Body Powerbuilding — Intermediate • 3-Day • Powerbuilding",
      "d1":["Back Squat","Bench Press","Barbell Row","Dumbbell Lateral Raise","EZ-Bar Curl","Standing Calf Raise"],
      "d2":["Deadlift","Overhead Press","Pull-up","Leg Extension","Cable Lateral Raise","Skullcrusher"],
      "d3":["Front Squat","Incline Bench Press","Pendlay Row","Romanian Deadlift","Hammer Curl","Triceps Pushdown"]},
    {"name":"V-Taper Focus — Intermediate • 3-Day • Bodybuilding",
      "d1":["Pull-up","Lat Pulldown","Bench Press","Dumbbell Lateral Raise","Back Squat","Standing Calf Raise","Cable Curl"],
      "d2":["Wide-Grip Cable Row","T-Bar Row","Overhead Press","Cable Lateral Raise","Romanian Deadlift","Rear-Delt Fly","Triceps Pressdown"],
      "d3":["Chin-up","Seal Row","Incline Dumbbell Press","Cable Y-Raise","Bulgarian Split Squat","Hammer Curl"]},
    {"name":"Balanced Full Body — Advanced • 3-Day • Bodybuilding",
      "d1":["Back Squat","Bench Press","Pendlay Row","Romanian Deadlift","Dumbbell Lateral Raise","EZ-Bar Curl","Standing Calf Raise"],
      "d2":["Front Squat","Incline Bench Press","Weighted Pull-up","Glute Ham Raise","Cable Lateral Raise","Skullcrusher","Cable Crunch"],
      "d3":["Deadlift","Overhead Press","T-Bar Row","Seated Leg Curl","Rear-Delt Fly","Hammer Curl","Overhead Triceps Extension"]},
    {"name":"Lower-Body Specialization — Advanced • 3-Day • Bodybuilding",
      "d1":["Back Squat","Leg Press","Bulgarian Split Squat","Leg Extension","Lying Leg Curl","Standing Calf Raise","Bench Press"],
      "d2":["Deadlift","Hack Squat","Romanian Deadlift","Walking Lunge","Seated Leg Curl","Seated Calf Raise","Lat Pulldown"],
      "d3":["Front Squat","Machine Hip Thrust","Sissy Squat","Glute Ham Raise","Adductor Machine","Tibialis Raise","Overhead Press"]},
    {"name":"Upper-Body Specialization — Advanced • 3-Day • Bodybuilding",
      "d1":["Bench Press","Weighted Pull-up","Incline Dumbbell Press","T-Bar Row","Overhead Press","EZ-Bar Curl","Skullcrusher"],
      "d2":["Overhead Press","Weighted Chin-up","Dip","Seal Row","Dumbbell Lateral Raise","Hammer Curl","Triceps Pressdown"],
      "d3":["Incline Bench Press","Wide-Grip Pull-up","Cable Crossover","Chest-Supported Row","Cable Lateral Raise","Preacher Curl","Overhead Triceps Extension"]},
    {"name":"Delts and Arms Specialization — Advanced–Elite • 3-Day • Bodybuilding",
      "d1":["Overhead Press","Dumbbell Lateral Raise","Cable Lateral Raise","Rear-Delt Fly","EZ-Bar Curl","Incline Dumbbell Curl","Skullcrusher","Overhead Triceps Extension"],
      "d2":["Back Squat","Bench Press","Lat Pulldown","Seated Cable Row","Hammer Curl","Preacher Curl","Triceps Pushdown","Dip"],
      "d3":["Romanian Deadlift","Incline Bench Press","Weighted Pull-up","Cable Y-Raise","Barbell Curl","Concentration Curl","Close-Grip Bench Press","Cable Overhead Triceps"]},
    {"name":"Powerbuilding Bodybuilder — Advanced–Elite • 3-Day • Powerbuilding",
      "d1":["Back Squat","Bench Press","Barbell Row","Dumbbell Lateral Raise","EZ-Bar Curl","Skullcrusher"],
      "d2":["Deadlift","Overhead Press","Weighted Pull-up","Romanian Deadlift","Hammer Curl","Triceps Pressdown"],
      "d3":["Front Squat","Incline Bench Press","Pendlay Row","Cable Lateral Raise","Preacher Curl","Overhead Triceps Extension"]},
    {"name":"Autoregulated Complete Physique — Advanced–Elite • 3-Day • Full Body",
      "d1":["Back Squat","Bench Press","Pendlay Row","Dumbbell Lateral Raise","EZ-Bar Curl","Skullcrusher","Standing Calf Raise"],
      "d2":["Deadlift","Overhead Press","Weighted Pull-up","Romanian Deadlift","Cable Lateral Raise","Hammer Curl","Cable Crunch"],
      "d3":["Front Squat","Incline Bench Press","T-Bar Row","Seated Leg Curl","Rear-Delt Fly","Preacher Curl","Overhead Triceps Extension"]}
  ]$j$::jsonb;
BEGIN
  FOR prog IN SELECT value FROM jsonb_array_elements(programs)
  LOOP
    DELETE FROM public.pl_template_shares
      WHERE template_id IN (SELECT id FROM public.pl_templates WHERE name = prog->>'name');
    DELETE FROM public.pl_templates WHERE name = prog->>'name';

    v_blocks := '[]'::jsonb;
    FOR bi IN 0..2 LOOP
      v_weeks := '[]'::jsonb;
      FOR wi IN 1..4 LOOP
        v_days := '[]'::jsonb;
        FOR di IN 1..3 LOOP
          ex_names := ARRAY(SELECT jsonb_array_elements_text(
            CASE di WHEN 1 THEN prog->'d1' WHEN 2 THEN prog->'d2' ELSE prog->'d3' END
          ));
          v_rows := '[]'::jsonb;
          FOR ri IN 1..array_length(ex_names, 1) LOOP
            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'sort_order', ri - 1,
              'exercise_name_override', ex_names[ri],
              'sets', scheme_sets[bi + 1],
              'reps_text', scheme_reps[bi + 1],
              'rpe', null,
              'rir', null,
              'notes', ''
            ));
          END LOOP;
          v_days := v_days || jsonb_build_array(jsonb_build_object(
            'day_index', di, 'title', 'Day ' || di, 'notes', '', 'rows', v_rows
          ));
        END LOOP;
        v_weeks := v_weeks || jsonb_build_array(jsonb_build_object(
          'week_index', wi, 'notes', '', 'days', v_days
        ));
      END LOOP;
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', block_names[bi + 1],
        'order_index', bi,
        'phase', null, 'notes', '', 'archived', false,
        'archived_at', null, 'deleted_at', null, 'estimated_minutes', null,
        'weeks', v_weeks
      ));
    END LOOP;

    v_payload := jsonb_build_object('schema_version', 2, 'blocks', v_blocks);
    v_template_id := gen_random_uuid();

    INSERT INTO public.pl_templates (
      id, name, template_type, training_style, training_focus,
      tags, status, weeks, days_per_week, est_duration_min,
      goal, notes, payload, archived
    ) VALUES (
      v_template_id,
      prog->>'name',
      'block',
      'bodybuilding',
      CASE
        WHEN prog->>'name' LIKE '%Beginner%' THEN 'Beginner'
        WHEN prog->>'name' LIKE '%Intermediate%' THEN 'Intermediate'
        WHEN prog->>'name' LIKE '%Advanced–Elite%' THEN 'Advanced-Elite'
        WHEN prog->>'name' LIKE '%Advanced%' THEN 'Advanced'
        ELSE 'All Levels'
      END,
      ARRAY['bodybuilding','full-body','3-day']::text[],
      'Published',
      12, 3, 60,
      'Full-body bodybuilding program with 3 blocks: Accumulation, Overload, Intensification.',
      '3-Day Full-Body Bodybuilding. Block 1 (Weeks 1-4) Accumulation 3x8-12, Block 2 (Weeks 5-8) Overload 4x6-10, Block 3 (Weeks 9-12) Intensification 4x4-8.',
      v_payload,
      false
    );

    INSERT INTO public.pl_template_shares (template_id, destination, status)
    VALUES (v_template_id, 'membership', 'shared');
  END LOOP;
END $$;