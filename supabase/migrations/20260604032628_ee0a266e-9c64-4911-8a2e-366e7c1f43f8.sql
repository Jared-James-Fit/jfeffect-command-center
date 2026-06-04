
CREATE POLICY "Admin manage lift-videos objects" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'lift-videos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'lift-videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Client read own lift-videos objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lift-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Client upload own lift-videos objects" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lift-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Client update own lift-videos objects" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'lift-videos' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'lift-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Client delete own lift-videos objects" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lift-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
