-- Ensure helper function exists FIRST
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $f$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$f$;

-- Pending coach approval flag on existing active targets
ALTER TABLE public.member_nutrition_targets
  ADD COLUMN IF NOT EXISTS pending_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS coach_note text;

-- member_meal_logs
CREATE TABLE IF NOT EXISTS public.member_meal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  user_id uuid NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  calories integer NOT NULL DEFAULT 0,
  protein_g numeric NOT NULL DEFAULT 0,
  carbs_g numeric NOT NULL DEFAULT 0,
  fat_g numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('preset','manual','ai')),
  preset_id uuid,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_meal_logs_member_date ON public.member_meal_logs(member_id, logged_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_meal_logs TO authenticated;
GRANT ALL ON public.member_meal_logs TO service_role;
ALTER TABLE public.member_meal_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage own meal logs" ON public.member_meal_logs;
CREATE POLICY "Members manage own meal logs" ON public.member_meal_logs
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all meal logs" ON public.member_meal_logs;
CREATE POLICY "Admins read all meal logs" ON public.member_meal_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS trg_member_meal_logs_updated ON public.member_meal_logs;
CREATE TRIGGER trg_member_meal_logs_updated BEFORE UPDATE ON public.member_meal_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- member_meal_presets
CREATE TABLE IF NOT EXISTS public.member_meal_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  calories integer NOT NULL DEFAULT 0,
  protein_g numeric NOT NULL DEFAULT 0,
  carbs_g numeric NOT NULL DEFAULT 0,
  fat_g numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_meal_presets_member ON public.member_meal_presets(member_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_meal_presets TO authenticated;
GRANT ALL ON public.member_meal_presets TO service_role;
ALTER TABLE public.member_meal_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage own presets" ON public.member_meal_presets;
CREATE POLICY "Members manage own presets" ON public.member_meal_presets
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all presets" ON public.member_meal_presets;
CREATE POLICY "Admins read all presets" ON public.member_meal_presets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS trg_member_meal_presets_updated ON public.member_meal_presets;
CREATE TRIGGER trg_member_meal_presets_updated BEFORE UPDATE ON public.member_meal_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- member_supplements
CREATE TABLE IF NOT EXISTS public.member_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  daily_target_count integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_supplements_member ON public.member_supplements(member_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_supplements TO authenticated;
GRANT ALL ON public.member_supplements TO service_role;
ALTER TABLE public.member_supplements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage own supplements" ON public.member_supplements;
CREATE POLICY "Members manage own supplements" ON public.member_supplements
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all supplements" ON public.member_supplements;
CREATE POLICY "Admins read all supplements" ON public.member_supplements
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS trg_member_supplements_updated ON public.member_supplements;
CREATE TRIGGER trg_member_supplements_updated BEFORE UPDATE ON public.member_supplements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- member_supplement_logs
CREATE TABLE IF NOT EXISTS public.member_supplement_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  user_id uuid NOT NULL,
  supplement_id uuid,
  supplement_name text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  dose text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_supplement_logs_member_date ON public.member_supplement_logs(member_id, taken_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_supplement_logs TO authenticated;
GRANT ALL ON public.member_supplement_logs TO service_role;
ALTER TABLE public.member_supplement_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage own supplement logs" ON public.member_supplement_logs;
CREATE POLICY "Members manage own supplement logs" ON public.member_supplement_logs
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all supplement logs" ON public.member_supplement_logs;
CREATE POLICY "Admins read all supplement logs" ON public.member_supplement_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));