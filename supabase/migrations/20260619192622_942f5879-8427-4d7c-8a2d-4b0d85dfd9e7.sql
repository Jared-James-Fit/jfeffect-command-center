DROP POLICY IF EXISTS "Client accept own purchase_records" ON public.purchase_records;

REVOKE UPDATE ON public.purchase_records FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.purchase_records TO authenticated;
GRANT UPDATE (terms_accepted, terms_accepted_at, terms_accepted_client_name, terms_accepted_client_email)
  ON public.purchase_records TO authenticated;
GRANT ALL ON public.purchase_records TO service_role;

CREATE POLICY "Client accept own purchase_records"
ON public.purchase_records
FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = purchase_records.client_id AND c.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = purchase_records.client_id AND c.user_id = auth.uid()));
