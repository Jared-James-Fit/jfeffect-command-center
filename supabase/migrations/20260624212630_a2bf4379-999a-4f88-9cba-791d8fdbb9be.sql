-- ============================================================
-- 12 Three-Day Full-Body Bodybuilding Programs (v2 payload)
-- Skips any template whose name already exists.
-- ============================================================

DO $$
DECLARE
  prog jsonb;
  v_id uuid;
  v_payload jsonb;
  v_blocks jsonb;
  v_weeks jsonb;
  v_days jsonb;
  v_rows jsonb;
  ex_names text[];
  block_names text[] := ARRAY[
    'Block 1 — Accumulation',
    'Block 2 — Overload',
    'Block 3 — Intensification'
  ];
  bi int; wi int; di int; ri int;
  programs jsonb := $j$[
    {"name":"Full-Body Foundation","focus":"Beginner","goal":"Learn movement patterns and build balanced muscle",
      "d1":["Leg Press","Machine Chest Press","Neutral-Grip Lat Pulldown","Seated Leg Curl","Cable Lateral Raise","Cable Curl","Standing Calf Raise"],
      "d2":["Dumbbell Romanian Deadlift","Incline Dumbbell Press","Chest-Supported Machine Row","Leg Extension","Machine Shoulder Press","Rope Triceps Pressdown","Cable Crunch"],
      "d3":["Hack Squat","Machine Hip Thrust","Seated Cable Row","Machine Pec Deck","Machine Rear-Delt Fly","Dumbbell Hammer Curl","Overhead Cable Triceps Extension"]},
    {"name":"Machine-Based Muscle Builder","focus":"Beginner","goal":"Build muscle safely using guided machines",
      "d1":["Leg Press","Machine Chest Press","Lat Pulldown","Seated Leg Curl","Machine Shoulder Press","Cable Curl","Triceps Pressdown"],
      "d2":["Hack Squat","Machine Pec Deck","Machine Row","Leg Extension","Machine Lateral Raise","Machine Preacher Curl","Machine Triceps Dip"],
      "d3":["Machine Hip Thrust","Incline Chest Press Machine","Machine Pullover","Glute Kickback Machine","Machine Rear-Delt Fly","Cable Hammer Curl","Overhead Cable Triceps Extension"]},
    {"name":"Free-Weight Skill Builder","focus":"Beginner","goal":"Learn free-weight technique and build base strength",
      "d1":["Goblet Squat","Dumbbell Bench Press","Dumbbell Row","Dumbbell Romanian Deadlift","Dumbbell Lateral Raise","Dumbbell Curl","Dumbbell Calf Raise"],
      "d2":["Dumbbell Lunge","Incline Dumbbell Press","Assisted Pull-up","Dumbbell Hip Thrust","Dumbbell Shoulder Press","Dumbbell Hammer Curl","Dumbbell Skullcrusher"],
      "d3":["Back Squat","Bench Press","Bent-Over Row","Romanian Deadlift","Standing Overhead Press","Barbell Curl","Close-Grip Bench Press"]},
    {"name":"Balanced Hypertrophy","focus":"Intermediate","goal":"Add quality muscle across all body parts",
      "d1":["Back Squat","Bench Press","Lat Pulldown","Seated Leg Curl","Dumbbell Lateral Raise","EZ-Bar Curl","Standing Calf Raise"],
      "d2":["Romanian Deadlift","Incline Dumbbell Press","Chest-Supported Row","Leg Extension","Cable Lateral Raise","Cable Triceps Pressdown","Cable Crunch"],
      "d3":["Hack Squat","Dumbbell Shoulder Press","Seated Cable Row","Machine Pec Deck","Rear-Delt Fly","Hammer Curl","Overhead Triceps Extension"]},
    {"name":"Full-Body Powerbuilding","focus":"Intermediate","goal":"Build size and strength on the big lifts",
      "d1":["Back Squat","Bench Press","Barbell Row","Dumbbell Lateral Raise","EZ-Bar Curl","Standing Calf Raise"],
      "d2":["Deadlift","Overhead Press","Pull-up","Leg Extension","Cable Lateral Raise","Skullcrusher"],
      "d3":["Front Squat","Incline Bench Press","Pendlay Row","Romanian Deadlift","Hammer Curl","Triceps Pushdown"]},
    {"name":"V-Taper Full Body","focus":"Intermediate","goal":"Widen lats and shoulders for a V-taper",
      "d1":["Pull-up","Lat Pulldown","Bench Press","Dumbbell Lateral Raise","Back Squat","Standing Calf Raise","Cable Curl"],
      "d2":["Wide-Grip Cable Row","T-Bar Row","Overhead Press","Cable Lateral Raise","Romanian Deadlift","Rear-Delt Fly","Triceps Pressdown"],
      "d3":["Chin-up","Seal Row","Incline Dumbbell Press","Cable Y-Raise","Bulgarian Split Squat","Hammer Curl"]},
    {"name":"Advanced Balanced Full Body","focus":"Advanced","goal":"Advanced hypertrophy with balanced volume",
      "d1":["Back Squat","Bench Press","Pendlay Row","Romanian Deadlift","Dumbbell Lateral Raise","EZ-Bar Curl","Standing Calf Raise"],
      "d2":["Front Squat","Incline Bench Press","Weighted Pull-up","Glute Ham Raise","Cable Lateral Raise","Skullcrusher","Cable Crunch"],
      "d3":["Deadlift","Overhead Press","T-Bar Row","Seated Leg Curl","Rear-Delt Fly","Hammer Curl","Overhead Triceps Extension"]},
    {"name":"Advanced Lower-Body Specialization","focus":"Advanced","goal":"Bring up legs while maintaining upper body",
      "d1":["Back Squat","Leg Press","Bulgarian Split Squat","Leg Extension","Lying Leg Curl","Standing Calf Raise","Bench Press"],
      "d2":["Deadlift","Hack Squat","Romanian Deadlift","Walking Lunge","Seated Leg Curl","Seated Calf Raise","Lat Pulldown"],
      "d3":["Front Squat","Machine Hip Thrust","Sissy Squat","Glute Ham Raise","Adductor Machine","Tibialis Raise","Overhead Press"]},
    {"name":"Advanced Upper-Body Specialization","focus":"Advanced","goal":"Bring up upper body while maintaining legs",
      "d1":["Bench Press","Weighted Pull-up","Incline Dumbbell Press","T-Bar Row","Overhead Press","EZ-Bar Curl","Skullcrusher"],
      "d2":["Overhead Press","Weighted Chin-up","Dip","Seal Row","Dumbbell Lateral Raise","Hammer Curl","Triceps Pressdown"],
      "d3":["Incline Bench Press","Wide-Grip Pull-up","Cable Crossover","Chest-Supported Row","Cable Lateral Raise","Preacher Curl","Overhead Triceps Extension"]},
    {"name":"Advanced-Elite Delts and Arms Specialization","focus":"Advanced-Elite","goal":"Maximize delt and arm development",
      "d1":["Overhead Press","Cable Lateral Raise","Rear-Delt Fly","EZ-Bar Curl","Skullcrusher","Hammer Curl","Cable Triceps Pressdown"],
      "d2":["Dumbbell Shoulder Press","Lateral Raise Drop Set","Reverse Pec Deck","Preacher Curl","Close-Grip Bench Press","Cable Curl","Overhead Cable Triceps Extension"],
      "d3":["Push Press","Cable Y-Raise","Face Pull","Spider Curl","Weighted Dip","Concentration Curl","Rope Triceps Pressdown"]},
    {"name":"Advanced-Elite Powerbuilding Bodybuilder","focus":"Advanced-Elite","goal":"Elite-level size and strength integration",
      "d1":["Back Squat","Bench Press","Barbell Row","Dumbbell Lateral Raise","EZ-Bar Curl","Skullcrusher"],
      "d2":["Deadlift","Overhead Press","Weighted Pull-up","Romanian Deadlift","Hammer Curl","Triceps Pressdown"],
      "d3":["Front Squat","Incline Bench Press","Pendlay Row","Cable Lateral Raise","Preacher Curl","Overhead Triceps Extension"]},
    {"name":"Advanced-Elite Autoregulated Complete Physique","focus":"Advanced-Elite","goal":"RPE-driven complete physique development",
      "d1":["Back Squat @ RPE 8","Bench Press @ RPE 8","Pendlay Row","Dumbbell Lateral Raise","EZ-Bar Curl","Skullcrusher","Standing Calf Raise"],
      "d2":["Deadlift @ RPE 8","Overhead Press @ RPE 8","Weighted Pull-up","Romanian Deadlift","Cable Lateral Raise","Hammer Curl","Cable Crunch"],
      "d3":["Front Squat","Incline Bench Press","T-Bar Row","Seated Leg Curl","Rear-Delt Fly","Preacher Curl","Overhead Triceps Extension"]}
  ]$j$::jsonb;
BEGIN
  FOR prog IN SELECT * FROM jsonb_array_elements(programs)
  LOOP
    IF EXISTS (SELECT 1 FROM public.pl_templates WHERE name = prog->>'name') THEN
      CONTINUE;
    END IF;

    v_blocks := '[]'::jsonb;
    FOR bi IN 0..2 LOOP
      v_weeks := '[]'::jsonb;
      FOR wi IN 0..3 LOOP
        v_days := '[]'::jsonb;
        FOR di IN 1..3 LOOP
          ex_names := ARRAY(SELECT jsonb_array_elements_text(
            CASE di WHEN 1 THEN prog->'d1' WHEN 2 THEN prog->'d2' ELSE prog->'d3' END
          ));
          v_rows := '[]'::jsonb;
          FOR ri IN 1..array_length(ex_names, 1) LOOP
            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'id', gen_random_uuid(),
              'title', ex_names[ri],
              'sort_order', ri - 1,
              'notes', '',
              'sets', null,
              'reps', null,
              'weight', null,
              'rpe', null,
              'rir', null,
              'time_seconds', null,
              'deleted_at', null
            ));
          END LOOP;
          v_days := v_days || jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid(),
            'day_index', di,
            'title', 'Day ' || di,
            'rows', v_rows,
            'deleted_at', null
          ));
        END LOOP;
        v_weeks := v_weeks || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(),
          'week_index', wi,
          'days', v_days
        ));
      END LOOP;
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'name', block_names[bi + 1],
        'order_index', bi,
        'weeks', v_weeks
      ));
    END LOOP;

    v_payload := jsonb_build_object('schema_version', '2', 'blocks', v_blocks);

    INSERT INTO public.pl_templates (
      id, name, template_type, training_style, training_focus,
      tags, status, weeks, days_per_week, est_duration_min,
      goal, notes, payload, archived
    ) VALUES (
      gen_random_uuid(),
      prog->>'name',
      'full_prep',
      'bodybuilding',
      prog->>'focus',
      ARRAY['bodybuilding','full-body','3-day']::text[],
      'Published',
      12, 3, 60,
      prog->>'goal',
      '3-Day Full-Body Bodybuilding. Block 1 (Weeks 1-4) Accumulation, Block 2 (Weeks 5-8) Overload, Block 3 (Weeks 9-12) Intensification.',
      v_payload,
      false
    )
    RETURNING id INTO v_id;

    INSERT INTO public.pl_template_shares (template_id, destination, status, shared_version)
    VALUES (v_id, 'membership', 'shared', 1);
  END LOOP;
END $$;