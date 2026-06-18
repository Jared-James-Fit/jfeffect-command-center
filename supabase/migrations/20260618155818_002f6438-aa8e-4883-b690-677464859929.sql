
-- client_goals_setup: remove blanket coach access, keep admin + assigned coach
DROP POLICY IF EXISTS "coach/admin can read goals setup" ON public.client_goals_setup;
DROP POLICY IF EXISTS "coach/admin can insert goals setup" ON public.client_goals_setup;
DROP POLICY IF EXISTS "coach/admin can update goals setup" ON public.client_goals_setup;

CREATE POLICY "coach/admin can read goals setup"
ON public.client_goals_setup FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR is_assigned_coach_for_client(client_id));

CREATE POLICY "coach/admin can insert goals setup"
ON public.client_goals_setup FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_assigned_coach_for_client(client_id));

CREATE POLICY "coach/admin can update goals setup"
ON public.client_goals_setup FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR is_assigned_coach_for_client(client_id))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_assigned_coach_for_client(client_id));

-- client_goals_setup_notes
DROP POLICY IF EXISTS "coach/admin can read goals notes" ON public.client_goals_setup_notes;
DROP POLICY IF EXISTS "coach/admin can insert goals notes" ON public.client_goals_setup_notes;

CREATE POLICY "coach/admin can read goals notes"
ON public.client_goals_setup_notes FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR is_assigned_coach_for_client(client_id));

CREATE POLICY "coach/admin can insert goals notes"
ON public.client_goals_setup_notes FOR INSERT
WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR is_assigned_coach_for_client(client_id)) AND author_id = auth.uid());

-- client_goals_setup_audit
DROP POLICY IF EXISTS "coach/admin can read goals audit" ON public.client_goals_setup_audit;

CREATE POLICY "coach/admin can read goals audit"
ON public.client_goals_setup_audit FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR is_assigned_coach_for_client(client_id));

-- member_nutrition_targets: replace blanket coach policy with assigned-coach scope
DROP POLICY IF EXISTS "Coaches manage all member nutrition targets" ON public.member_nutrition_targets;

CREATE POLICY "Coaches manage assigned member nutrition targets"
ON public.member_nutrition_targets FOR ALL
USING (is_assigned_coach_for_member(member_id))
WITH CHECK (is_assigned_coach_for_member(member_id));
