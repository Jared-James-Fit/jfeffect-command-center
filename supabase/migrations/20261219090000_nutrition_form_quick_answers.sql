-- The Nutrition Update Request, quicker on a phone: one-tap answers above the
-- typed ones (`validation.quick`, the stand-alone ones in `quick_exclusive`)
-- and a sane range on the numbers (`min` / `max` / `unit`), read by the form
-- (form-quick.ts). Only fills what the coach hasn't set: a question that
-- already has quick answers or a range keeps them.
SET lock_timeout = '3s';

DO $$
DECLARE
  c_form constant uuid := 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('current fasted bodyweight%', NULL::jsonb, NULL::jsonb, '{"min": 70, "max": 700, "unit": "lb"}'::jsonb),
      ('explain your goal%', '["No set timeframe", "No event coming up"]'::jsonb, '[]'::jsonb, NULL::jsonb),
      ('any allergies%', '["None", "Dairy", "Gluten", "Nuts", "Shellfish", "Eggs", "Soy"]'::jsonb, '["None"]'::jsonb, NULL::jsonb),
      ('are you involved in any physical activities%', '["None", "Walking", "Dog walking", "Sports", "Labour job", "Yoga", "Cycling"]'::jsonb, '["None"]'::jsonb, NULL::jsonb),
      ('list all of your foods%', '["I eat anything", "No pork", "No red meat", "No fish", "Vegetarian", "Vegan", "Picky eater"]'::jsonb, '["I eat anything"]'::jsonb, NULL::jsonb),
      ('training days per week%', '["2", "3", "4", "5", "6"]'::jsonb, '[]'::jsonb, '{"min": 0, "max": 7, "unit": "days"}'::jsonb),
      ('average daily steps%', '["3000", "5000", "7500", "10000", "12500"]'::jsonb, '[]'::jsonb, '{"min": 0, "max": 60000, "unit": "steps"}'::jsonb),
      ('anything i missed%', '["That''s everything"]'::jsonb, '["That''s everything"]'::jsonb, NULL::jsonb)
    ) AS t(label_like, quick, quick_exclusive, range)
  LOOP
    IF r.quick IS NOT NULL THEN
      UPDATE public.nf_questions
         SET validation = coalesce(validation, '{}'::jsonb) || jsonb_build_object('quick', r.quick, 'quick_exclusive', r.quick_exclusive)
       WHERE form_id = c_form AND lower(label) LIKE r.label_like
         AND NOT (coalesce(validation, '{}'::jsonb) ? 'quick');
    END IF;
    IF r.range IS NOT NULL THEN
      UPDATE public.nf_questions
         SET validation = coalesce(validation, '{}'::jsonb) || r.range
       WHERE form_id = c_form AND lower(label) LIKE r.label_like
         AND NOT (coalesce(validation, '{}'::jsonb) ? 'min') AND NOT (coalesce(validation, '{}'::jsonb) ? 'max');
    END IF;
  END LOOP;
END $$;
