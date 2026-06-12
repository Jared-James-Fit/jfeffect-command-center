
-- Per-exercise unit defaults + per-client unit preferences for the workout logger.

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS default_load_unit text;

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_default_load_unit_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_default_load_unit_check
  CHECK (default_load_unit IS NULL OR default_load_unit IN ('kg','lb'));

CREATE TABLE IF NOT EXISTS public.client_exercise_unit_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  unit text NOT NULL CHECK (unit IN ('kg','lb')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_ceup_client ON public.client_exercise_unit_prefs(client_id);
CREATE INDEX IF NOT EXISTS idx_ceup_client_exercise ON public.client_exercise_unit_prefs(client_id, exercise_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_exercise_unit_prefs TO authenticated;
GRANT ALL ON public.client_exercise_unit_prefs TO service_role;

ALTER TABLE public.client_exercise_unit_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client manage own unit prefs"
  ON public.client_exercise_unit_prefs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

CREATE POLICY "Coach manage assigned unit prefs"
  ON public.client_exercise_unit_prefs
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

CREATE POLICY "Admin manage unit prefs"
  ON public.client_exercise_unit_prefs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER tg_ceup_updated_at
  BEFORE UPDATE ON public.client_exercise_unit_prefs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
