
CREATE TABLE public.nutrition_day_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  day_label TEXT NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, override_date)
);

CREATE INDEX idx_nutrition_day_overrides_client_date ON public.nutrition_day_overrides (client_id, override_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_day_overrides TO authenticated;
GRANT ALL ON public.nutrition_day_overrides TO service_role;

ALTER TABLE public.nutrition_day_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage nutrition_day_overrides"
  ON public.nutrition_day_overrides
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage assigned nutrition_day_overrides"
  ON public.nutrition_day_overrides
  FOR ALL
  TO authenticated
  USING (is_assigned_coach(client_id))
  WITH CHECK (is_assigned_coach(client_id));

CREATE POLICY "Client read own nutrition_day_overrides"
  ON public.nutrition_day_overrides
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = nutrition_day_overrides.client_id AND c.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_nutrition_day_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_nutrition_day_overrides_updated_at
  BEFORE UPDATE ON public.nutrition_day_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_nutrition_day_overrides_updated_at();

-- Add full-cardio-rest weekday array on clients (source of truth for auto rest-day)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS full_cardio_rest_days TEXT[] NOT NULL DEFAULT '{}';
