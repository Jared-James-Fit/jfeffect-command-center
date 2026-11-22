-- Rollback for 20270508090000_nutrition_studio.sql (Nutrition Studio).
-- Members' own plans stay in nutrition_targets (they're plans like any other);
-- only the member write path, custom foods and saved meals go.
-- Custom foods and saved meals are dropped with their rows: export them first
-- if anyone has made any (SELECT count(*) FROM public.nutrition_custom_foods;).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS nutrition_targets_member_plan ON public.nutrition_targets;
DROP FUNCTION IF EXISTS public.tg_nutrition_targets_member_plan();
DROP POLICY IF EXISTS "Members manage their own plan days" ON public.nutrition_target_days;
DROP POLICY IF EXISTS "Members manage their own plan" ON public.nutrition_targets;
DROP FUNCTION IF EXISTS public.my_own_nutrition_plan_ids();
DROP FUNCTION IF EXISTS public.my_self_serve_client_ids();
DROP TABLE IF EXISTS public.nutrition_meal_templates;
DROP TABLE IF EXISTS public.nutrition_custom_foods;
COMMIT;
