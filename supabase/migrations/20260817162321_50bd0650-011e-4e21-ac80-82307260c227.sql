
DROP POLICY IF EXISTS "Anyone authenticated can read task definitions" ON public.coach_task_definitions;
CREATE POLICY "Staff read task definitions" ON public.coach_task_definitions FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated read member_access_defaults" ON public.member_access_defaults;
CREATE POLICY "Staff read member_access_defaults" ON public.member_access_defaults FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "nas_read_authenticated" ON public.nutrition_automation_settings;
CREATE POLICY "nas_read_staff" ON public.nutrition_automation_settings FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "Anyone authenticated can read settings" ON public.nutrition_target_settings;
CREATE POLICY "Staff read nutrition target settings" ON public.nutrition_target_settings FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "jp read all authenticated" ON public.jurisdiction_profiles;
CREATE POLICY "jp read staff" ON public.jurisdiction_profiles FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "nat read all" ON public.na_templates;
CREATE POLICY "nat read staff" ON public.na_templates FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "natv read all" ON public.na_template_versions;
CREATE POLICY "natv read staff" ON public.na_template_versions FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "lm read all" ON public.legal_modules;
CREATE POLICY "lm read staff" ON public.legal_modules FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "lmv read all" ON public.legal_module_versions;
CREATE POLICY "lmv read staff" ON public.legal_module_versions FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));
