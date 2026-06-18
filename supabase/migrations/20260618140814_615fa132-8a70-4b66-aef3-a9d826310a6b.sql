-- 1. Profile fields on app_members (additive, all nullable)
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS height_cm numeric(5,2),
  ADD COLUMN IF NOT EXISTS biological_sex text CHECK (biological_sex IN ('male','female')),
  ADD COLUMN IF NOT EXISTS activity_level text CHECK (activity_level IN ('sedentary','light','moderate','very','extra')),
  ADD COLUMN IF NOT EXISTS units_preference text CHECK (units_preference IN ('metric','imperial'));

-- 2. Member nutrition targets
CREATE TABLE IF NOT EXISTS public.member_nutrition_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'calculated' CHECK (source IN ('calculated','manual','coach')),
  goal text CHECK (goal IN ('lose','maintain','gain')),
  calories integer NOT NULL,
  protein_g integer NOT NULL,
  carbs_g integer NOT NULL,
  fat_g integer NOT NULL,
  water_ml integer,
  input_snapshot jsonb,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, active) DEFERRABLE INITIALLY DEFERRED
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_nutrition_targets TO authenticated;
GRANT ALL ON public.member_nutrition_targets TO service_role;

ALTER TABLE public.member_nutrition_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage own nutrition targets"
  ON public.member_nutrition_targets FOR ALL TO authenticated
  USING (member_id IN (SELECT id FROM public.app_members WHERE user_id = auth.uid()))
  WITH CHECK (member_id IN (SELECT id FROM public.app_members WHERE user_id = auth.uid()));

CREATE POLICY "Admins manage all member nutrition targets"
  ON public.member_nutrition_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_member_nutrition_targets_member_active
  ON public.member_nutrition_targets (member_id) WHERE active = true;

CREATE OR REPLACE FUNCTION public.touch_member_nutrition_targets()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_member_nutrition_targets_touch
  BEFORE UPDATE ON public.member_nutrition_targets
  FOR EACH ROW EXECUTE FUNCTION public.touch_member_nutrition_targets();

-- 3. Tunable formula settings (single-row config table)
CREATE TABLE IF NOT EXISTS public.nutrition_target_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deficit_percent numeric(4,2) NOT NULL DEFAULT 0.20,
  surplus_percent numeric(4,2) NOT NULL DEFAULT 0.10,
  protein_g_per_kg numeric(4,2) NOT NULL DEFAULT 2.0,
  fat_g_per_kg numeric(4,2) NOT NULL DEFAULT 0.9,
  pal_sedentary numeric(4,2) NOT NULL DEFAULT 1.2,
  pal_light numeric(4,2) NOT NULL DEFAULT 1.375,
  pal_moderate numeric(4,2) NOT NULL DEFAULT 1.55,
  pal_very numeric(4,2) NOT NULL DEFAULT 1.725,
  pal_extra numeric(4,2) NOT NULL DEFAULT 1.9,
  water_ml_per_kg integer NOT NULL DEFAULT 35,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nutrition_target_settings TO authenticated;
GRANT ALL ON public.nutrition_target_settings TO service_role;

ALTER TABLE public.nutrition_target_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read settings"
  ON public.nutrition_target_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage settings"
  ON public.nutrition_target_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_nutrition_target_settings_touch
  BEFORE UPDATE ON public.nutrition_target_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_member_nutrition_targets();

INSERT INTO public.nutrition_target_settings DEFAULT VALUES;