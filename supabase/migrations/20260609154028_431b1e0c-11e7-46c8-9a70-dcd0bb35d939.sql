
-- Client Action Requests: coaches request actions (forms, links, files) from clients
CREATE TABLE public.client_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  native_form_id uuid REFERENCES public.nf_forms(id) ON DELETE SET NULL,
  external_form_url text,
  link_url text,
  link_label text,
  file_path text,
  file_name text,
  file_mime text,
  priority text,
  internal_notes text,
  notify_client boolean NOT NULL DEFAULT true,
  due_date date,
  seen_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_action_requests TO authenticated;
GRANT ALL ON public.client_action_requests TO service_role;

ALTER TABLE public.client_action_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage client_action_requests"
  ON public.client_action_requests
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned client_action_requests"
  ON public.client_action_requests
  FOR ALL
  USING (is_assigned_coach(client_id))
  WITH CHECK (is_assigned_coach(client_id));

CREATE POLICY "Client read own client_action_requests"
  ON public.client_action_requests
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_action_requests.client_id
      AND c.user_id = auth.uid()
  ));

CREATE POLICY "Client mark own client_action_requests"
  ON public.client_action_requests
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_action_requests.client_id
      AND c.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_action_requests.client_id
      AND c.user_id = auth.uid()
  ));

CREATE INDEX client_action_requests_client_id_idx ON public.client_action_requests(client_id);
CREATE INDEX client_action_requests_completed_at_idx ON public.client_action_requests(completed_at);

CREATE TRIGGER client_action_requests_set_updated_at
  BEFORE UPDATE ON public.client_action_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Storage policies for client-action-files bucket
CREATE POLICY "Admins manage client-action-files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'client-action-files' AND has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'client-action-files' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coaches manage client-action-files for assigned clients"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'client-action-files'
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id::text = split_part(storage.objects.name, '/', 1)
        AND is_assigned_coach(c.id)
    )
  )
  WITH CHECK (
    bucket_id = 'client-action-files'
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id::text = split_part(storage.objects.name, '/', 1)
        AND is_assigned_coach(c.id)
    )
  );

CREATE POLICY "Clients read own client-action-files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'client-action-files'
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id::text = split_part(storage.objects.name, '/', 1)
        AND c.user_id = auth.uid()
    )
  );
