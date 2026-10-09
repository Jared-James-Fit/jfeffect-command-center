-- Bodyweight unit (kg / lb) remembered per person, separate from the lifting unit
-- (plenty of people lift in lb and weigh in kg). Written every time the toggle changes.
-- Its own table (not user_preferences): inserting there creates a theme row with defaults,
-- which the theme sync would treat as a fresh "light" choice.

CREATE TABLE IF NOT EXISTS public.bodyweight_unit_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unit text NOT NULL CHECK (unit IN ('kg', 'lb')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.bodyweight_unit_prefs TO authenticated;
GRANT ALL ON public.bodyweight_unit_prefs TO service_role;
ALTER TABLE public.bodyweight_unit_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own bodyweight unit - read" ON public.bodyweight_unit_prefs;
CREATE POLICY "Own bodyweight unit - read" ON public.bodyweight_unit_prefs FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Own bodyweight unit - insert" ON public.bodyweight_unit_prefs;
CREATE POLICY "Own bodyweight unit - insert" ON public.bodyweight_unit_prefs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Own bodyweight unit - update" ON public.bodyweight_unit_prefs;
CREATE POLICY "Own bodyweight unit - update" ON public.bodyweight_unit_prefs FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
