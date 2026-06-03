
CREATE TABLE public.training_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  phase_type text NOT NULL,
  custom_phase_name text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  current_week integer,
  training_goal text,
  program_link text,
  notes text,
  status text NOT NULL DEFAULT 'Active',
  ending_soon_days integer NOT NULL DEFAULT 7,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_phases TO authenticated;
GRANT ALL ON public.training_phases TO service_role;

ALTER TABLE public.training_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage training phases" ON public.training_phases
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Client read own training phases" ON public.training_phases
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = training_phases.client_id AND c.user_id = auth.uid()));

CREATE INDEX idx_training_phases_client ON public.training_phases(client_id);
CREATE INDEX idx_training_phases_status ON public.training_phases(status);

CREATE TRIGGER training_phases_updated_at
  BEFORE UPDATE ON public.training_phases
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
