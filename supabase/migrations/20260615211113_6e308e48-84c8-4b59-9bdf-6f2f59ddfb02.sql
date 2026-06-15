CREATE POLICY "Client update own fillout_submissions"
ON public.fillout_submissions
FOR UPDATE
TO authenticated
USING (
  client_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = fillout_submissions.client_id
      AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  client_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = fillout_submissions.client_id
      AND c.user_id = auth.uid()
  )
);