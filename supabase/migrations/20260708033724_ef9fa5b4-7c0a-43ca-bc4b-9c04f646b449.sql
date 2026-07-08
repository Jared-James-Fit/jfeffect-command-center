DROP POLICY IF EXISTS "Coaches read entitlements" ON public.client_access_entitlements;
CREATE POLICY "Coaches read entitlements" ON public.client_access_entitlements
FOR SELECT USING (
  has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach(client_id)
);