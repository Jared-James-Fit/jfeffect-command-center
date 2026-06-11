
ALTER TABLE public.coach_faqs DROP CONSTRAINT IF EXISTS coach_faqs_category_check;
ALTER TABLE public.coach_faqs ADD CONSTRAINT coach_faqs_category_check
  CHECK (category = ANY (ARRAY['nutrition'::text, 'workouts'::text, 'cardio'::text, 'training_help'::text]));

ALTER TABLE public.coach_faqs
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS examples text,
  ADD COLUMN IF NOT EXISTS visible_coaching boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visible_membership boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visible_everyone boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS coach_faqs_subcategory_idx ON public.coach_faqs (category, subcategory, sort_order);
