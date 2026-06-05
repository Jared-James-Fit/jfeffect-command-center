
ALTER TABLE public.nutrition_targets
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS pdf_name text;

DROP POLICY IF EXISTS "Admin manage nutrition plan files" ON storage.objects;
CREATE POLICY "Admin manage nutrition plan files"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'nutrition-plans' AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'nutrition-plans' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Coach manage assigned nutrition plan files" ON storage.objects;
CREATE POLICY "Coach manage assigned nutrition plan files"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'nutrition-plans'
  AND public.is_assigned_coach(((string_to_array(name, '/'))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'nutrition-plans'
  AND public.is_assigned_coach(((string_to_array(name, '/'))[1])::uuid)
);

DROP POLICY IF EXISTS "Client read own nutrition plan files" ON storage.objects;
CREATE POLICY "Client read own nutrition plan files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'nutrition-plans'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.id::text = (string_to_array(name, '/'))[1]
  )
);
