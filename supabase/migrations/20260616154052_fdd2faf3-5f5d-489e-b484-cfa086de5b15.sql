DROP POLICY IF EXISTS "fillout_submissions coach read" ON public.fillout_submissions;
CREATE POLICY "fillout_submissions coach read" ON public.fillout_submissions
FOR SELECT USING (
  is_coach_or_admin(auth.uid()) AND (client_id IS NULL OR is_assigned_coach(client_id))
);