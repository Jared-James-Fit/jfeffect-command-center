-- Nutrition Update Request: ask when the client trains and how they like to
-- eat around it, so the AI can build labelled Pre-/Post-Workout meals.
DO $$
DECLARE
  f uuid := 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nf_questions WHERE id = 'c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e01') THEN
    UPDATE public.nf_questions SET order_index = order_index + 2
      WHERE form_id = f AND order_index >= 12;
    INSERT INTO public.nf_questions (id, form_id, label, help_text, question_type, options, required, order_index)
    VALUES
      ('c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e01', f,
       'What time do you usually train?',
       'Used to place your pre- and post-workout meals',
       'dropdown',
       '["Early morning (before 8am)","Morning (8–11am)","Midday (11am–2pm)","Afternoon (2–5pm)","Evening (5–8pm)","Night (after 8pm)","It varies"]'::jsonb,
       true, 12),
      ('c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e02', f,
       'How do you like to eat before training?',
       NULL,
       'dropdown',
       '["Full meal 1–2 hours before","Small snack 30–60 min before","I train fasted / on an empty stomach","No preference — whatever works best"]'::jsonb,
       true, 13);
  END IF;
END $$;

-- Coach's pre/post-workout meal choice used for each AI plan.
ALTER TABLE public.nutrition_ai_plans
  ADD COLUMN IF NOT EXISTS workout_meals text
  CHECK (workout_meals IS NULL OR workout_meals IN ('auto','pre_post','post_only','pre_only','none'));
