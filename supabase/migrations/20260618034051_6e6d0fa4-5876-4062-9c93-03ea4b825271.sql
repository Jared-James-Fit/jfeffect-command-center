
-- 1. legal_documents: replace broad authenticated read
DROP POLICY IF EXISTS "Active users read non-archived legal documents" ON public.legal_documents;

CREATE POLICY "Active users read accepted or public-allowed documents"
ON public.legal_documents
FOR SELECT
TO authenticated
USING (
  archived = false
  AND emergency_disabled = false
  AND (
    public_read_allowed = true
    OR EXISTS (
      SELECT 1 FROM public.legal_acceptances la
      WHERE la.document_id = legal_documents.id
        AND la.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

-- 2. legal_document_versions: replace broad authenticated read
DROP POLICY IF EXISTS "Active users read published or previously-accepted versions" ON public.legal_document_versions;

CREATE POLICY "Active users read accepted or public-allowed versions"
ON public.legal_document_versions
FOR SELECT
TO authenticated
USING (
  status = 'published'::legal_version_status
  AND (
    EXISTS (
      SELECT 1 FROM public.legal_acceptances la
      WHERE la.version_id = legal_document_versions.id
        AND la.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.legal_documents d
      WHERE d.id = legal_document_versions.document_id
        AND d.public_read_allowed = true
        AND d.archived = false
        AND d.emergency_disabled = false
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

-- 3. warmup_protocols: replace broad client read with assignment-based read
DROP POLICY IF EXISTS "warmup_protocols_client_read_visible" ON public.warmup_protocols;

CREATE POLICY "warmup_protocols_client_read_assigned"
ON public.warmup_protocols
FOR SELECT
TO authenticated
USING (
  archived = false
  AND (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.warmup_protocol_id = warmup_protocols.id
    )
    OR EXISTS (
      SELECT 1 FROM public.warmup_assignments wa
      JOIN public.clients c ON c.id = wa.client_id
      WHERE wa.protocol_id = warmup_protocols.id
        AND c.user_id = auth.uid()
    )
  )
);
