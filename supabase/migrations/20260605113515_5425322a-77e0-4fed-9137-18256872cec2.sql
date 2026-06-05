
-- Extend cardio_targets with program grouping + optional calorie targets
ALTER TABLE public.cardio_targets
  ADD COLUMN IF NOT EXISTS program_name text,
  ADD COLUMN IF NOT EXISTS calorie_target_min integer,
  ADD COLUMN IF NOT EXISTS calorie_target_max integer,
  ADD COLUMN IF NOT EXISTS show_calories_to_client boolean NOT NULL DEFAULT true;

-- Saved cardio program templates (reusable)
CREATE TABLE IF NOT EXISTS public.cardio_program_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  notes text,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cardio_program_templates TO authenticated;
GRANT ALL ON public.cardio_program_templates TO service_role;

ALTER TABLE public.cardio_program_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage cardio_program_templates"
  ON public.cardio_program_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach read cardio_program_templates"
  ON public.cardio_program_templates FOR SELECT TO authenticated
  USING (archived = false AND EXISTS (
    SELECT 1 FROM public.coaches co
    WHERE co.user_id = auth.uid() AND co.archived = false AND co.status = 'Active'
  ));

CREATE TRIGGER cardio_program_templates_set_updated_at
  BEFORE UPDATE ON public.cardio_program_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
