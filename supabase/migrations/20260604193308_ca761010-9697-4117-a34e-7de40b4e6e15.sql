
-- Admins: full access to agreements bucket
CREATE POLICY "Admin all agreements bucket"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'agreements' AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'agreements' AND has_role(auth.uid(), 'admin'::app_role));

-- Authenticated read of any agreement file referenced by an agreement they can see.
-- Paths are organized as: agreements/<agreement_id>/...  OR  templates/<template_id>/...
CREATE POLICY "Read template pdf via auth"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'agreements'
  AND (storage.foldername(name))[1] = 'templates'
);

CREATE POLICY "Client read own agreement files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'agreements'
  AND (storage.foldername(name))[1] = 'instances'
  AND EXISTS (
    SELECT 1 FROM public.agreements a
    JOIN public.clients c ON c.id = a.client_id
    WHERE c.user_id = auth.uid()
      AND a.id::text = (storage.foldername(name))[2]
  )
);

CREATE POLICY "Coach read assigned agreement files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'agreements'
  AND (storage.foldername(name))[1] = 'instances'
  AND EXISTS (
    SELECT 1 FROM public.agreements a
    WHERE is_assigned_coach(a.client_id)
      AND a.id::text = (storage.foldername(name))[2]
  )
);
