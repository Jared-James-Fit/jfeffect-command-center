
DROP POLICY IF EXISTS "nae insert any auth" ON public.na_events;

CREATE POLICY "nae insert scoped" ON public.na_events FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR package_id IN (
    SELECT id FROM public.na_packages
    WHERE client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
  )
  OR signer_id IN (SELECT id FROM public.na_signers WHERE user_id = auth.uid())
);
