-- Form questions the app can already answer start from it (src/lib/form-prefill.ts).
-- The Nutrition Update Request's "Training days per week" reads their training
-- schedule, "What time do you usually train?" when their workouts actually
-- start, and "Goal" Goals & Setup's goal for a client who's never answered it.
-- Each stays theirs to change on the form. Only a question with no fill set yet
-- is touched, so a coach's own choice in the builder stands.

UPDATE public.nf_questions
SET validation = coalesce(validation, '{}'::jsonb) || '{"prefill":"training_days"}'::jsonb
WHERE form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'
  AND archived_at IS NULL
  AND question_type = 'number'
  AND label = 'Training days per week'
  AND coalesce(validation ->> 'prefill', '') = '';

UPDATE public.nf_questions
SET validation = coalesce(validation, '{}'::jsonb) || '{"prefill":"training_time"}'::jsonb
WHERE form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'
  AND archived_at IS NULL
  AND question_type IN ('dropdown', 'single_choice')
  AND label = 'What time do you usually train?'
  AND coalesce(validation ->> 'prefill', '') = '';

UPDATE public.nf_questions
SET validation = coalesce(validation, '{}'::jsonb) || '{"prefill":"goal"}'::jsonb
WHERE form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'
  AND archived_at IS NULL
  AND question_type IN ('dropdown', 'single_choice')
  AND label = 'Goal'
  AND coalesce(validation ->> 'prefill', '') = '';
