-- Show the body-fat reference chart above question 4 of the native
-- "Nutrition Update Request" form. The image ships in /public/forms and is
-- referenced via nf_questions.validation.reference_image (merged, so any
-- existing validation keys are kept). Safe to re-run.
UPDATE public.nf_questions
SET validation = COALESCE(validation, '{}'::jsonb)
                 || jsonb_build_object('reference_image', '/forms/body-fat-chart.webp')
WHERE form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'
  AND label = 'Which body fat % range do you look closest to?'
  AND archived_at IS NULL;
