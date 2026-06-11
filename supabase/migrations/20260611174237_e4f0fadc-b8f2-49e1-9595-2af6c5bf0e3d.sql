
-- Anti-cheat RLS: require active/trialing JF subscription for protected member content

CREATE OR REPLACE FUNCTION public.member_can_consume(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members m
     WHERE m.user_id = _user_id
       AND m.status = 'Active'
       AND (
         m.account_type <> 'jf_member'
         OR m.subscription_status IN ('Trialing','Active')
       )
  )
$$;

-- member_plans: published + access key + (non-JF OR active/trialing JF)
DROP POLICY IF EXISTS "Members read published plans" ON public.member_plans;
CREATE POLICY "Members read published plans" ON public.member_plans
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    status = 'Published'
    AND (
      required_access_level IS NULL OR required_access_level = ''
      OR member_has_access(current_member_id(), required_access_level)
    )
    AND public.member_can_consume(auth.uid())
  )
);

-- member_resources: same pattern
DROP POLICY IF EXISTS "Members read published resources" ON public.member_resources;
CREATE POLICY "Members read published resources" ON public.member_resources
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    status = 'Published'
    AND (
      required_access_level IS NULL OR required_access_level = ''
      OR member_has_access(current_member_id(), required_access_level)
    )
    AND public.member_can_consume(auth.uid())
  )
);

-- member_plan_enrollments: split ALL into SELECT (read own) + write (must be consuming)
DROP POLICY IF EXISTS "Member manage own enrollments" ON public.member_plan_enrollments;
CREATE POLICY "Member read own enrollments" ON public.member_plan_enrollments
FOR SELECT USING (member_id = current_member_id());
CREATE POLICY "Member write own enrollments when active"
ON public.member_plan_enrollments
FOR ALL
USING (member_id = current_member_id() AND public.member_can_consume(auth.uid()))
WITH CHECK (member_id = current_member_id() AND public.member_can_consume(auth.uid()));

-- member_workout_completions: read own always; write only if consuming
DROP POLICY IF EXISTS "Member manage own completions" ON public.member_workout_completions;
CREATE POLICY "Member read own completions" ON public.member_workout_completions
FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.member_plan_enrollments e
   WHERE e.id = member_workout_completions.enrollment_id
     AND e.member_id = current_member_id()
));
CREATE POLICY "Member write own completions when active"
ON public.member_workout_completions
FOR ALL
USING (
  public.member_can_consume(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.member_plan_enrollments e
     WHERE e.id = member_workout_completions.enrollment_id
       AND e.member_id = current_member_id()
  )
)
WITH CHECK (
  public.member_can_consume(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.member_plan_enrollments e
     WHERE e.id = member_workout_completions.enrollment_id
       AND e.member_id = current_member_id()
  )
);

-- member_set_logs: same pattern
DROP POLICY IF EXISTS "Member manage own set logs" ON public.member_set_logs;
CREATE POLICY "Member read own set logs" ON public.member_set_logs
FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.member_plan_enrollments e
   WHERE e.id = member_set_logs.enrollment_id
     AND e.member_id = current_member_id()
));
CREATE POLICY "Member write own set logs when active"
ON public.member_set_logs
FOR ALL
USING (
  public.member_can_consume(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.member_plan_enrollments e
     WHERE e.id = member_set_logs.enrollment_id
       AND e.member_id = current_member_id()
  )
)
WITH CHECK (
  public.member_can_consume(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.member_plan_enrollments e
     WHERE e.id = member_set_logs.enrollment_id
       AND e.member_id = current_member_id()
  )
);

-- featured_member_items: must be active member (any account type) or admin
DROP POLICY IF EXISTS "Anyone authenticated can read active featured items" ON public.featured_member_items;
CREATE POLICY "Active members read featured items"
ON public.featured_member_items
FOR SELECT USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (active = true AND public.member_can_consume(auth.uid()))
);
