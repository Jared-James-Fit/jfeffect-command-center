GRANT SELECT ON public.check_in_links TO authenticated;
GRANT ALL ON public.check_in_links TO service_role;
CREATE POLICY "Clients read visible active check_in_links"
ON public.check_in_links
FOR SELECT
TO authenticated
USING (active = true AND archived = false AND visible_to_client = true);