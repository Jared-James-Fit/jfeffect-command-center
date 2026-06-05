create policy "admins manage product images"
  on storage.objects for all to authenticated
  using (bucket_id = 'product-images' and public.has_role(auth.uid(), 'admin'::app_role))
  with check (bucket_id = 'product-images' and public.has_role(auth.uid(), 'admin'::app_role));

create policy "authenticated read product images"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-images');