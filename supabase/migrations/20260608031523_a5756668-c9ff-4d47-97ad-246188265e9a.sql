
CREATE POLICY "Admin manage member-resources storage"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'member-resources' AND public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (bucket_id = 'member-resources' AND public.has_role(auth.uid(),'admin'::app_role));
