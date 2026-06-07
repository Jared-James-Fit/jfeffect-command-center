
-- Storage policies for form-uploads bucket.
-- Paths are conventioned as: {client_id}/{submission_id}/{filename}

CREATE POLICY "nf form-uploads: admin all"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'form-uploads' AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'form-uploads' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "nf form-uploads: client own"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'form-uploads'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND (storage.foldername(name))[1] = c.id::text
  )
)
WITH CHECK (
  bucket_id = 'form-uploads'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND (storage.foldername(name))[1] = c.id::text
  )
);

CREATE POLICY "nf form-uploads: coach assigned read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'form-uploads'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE (storage.foldername(name))[1] = c.id::text
      AND public.is_assigned_coach(c.id)
  )
);
