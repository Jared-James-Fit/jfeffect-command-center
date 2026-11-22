-- Nutrition Studio (docs/COACHING_PLATFORM.md, phase 2).
--
-- 1. Custom foods: a food from its label (per 100 g or per serving), private to
--    whoever made it. The Studio searches them beside the built-in staples
--    (src/lib/nutrition-studio/foods.ts). org_id is for a later organization
--    library and stays empty until organizations are opened up.
-- 2. Saved meals: a meal's food lines kept to drop into any day, private to
--    whoever saved them.
-- 3. A JF member's own meal plan: a self-serve member writes their own plan in
--    the same tables as a coach's (nutrition_targets / nutrition_target_days),
--    so the meal cards, the PDF, the grocery list and the food log read it the
--    same way. A coaching client still can't write theirs: it's their coach's.
--    A member's plan never names a coach and is always shown to them.

SET lock_timeout = '5s';

-- ── Custom foods ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nutrition_custom_foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  brand text CHECK (brand IS NULL OR length(brand) <= 80),
  basis text NOT NULL CHECK (basis IN ('per_100g', 'per_serving')),
  serving_label text CHECK (serving_label IS NULL OR length(serving_label) <= 40),
  serving_grams numeric CHECK (serving_grams IS NULL OR (serving_grams > 0 AND serving_grams <= 5000)),
  kcal numeric NOT NULL CHECK (kcal >= 0 AND kcal <= 5000),
  protein numeric NOT NULL CHECK (protein >= 0 AND protein <= 500),
  carbs numeric NOT NULL CHECK (carbs >= 0 AND carbs <= 500),
  fat numeric NOT NULL CHECK (fat >= 0 AND fat <= 500),
  category text CHECK (category IS NULL OR category IN ('protein', 'carb', 'fat', 'veg', 'fruit', 'dairy', 'extra')),
  source text NOT NULL DEFAULT 'label' CHECK (source IN ('label', 'manual', 'import')),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 100 g of a food can't hold more than 100 g of protein, carbs and fat
  CONSTRAINT nutrition_custom_foods_per100_possible CHECK (basis <> 'per_100g' OR protein + carbs + fat <= 100.5)
);
CREATE INDEX IF NOT EXISTS nutrition_custom_foods_owner ON public.nutrition_custom_foods (owner_user_id) WHERE NOT archived;

-- ── Saved meals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nutrition_meal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- the meal's food lines as a plan writes them ("150 g cooked chicken breast")
  lines text[] NOT NULL CHECK (cardinality(lines) BETWEEN 1 AND 30),
  timing text CHECK (timing IS NULL OR timing IN ('pre', 'post', 'pre_post')),
  kcal numeric, protein numeric, carbs numeric, fat numeric,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nutrition_meal_templates_owner ON public.nutrition_meal_templates (owner_user_id) WHERE NOT archived;

DROP TRIGGER IF EXISTS nutrition_custom_foods_updated_at ON public.nutrition_custom_foods;
CREATE TRIGGER nutrition_custom_foods_updated_at BEFORE UPDATE ON public.nutrition_custom_foods
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS nutrition_meal_templates_updated_at ON public.nutrition_meal_templates;
CREATE TRIGGER nutrition_meal_templates_updated_at BEFORE UPDATE ON public.nutrition_meal_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.nutrition_custom_foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_meal_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nutrition_custom_foods, public.nutrition_meal_templates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_custom_foods, public.nutrition_meal_templates TO authenticated;
GRANT ALL ON public.nutrition_custom_foods, public.nutrition_meal_templates TO service_role;

-- Own rows only. org_id stays empty until organization libraries exist.
DROP POLICY IF EXISTS "Own custom foods" ON public.nutrition_custom_foods;
CREATE POLICY "Own custom foods" ON public.nutrition_custom_foods
  FOR ALL TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND org_id IS NULL);

DROP POLICY IF EXISTS "Own saved meals" ON public.nutrition_meal_templates;
CREATE POLICY "Own saved meals" ON public.nutrition_meal_templates
  FOR ALL TO authenticated
  USING (owner_user_id = (SELECT auth.uid()))
  WITH CHECK (owner_user_id = (SELECT auth.uid()) AND org_id IS NULL);

-- ── A member's own plan ────────────────────────────────────────────────────

/** The signed-in person's own self-serve athlete record (a JF member), as a set. */
CREATE OR REPLACE FUNCTION public.my_self_serve_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id FROM public.clients c
   WHERE c.user_id = auth.uid() AND c.service_tier = 'self_serve' AND NOT coalesce(c.archived, false)
$$;
REVOKE ALL ON FUNCTION public.my_self_serve_client_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_self_serve_client_ids() TO authenticated, service_role;

/** The plans a member may write: their own. */
CREATE OR REPLACE FUNCTION public.my_own_nutrition_plan_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.id FROM public.nutrition_targets t
   WHERE t.client_id IN (SELECT public.my_self_serve_client_ids())
$$;
REVOKE ALL ON FUNCTION public.my_own_nutrition_plan_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_own_nutrition_plan_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS "Members manage their own plan" ON public.nutrition_targets;
CREATE POLICY "Members manage their own plan" ON public.nutrition_targets
  FOR ALL TO authenticated
  USING (client_id IN (SELECT public.my_self_serve_client_ids()))
  WITH CHECK (client_id IN (SELECT public.my_self_serve_client_ids()));

DROP POLICY IF EXISTS "Members manage their own plan days" ON public.nutrition_target_days;
CREATE POLICY "Members manage their own plan days" ON public.nutrition_target_days
  FOR ALL TO authenticated
  USING (target_id IN (SELECT public.my_own_nutrition_plan_ids()))
  WITH CHECK (target_id IN (SELECT public.my_own_nutrition_plan_ids()));

/**
 * A plan written by its member (not staff): never names a coach and is always
 * theirs to see. Staff writes (the coach's editor, the server) are untouched.
 */
CREATE OR REPLACE FUNCTION public.tg_nutrition_targets_member_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IN (SELECT public.my_self_serve_client_ids())
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'coach') THEN
    NEW.assigned_coach_id := NULL;
    NEW.visible_to_client := true;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_nutrition_targets_member_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nutrition_targets_member_plan ON public.nutrition_targets;
CREATE TRIGGER nutrition_targets_member_plan
  BEFORE INSERT OR UPDATE ON public.nutrition_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_nutrition_targets_member_plan();

RESET lock_timeout;
