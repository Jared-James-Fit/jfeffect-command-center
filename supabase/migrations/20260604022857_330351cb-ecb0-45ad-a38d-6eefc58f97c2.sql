ALTER TABLE public.training_phases ADD COLUMN IF NOT EXISTS visible_to_client boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Client read own training phases" ON public.training_phases;
CREATE POLICY "Client read own training phases" ON public.training_phases
FOR SELECT TO authenticated
USING (
  visible_to_client = true
  AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = training_phases.client_id AND c.user_id = auth.uid())
);