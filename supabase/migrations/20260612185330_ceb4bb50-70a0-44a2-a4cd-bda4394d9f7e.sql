
-- 1. pl_row_results: add normalized weight + numeric RPE columns
ALTER TABLE public.pl_row_results
  ADD COLUMN IF NOT EXISTS actual_load_kg numeric,
  ADD COLUMN IF NOT EXISTS actual_load_lb numeric,
  ADD COLUMN IF NOT EXISTS actual_rpe_num numeric;

-- Backfill from existing data
UPDATE public.pl_row_results
   SET actual_load_kg = CASE
         WHEN actual_load IS NULL THEN NULL
         WHEN lower(coalesce(actual_load_unit, 'lb')) = 'kg' THEN actual_load
         ELSE round((actual_load / 2.2046226218)::numeric, 4)
       END,
       actual_load_lb = CASE
         WHEN actual_load IS NULL THEN NULL
         WHEN lower(coalesce(actual_load_unit, 'lb')) = 'lb' THEN actual_load
         ELSE round((actual_load * 2.2046226218)::numeric, 4)
       END
 WHERE actual_load IS NOT NULL
   AND (actual_load_kg IS NULL OR actual_load_lb IS NULL);

-- Backfill numeric RPE when the existing text value is a plain number / decimal
UPDATE public.pl_row_results
   SET actual_rpe_num = actual_rpe::numeric
 WHERE actual_rpe_num IS NULL
   AND actual_rpe IS NOT NULL
   AND actual_rpe ~ '^[0-9]+(\.[0-9]+)?$';

-- Keep kg/lb in sync on any future insert/update
CREATE OR REPLACE FUNCTION public.tg_pl_row_results_sync_units()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.actual_load IS NULL THEN
    NEW.actual_load_kg := NULL;
    NEW.actual_load_lb := NULL;
  ELSE
    IF lower(coalesce(NEW.actual_load_unit, 'lb')) = 'kg' THEN
      NEW.actual_load_kg := NEW.actual_load;
      NEW.actual_load_lb := round((NEW.actual_load * 2.2046226218)::numeric, 4);
    ELSE
      NEW.actual_load_lb := NEW.actual_load;
      NEW.actual_load_kg := round((NEW.actual_load / 2.2046226218)::numeric, 4);
    END IF;
  END IF;

  IF NEW.actual_rpe IS NOT NULL AND NEW.actual_rpe ~ '^[0-9]+(\.[0-9]+)?$' THEN
    NEW.actual_rpe_num := NEW.actual_rpe::numeric;
  ELSIF NEW.actual_rpe IS NULL THEN
    NEW.actual_rpe_num := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_pl_row_results_sync_units ON public.pl_row_results;
CREATE TRIGGER tg_pl_row_results_sync_units
BEFORE INSERT OR UPDATE ON public.pl_row_results
FOR EACH ROW EXECUTE FUNCTION public.tg_pl_row_results_sync_units();

-- 2. clients: remember preferred weight unit
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preferred_weight_unit text;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_preferred_weight_unit_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_preferred_weight_unit_check
  CHECK (preferred_weight_unit IS NULL OR preferred_weight_unit IN ('kg','lb'));

-- 3. support_alerts: in-app emergency reports (workout failed to load, etc.)
CREATE TABLE IF NOT EXISTS public.support_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  coach_id uuid REFERENCES public.coaches(id) ON DELETE SET NULL,
  workout_id uuid,
  workout_date date,
  page_route text,
  error_type text NOT NULL DEFAULT 'workout_load_failure',
  error_message text,
  device_info jsonb,
  details jsonb,
  status text NOT NULL DEFAULT 'open',
  notified_via text[] NOT NULL DEFAULT '{}',
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_alerts_status_check
    CHECK (status IN ('open','in_progress','resolved'))
);

CREATE INDEX IF NOT EXISTS idx_support_alerts_status_created
  ON public.support_alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_alerts_client
  ON public.support_alerts (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_alerts_coach
  ON public.support_alerts (coach_id, created_at DESC);

-- Grants
GRANT SELECT, INSERT, UPDATE ON public.support_alerts TO authenticated;
GRANT ALL ON public.support_alerts TO service_role;

-- RLS
ALTER TABLE public.support_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients insert own alerts" ON public.support_alerts;
CREATE POLICY "Clients insert own alerts"
  ON public.support_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = support_alerts.client_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Clients view own alerts" ON public.support_alerts;
CREATE POLICY "Clients view own alerts"
  ON public.support_alerts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = support_alerts.client_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Coaches view alerts for their clients" ON public.support_alerts;
CREATE POLICY "Coaches view alerts for their clients"
  ON public.support_alerts
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      support_alerts.client_id IS NOT NULL
      AND public.is_assigned_coach(support_alerts.client_id)
    )
    OR public.is_coach_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Coaches update alerts" ON public.support_alerts;
CREATE POLICY "Coaches update alerts"
  ON public.support_alerts
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_coach_or_admin(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_coach_or_admin(auth.uid())
  );

-- updated_at trigger
DROP TRIGGER IF EXISTS tg_support_alerts_updated_at ON public.support_alerts;
CREATE TRIGGER tg_support_alerts_updated_at
BEFORE UPDATE ON public.support_alerts
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
