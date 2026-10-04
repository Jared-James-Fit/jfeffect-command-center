-- Coach-chosen phase for a Nutrition Update Request (sent with the request,
-- or picked when regenerating) and the phase options on the native form.
ALTER TABLE public.nf_assignments ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.nutrition_ai_plans ADD COLUMN IF NOT EXISTS phase text;

UPDATE public.nf_questions
   SET options = '["Fat Loss","Muscle Gain","Recomp (lose fat + build muscle)","Maintenance","Performance / strength","Reverse Diet","Lifestyle Reset (build better habits)"]'::jsonb
 WHERE form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d' AND label = 'Goal';
