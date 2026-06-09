
CREATE POLICY "chat-sounds read authed"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-sounds');
CREATE POLICY "chat-sounds admin/coach write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-sounds' AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role)));
CREATE POLICY "chat-sounds admin/coach update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-sounds' AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role)));
CREATE POLICY "chat-sounds admin/coach delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-sounds' AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'coach'::app_role)));
