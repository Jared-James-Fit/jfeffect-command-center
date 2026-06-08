DROP POLICY IF EXISTS "Client read broadcast nf_questions" ON public.nf_questions;
CREATE POLICY "Client read broadcast nf_questions"
ON public.nf_questions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.nf_forms f
    WHERE f.id = nf_questions.form_id
      AND f.visibility = 'all_active_clients'
      AND f.active = true
      AND f.archived = false
  )
  AND EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.archived = false
      AND COALESCE(c.status, 'Active') IN ('Active', 'New Client')
  )
);