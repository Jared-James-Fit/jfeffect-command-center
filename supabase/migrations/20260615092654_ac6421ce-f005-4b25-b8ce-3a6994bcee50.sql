ALTER TABLE public.pl_row_results ADD COLUMN IF NOT EXISTS is_working_set boolean;
ALTER TABLE public.member_set_logs ADD COLUMN IF NOT EXISTS is_working_set boolean;
COMMENT ON COLUMN public.pl_row_results.is_working_set IS 'Explicit working-set flag. NULL means unspecified; analytics fall back to RPE/load heuristic.';
COMMENT ON COLUMN public.member_set_logs.is_working_set IS 'Explicit working-set flag. NULL means unspecified; analytics fall back to RPE/load heuristic.';

CREATE TABLE IF NOT EXISTS public.client_analytics_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  e1rm_formula text NOT NULL DEFAULT 'epley' CHECK (e1rm_formula IN ('epley','brzycki')),
  working_set_rpe_min numeric NOT NULL DEFAULT 6 CHECK (working_set_rpe_min >= 0 AND working_set_rpe_min <= 10),
  muscle_volume_targets jsonb NOT NULL DEFAULT '{}'::jsonb,
  share_signals boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_analytics_settings TO authenticated;
GRANT ALL ON public.client_analytics_settings TO service_role;

ALTER TABLE public.client_analytics_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage analytics settings"
  ON public.client_analytics_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned analytics settings"
  ON public.client_analytics_settings FOR ALL TO authenticated
  USING (is_assigned_coach(client_id))
  WITH CHECK (is_assigned_coach(client_id));

CREATE POLICY "Client read own analytics settings"
  ON public.client_analytics_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_analytics_settings.client_id AND c.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_client_analytics_settings_client ON public.client_analytics_settings(client_id);

CREATE OR REPLACE FUNCTION public.tg_client_analytics_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_analytics_settings_updated_at ON public.client_analytics_settings;
CREATE TRIGGER client_analytics_settings_updated_at
  BEFORE UPDATE ON public.client_analytics_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_analytics_settings_updated_at();