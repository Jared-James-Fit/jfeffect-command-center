-- Native "Nutrition Update Request" form + AI nutrition plans.
--
-- The coach sends the form from the client profile (or chat). When the client
-- submits, the server runs two AI passes and stores them here:
--   targets_text   — calorie / macro / cardio targets in the coach's format
--   meal_plan_text — full meal plan in the app's paste format (parseMealPlan)
-- Only the server (service role) writes; staff read.

CREATE TABLE IF NOT EXISTS public.nutrition_ai_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL UNIQUE REFERENCES public.nf_submissions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'error')),
  targets_text text,
  meal_plan_text text,
  error text,
  model text,
  generated_at timestamptz,
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nutrition_ai_plans_client_idx ON public.nutrition_ai_plans (client_id, created_at DESC);

ALTER TABLE public.nutrition_ai_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read nutrition ai plans" ON public.nutrition_ai_plans;
CREATE POLICY "staff read nutrition ai plans" ON public.nutrition_ai_plans
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role));

-- Seed the native form (fixed id so the app can find it) with the questions
-- from the coach's Fillout nutrition form, plus optional training days and
-- steps so the AI can estimate expenditure. Editable in the form builder.
DO $$
DECLARE v_form uuid := 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d';
BEGIN
  IF EXISTS (SELECT 1 FROM public.nf_forms WHERE id = v_form) THEN RETURN; END IF;

  INSERT INTO public.nf_forms (id, title, description, form_type, kind, recurrence, active, visibility, button_label)
  VALUES (
    v_form,
    'Nutrition Update Request',
    'Fill out this form with as much detail as possible',
    'nutrition_update', 'native', 'none', true, 'selected', 'Update my nutrition'
  );

  INSERT INTO public.nf_questions (form_id, order_index, question_type, label, help_text, required, options) VALUES
    (v_form, 1,  'number',   'Current fasted bodyweight? (lbs)', NULL, true, '[]'::jsonb),
    (v_form, 2,  'short_text', 'Height (ft)', NULL, true, '[]'::jsonb),
    (v_form, 3,  'dropdown', 'Goal', NULL, true,
       '["Lose fat","Build muscle / gain weight","Recomp (lose fat + build muscle)","Maintain","Strength / performance"]'::jsonb),
    (v_form, 4,  'dropdown', 'Which body fat % range do you look closest to?', NULL, true,
       '["Under 10%","10–14%","15–19%","20–24%","25–29%","30–34%","35%+"]'::jsonb),
    (v_form, 5,  'long_text', 'Explain your goal with more details: is there a target bodyweight? timeframe? any events or reason we are doing this?', NULL, true, '[]'::jsonb),
    (v_form, 6,  'long_text', 'Any allergies? list all and explain', NULL, true, '[]'::jsonb),
    (v_form, 7,  'dropdown', 'How many meals can you have per day? (3 minimum)', NULL, true, '["3","4","5","6"]'::jsonb),
    (v_form, 8,  'short_text', 'Are you involved in any physical activities outside of the gym? ex. labour job, sports, yoga, dog walking etc...', NULL, true, '[]'::jsonb),
    (v_form, 9,  'long_text', 'List all of your foods + preferences', 'No promises but I''ll consider it', true, '[]'::jsonb),
    (v_form, 10, 'number',   'Training days per week', NULL, false, '[]'::jsonb),
    (v_form, 11, 'number',   'Average daily steps', 'Check your phone or watch — a rough average is fine', false, '[]'::jsonb),
    (v_form, 12, 'long_text', 'Anything i missed or need to know?', NULL, true, '[]'::jsonb),
    (v_form, 13, 'dropdown', 'I understand this plan uses exact measurements (grams/oz) for best results. I will follow the plan as written. if i have concerns (hunger, low energy, schedule issues, foods I can''t get), I will message my coach before making changes. If i need a substitute, i will ask for one and use the approved swap.', NULL, true, '["Yes, I understand and agree"]'::jsonb),
    (v_form, 14, 'dropdown', 'I can commit to weekly check-ins by submitting the check-in form every week. i understand missed check-ins = slower progress and less accurate adjustments.', NULL, true, '["Yes, I commit"]'::jsonb);
END $$;

-- FOOD-WEIGHING RULES from a pasted meal plan, shown to the client with the plan.
ALTER TABLE public.nutrition_targets ADD COLUMN IF NOT EXISTS food_weighing_rules text;
