CREATE POLICY "Admin manage message-attachments"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'message-attachments' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'message-attachments' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Client read own message-attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Client upload own message-attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.id::text = (storage.foldername(name))[1]
  )
);