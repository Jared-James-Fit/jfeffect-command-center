-- Lesson diagrams that show each lesson's actual problem (lesson-visuals.tsx):
-- heels coming up gets the balance picture, hips shooting up out of the hole
-- gets hips-vs-bar rise, the depth check gets the hip crease vs knee picture,
-- and so on; the RPE chart no longer stands in for lessons it doesn't explain.
-- Each change applies only while the lesson still has the diagram it was
-- seeded with, so a coach's own edit is never overwritten. Safe to run twice.
WITH v(key, old_visual, new_visual) AS (
  VALUES
    ('squat-heels-lift', '{"kind": "bar_path", "lift": "squat", "fault": "forward"}'::jsonb, '{"kind": "squat_balance"}'::jsonb),
    ('squat-good-morning', '{"kind": "squat_torso"}', '{"kind": "squat_rise"}'),
    ('squat-depth-check', NULL, '{"kind": "squat_depth"}'),
    ('squat-torso-angle-max', '{"kind": "squat_torso"}', '{"kind": "squat_torso", "variant": "lean"}'),
    ('moment-arms-build', '{"kind": "squat_torso"}', '{"kind": "squat_torso", "variant": "build"}'),
    ('bench-touch-point-inconsistent', '{"kind": "bar_path", "lift": "bench", "fault": "none"}', '{"kind": "bench_touch", "variant": "consistency"}'),
    ('methods-myo-reps', '{"kind": "rpe_rir"}', '{"kind": "set_structure", "variant": "myo"}'),
    ('methods-cluster-sets', '{"kind": "velocity_loss"}', '{"kind": "velocity_loss", "variant": "cluster"}'),
    ('life-stress-and-gains', '{"kind": "sra"}', '{"kind": "sra", "variant": "stress"}'),
    ('training-log-review', '{"kind": "rpe_rir"}', NULL)
)
UPDATE public.community_series_items i
   SET data = CASE WHEN v.new_visual IS NULL THEN i.data - 'visual' ELSE jsonb_set(i.data, '{visual}', v.new_visual) END,
       updated_at = now()
  FROM v
 WHERE i.series = 'lesson'
   AND i.data->>'key' = v.key
   AND (i.data->'visual') IS NOT DISTINCT FROM v.old_visual;
