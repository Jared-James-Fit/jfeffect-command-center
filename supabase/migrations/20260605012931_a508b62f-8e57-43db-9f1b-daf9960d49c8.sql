DROP POLICY IF EXISTS "Auth read active agreement_templates" ON public.agreement_templates;

CREATE POLICY "Admin read agreement_templates"
ON public.agreement_templates
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach read active agreement_templates"
ON public.agreement_templates
FOR SELECT
TO authenticated
USING (
  is_active = true
  AND archived = false
  AND EXISTS (SELECT 1 FROM public.coaches co WHERE co.user_id = auth.uid() AND co.archived = false AND co.status = 'Active')
);