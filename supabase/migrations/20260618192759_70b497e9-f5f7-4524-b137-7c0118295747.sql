REVOKE INSERT ON public.coaching_applications FROM anon;

DROP POLICY IF EXISTS "coaching_applications public insert" ON public.coaching_applications;

CREATE POLICY "coaching_applications admin insert"
  ON public.coaching_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));