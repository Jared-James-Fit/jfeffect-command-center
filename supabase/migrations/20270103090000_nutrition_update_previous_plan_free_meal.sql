-- Nutrition Update Request, round 2:
-- 1. The AI adjusts from the plan the client was on (snapshotted on the AI
--    plan row the first time it runs, so a regenerate after the old plan was
--    replaced or deleted still sees it).
-- 2. What to do with their current meals (keep / swap / start fresh / first
--    plan, pre-answered "first plan" for clients without one), and which
--    swaps they want.
-- 3. A free meal on the High Day, or a fully planned High Day.

ALTER TABLE public.nutrition_ai_plans ADD COLUMN IF NOT EXISTS previous_plan jsonb;

DO $$
DECLARE
  f uuid := 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d';
  q_choice uuid := 'c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e04';
  q_swap uuid := 'c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e05';
  q_free uuid := 'c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e06';
  q_pick uuid := 'c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e07';
  after_idx int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.nf_forms WHERE id = f)
     OR EXISTS (SELECT 1 FROM public.nf_questions WHERE id = q_choice) THEN
    RETURN;
  END IF;

  -- Right after "List all of your foods + preferences" (else at the end).
  SELECT order_index INTO after_idx FROM public.nf_questions
   WHERE form_id = f AND archived_at IS NULL AND label ILIKE 'list all of your foods%'
   ORDER BY order_index LIMIT 1;
  IF after_idx IS NULL THEN
    SELECT coalesce(max(order_index), 0) INTO after_idx FROM public.nf_questions WHERE form_id = f;
  END IF;

  UPDATE public.nf_questions SET order_index = order_index + 4
   WHERE form_id = f AND order_index > after_idx;

  INSERT INTO public.nf_questions (id, form_id, label, help_text, question_type, options, required, order_index, validation, conditional_logic)
  VALUES
    (q_choice, f,
     'What should happen with the meals in your current plan?',
     'Your current meals are in the app under Nutrition.',
     'single_choice',
     '["Keep my meals (just update the numbers)","Swap some foods or meals","Start fresh with new meals","This is my first plan"]'::jsonb,
     true, after_idx + 1,
     '{"prefill":"nutrition_plan"}'::jsonb,
     '{}'::jsonb),
    (q_swap, f,
     'Which foods or meals do you want changed, and what would you rather have?',
     'e.g. "swap the rice cakes in meal 2 for a bagel" or "no more fish at dinner, chicken or beef instead"',
     'long_text',
     '[]'::jsonb,
     true, after_idx + 2,
     '{}'::jsonb,
     jsonb_build_object('match', 'all', 'show_if', jsonb_build_array(jsonb_build_object('question_id', q_choice, 'op', 'equals', 'value', 'Swap some foods or meals')))),
    (q_free, f,
     'Do you want a free meal on your High Day?',
     'A free meal is one meal of whatever you want (burger + fries, steak + potatoes, pasta…), built into your High Day calories so it doesn''t set you back. Heads up: going without one takes more discipline. You''d get a High Day with extra carbs instead, but every meal stays planned and weighed.',
     'single_choice',
     '["Yes, give me a free meal on my High Day","No free meal, just a planned High Day"]'::jsonb,
     true, after_idx + 3,
     '{}'::jsonb,
     '{}'::jsonb),
    (q_pick, f,
     'What''s your go-to free meal?',
     'Pick your usual. On the day you can still have whatever you want.',
     'single_choice',
     '["Burger + fries","Steak + potatoes","Pasta","Pizza","Sushi","Tacos / burritos","Whatever I''m craving that week"]'::jsonb,
     false, after_idx + 4,
     '{}'::jsonb,
     jsonb_build_object('match', 'all', 'show_if', jsonb_build_array(jsonb_build_object('question_id', q_free, 'op', 'equals', 'value', 'Yes, give me a free meal on my High Day'))));
END $$;
