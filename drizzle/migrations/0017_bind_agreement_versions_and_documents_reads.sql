DROP POLICY IF EXISTS "Signed-in users read coaching agreement versions" ON public.coaching_agreement_versions;
CREATE POLICY "Signers and staff read coaching agreement versions" ON public.coaching_agreement_versions
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = (SELECT auth.uid()))
  OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = (SELECT auth.uid()) AND r.role <> 'client'::app_role)
);

DROP POLICY IF EXISTS "documents read" ON storage.objects;
CREATE POLICY "documents read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'documents' AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND d.deleted_at IS NULL
        AND (
          d.owner_user_id = (SELECT auth.uid())
          OR (d.visibility = 'client' AND d.client_id IN (SELECT public.documents_own_client_ids()))
          OR (d.visibility IN ('coach','client') AND d.client_id IN (SELECT public.coached_client_ids()))
          OR (d.visibility IN ('coach','client') AND d.client_id IS NOT NULL AND (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)))
        )
    )
  )
);