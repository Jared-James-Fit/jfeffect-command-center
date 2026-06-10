DROP POLICY IF EXISTS "Clients read visible active check_in_links" ON public.check_in_links;

CREATE POLICY "Clients read assigned check_in_links"
ON public.check_in_links
FOR SELECT
TO authenticated
USING (
  active = true
  AND archived = false
  AND visible_to_client = true
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.user_id = auth.uid()
      AND c.archived = false
      AND c.assigned_check_in_link_id = check_in_links.id
  )
);