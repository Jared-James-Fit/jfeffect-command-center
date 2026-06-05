
CREATE TABLE public.progress_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  bodyweight numeric(6,2),
  bodyweight_unit text NOT NULL DEFAULT 'lb' CHECK (bodyweight_unit IN ('lb','kg')),
  steps integer,
  sleep_hours numeric(4,2),
  resting_heart_rate integer,
  calories_burned integer,
  active_minutes integer,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX progress_metrics_client_date_idx ON public.progress_metrics (client_id, entry_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_metrics TO authenticated;
GRANT ALL ON public.progress_metrics TO service_role;

ALTER TABLE public.progress_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage progress_metrics" ON public.progress_metrics
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned progress_metrics" ON public.progress_metrics
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

CREATE POLICY "Client read own progress_metrics" ON public.progress_metrics
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = progress_metrics.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client insert own progress_metrics" ON public.progress_metrics
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = progress_metrics.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client update own progress_metrics" ON public.progress_metrics
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = progress_metrics.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = progress_metrics.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Client delete own progress_metrics" ON public.progress_metrics
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = progress_metrics.client_id AND c.user_id = auth.uid()));

CREATE TRIGGER tg_progress_metrics_updated_at
  BEFORE UPDATE ON public.progress_metrics
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preferred_weight_unit text NOT NULL DEFAULT 'lb'
    CHECK (preferred_weight_unit IN ('lb','kg'));
