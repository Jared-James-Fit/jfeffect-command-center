CREATE POLICY "Client read own fillout_submissions"
ON public.fillout_submissions
FOR SELECT
TO authenticated
USING (
  client_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = fillout_submissions.client_id
      AND c.user_id = auth.uid()
  )
);