CREATE TABLE public.client_quick_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  link_type text NOT NULL DEFAULT 'Custom',
  notes text,
  visibility text NOT NULL DEFAULT 'admin' CHECK (visibility IN ('admin','coach','client')),
  status text NOT NULL DEFAULT 'Active',
  archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_quick_links TO authenticated;
GRANT ALL ON public.client_quick_links TO service_role;

ALTER TABLE public.client_quick_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage client_quick_links"
  ON public.client_quick_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned client_quick_links"
  ON public.client_quick_links FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

CREATE POLICY "Client read own visible client_quick_links"
  ON public.client_quick_links FOR SELECT TO authenticated
  USING (
    visibility = 'client'
    AND archived = false
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_quick_links.client_id AND c.user_id = auth.uid()
    )
  );

CREATE TRIGGER set_client_quick_links_updated_at
  BEFORE UPDATE ON public.client_quick_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_client_quick_links_client ON public.client_quick_links (client_id, archived, sort_order);