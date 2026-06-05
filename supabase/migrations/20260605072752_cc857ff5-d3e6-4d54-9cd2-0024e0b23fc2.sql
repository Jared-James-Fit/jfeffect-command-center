
-- Check-in link library
CREATE TABLE public.check_in_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  description text,
  check_in_type text NOT NULL DEFAULT 'Weekly Check-In',
  custom_type text,
  due_day text,
  frequency text NOT NULL DEFAULT 'Weekly',
  visible_to_client boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  notes_client text,
  notes_admin text,
  require_video boolean NOT NULL DEFAULT true,
  require_photos boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.check_in_links TO authenticated;
GRANT ALL ON public.check_in_links TO service_role;
ALTER TABLE public.check_in_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage check_in_links" ON public.check_in_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach read active check_in_links" ON public.check_in_links FOR SELECT TO authenticated
  USING (active = true AND archived = false AND EXISTS (SELECT 1 FROM public.coaches co WHERE co.user_id = auth.uid() AND co.archived = false));
CREATE TRIGGER check_in_links_updated_at BEFORE UPDATE ON public.check_in_links FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Generic forms library
CREATE TABLE public.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  form_type text NOT NULL DEFAULT 'Custom',
  custom_type text,
  description text,
  visible_to_client boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  notes_admin text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.forms TO authenticated;
GRANT ALL ON public.forms TO service_role;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage forms" ON public.forms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach read active forms" ON public.forms FOR SELECT TO authenticated
  USING (active = true AND archived = false AND EXISTS (SELECT 1 FROM public.coaches co WHERE co.user_id = auth.uid() AND co.archived = false));
CREATE TRIGGER forms_updated_at BEFORE UPDATE ON public.forms FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Per-client form assignments (many-to-many)
CREATE TABLE public.form_client_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, client_id)
);
CREATE INDEX form_client_assignments_client_idx ON public.form_client_assignments(client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_client_assignments TO authenticated;
GRANT ALL ON public.form_client_assignments TO service_role;
ALTER TABLE public.form_client_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage form_client_assignments" ON public.form_client_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach manage assigned form_client_assignments" ON public.form_client_assignments FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id)) WITH CHECK (public.is_assigned_coach(client_id));
CREATE POLICY "Client read own form assignments" ON public.form_client_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

-- Assign a default check-in link per client
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS assigned_check_in_link_id uuid REFERENCES public.check_in_links(id) ON DELETE SET NULL;
