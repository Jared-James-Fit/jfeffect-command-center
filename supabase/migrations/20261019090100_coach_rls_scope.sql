-- Second-coach readiness: a coach reads and writes only their own clients.
--
-- Audit of every live policy (drizzle + supabase migrations replayed in
-- order) that lets a coach in without is_assigned_coach*. Fixed here:
--
--  * support_alerts: SELECT/UPDATE had `OR is_coach_or_admin(...)`, which
--    let any coach see and resolve every client's alerts (pain, missed
--    check-ins). Now admin or the assigned coach. Alerts with no client
--    (member/community) stay admin-only.
--  * nutrition_ai_plans, pl_completion_link_review, athlete_xp_events:
--    role-only coach read. Now assigned coach.
--  * member_payment_ledger: coaches had FOR ALL (read AND write) on assigned
--    members' payments. Coaches don't see the books: now admin only (the
--    finance role's read policy lives with the finance PR).
--  * payment_share_links: any coach read every link. Now the assigned coach
--    of the purchase's client.
--  * warmup_assignments: any coach could edit any client's warmups. Client,
--    block and day scopes now need the assigned coach; exercise scope
--    (library-wide default) stays open to coaches.
--  * progress_* coach policies compared clients.assigned_coach_id (a
--    coaches.id) with auth.uid() (a user id). They never matched, so a hired
--    coach would see none of their clients' check-ins, measurements,
--    bodyweight or photos. Now is_assigned_coach(c.id).
--  * user_can_access_progress(): didn't check the coach is still active.
--  * chat_reports (member DM/crew reports, with the last messages): any coach
--    read and updated every report. Now admin or the reporter's assigned
--    coach, who is the coach the report is for (AGENTS.md: reports are the
--    coach's window into member chats).
--
-- Left as is, by design or pending a decision (see the PR):
--  group chats (team-wide), events, tasks, resources, mass_message_log,
--  member_support_* (members have no assigned coach), config tables.

-- support_alerts -------------------------------------------------------------
DROP POLICY IF EXISTS "Coaches view alerts for their clients" ON public.support_alerts;
CREATE POLICY "Coaches view alerts for their clients" ON public.support_alerts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (support_alerts.client_id IS NOT NULL AND public.is_assigned_coach(support_alerts.client_id))
  );

DROP POLICY IF EXISTS "Coaches update alerts" ON public.support_alerts;
CREATE POLICY "Coaches update alerts" ON public.support_alerts
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (support_alerts.client_id IS NOT NULL AND public.is_assigned_coach(support_alerts.client_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (support_alerts.client_id IS NOT NULL AND public.is_assigned_coach(support_alerts.client_id))
  );

-- nutrition_ai_plans ---------------------------------------------------------
DROP POLICY IF EXISTS "staff read nutrition ai plans" ON public.nutrition_ai_plans;
CREATE POLICY "staff read nutrition ai plans" ON public.nutrition_ai_plans
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

-- pl_completion_link_review --------------------------------------------------
DROP POLICY IF EXISTS "Admins and coaches can read completion link review" ON public.pl_completion_link_review;
CREATE POLICY "Admins and coaches can read completion link review" ON public.pl_completion_link_review
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

-- athlete_xp_events ----------------------------------------------------------
DROP POLICY IF EXISTS "Athletes read own xp" ON public.athlete_xp_events;
CREATE POLICY "Athletes read own xp" ON public.athlete_xp_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_assigned_coach(client_id)
  );

-- member_payment_ledger ------------------------------------------------------
DROP POLICY IF EXISTS "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "admin_full_access_payment_ledger" ON public.member_payment_ledger
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- payment_share_links --------------------------------------------------------
DROP POLICY IF EXISTS "Staff can view payment share links" ON public.payment_share_links;
CREATE POLICY "Staff can view payment share links" ON public.payment_share_links
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.purchase_records pr
       WHERE pr.id = payment_share_links.purchase_record_id
         AND pr.client_id IS NOT NULL
         AND public.is_assigned_coach(pr.client_id)
    )
  );

-- warmup_assignments ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_warmup_assignment(
  _scope text, _client_id uuid, _pl_block_id uuid, _pl_day_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
      OR (public.is_coach_or_admin(auth.uid()) AND CASE _scope
            WHEN 'exercise' THEN true
            WHEN 'client' THEN public.is_assigned_coach(_client_id)
            WHEN 'pl_block' THEN EXISTS (
              SELECT 1 FROM public.pl_blocks b
               WHERE b.id = _pl_block_id AND public.is_assigned_coach(b.client_id))
            WHEN 'pl_day' THEN EXISTS (
              SELECT 1 FROM public.pl_days d
                JOIN public.pl_weeks w ON w.id = d.week_id
                JOIN public.pl_blocks b ON b.id = w.block_id
               WHERE d.id = _pl_day_id AND public.is_assigned_coach(b.client_id))
            ELSE false
          END)
$$;
REVOKE ALL ON FUNCTION public.can_manage_warmup_assignment(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_warmup_assignment(text, uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "warmup_assignments_admin_coach_all" ON public.warmup_assignments;
CREATE POLICY "warmup_assignments_admin_coach_all" ON public.warmup_assignments
  FOR ALL TO authenticated
  USING (public.can_manage_warmup_assignment(scope, client_id, pl_block_id, pl_day_id))
  WITH CHECK (public.can_manage_warmup_assignment(scope, client_id, pl_block_id, pl_day_id));

-- progress_* (assigned_coach_id is a coaches.id, never auth.uid()) -----------
DROP POLICY IF EXISTS "Coach read assigned bodyweight" ON public.progress_bodyweight;
CREATE POLICY "Coach read assigned bodyweight" ON public.progress_bodyweight
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.user_id = progress_bodyweight.user_id AND public.is_assigned_coach(c.id)));

DROP POLICY IF EXISTS "Coach read assigned schedules" ON public.progress_check_in_schedules;
CREATE POLICY "Coach read assigned schedules" ON public.progress_check_in_schedules
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.user_id = progress_check_in_schedules.user_id AND public.is_assigned_coach(c.id)));

DROP POLICY IF EXISTS "Coach read assigned measurements" ON public.progress_measurements;
CREATE POLICY "Coach read assigned measurements" ON public.progress_measurements
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.user_id = progress_measurements.user_id AND public.is_assigned_coach(c.id)));

DROP POLICY IF EXISTS "Coach read assigned media" ON public.progress_media;
CREATE POLICY "Coach read assigned media" ON public.progress_media
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.progress_submissions s
                  WHERE s.id = progress_media.submission_id AND s.client_id IS NOT NULL
                    AND public.is_assigned_coach(s.client_id)));

DROP POLICY IF EXISTS "Coach manage assigned review responses" ON public.progress_review_responses;
CREATE POLICY "Coach manage assigned review responses" ON public.progress_review_responses
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.progress_submissions s
                  WHERE s.id = progress_review_responses.submission_id AND s.client_id IS NOT NULL
                    AND public.is_assigned_coach(s.client_id)))
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.progress_submissions s
                 WHERE s.id = progress_review_responses.submission_id AND s.client_id IS NOT NULL
                   AND public.is_assigned_coach(s.client_id))
  );

DROP POLICY IF EXISTS "Coach read assigned submissions" ON public.progress_submissions;
CREATE POLICY "Coach read assigned submissions" ON public.progress_submissions
  FOR SELECT TO authenticated
  USING (client_id IS NOT NULL AND public.is_assigned_coach(client_id));

DROP POLICY IF EXISTS "Coach update assigned submissions" ON public.progress_submissions;
CREATE POLICY "Coach update assigned submissions" ON public.progress_submissions
  FOR UPDATE TO authenticated
  USING (client_id IS NOT NULL AND public.is_assigned_coach(client_id))
  WITH CHECK (client_id IS NOT NULL AND public.is_assigned_coach(client_id));

DROP POLICY IF EXISTS "Coach read assigned progress-media objects" ON storage.objects;
CREATE POLICY "Coach read assigned progress-media objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'progress-media'
    AND EXISTS (SELECT 1 FROM public.clients c
                 WHERE c.user_id::text = (storage.foldername(storage.objects.name))[1]
                   AND public.is_assigned_coach(c.id))
  );

-- user_can_access_progress: assigned AND still an active coach ---------------
CREATE OR REPLACE FUNCTION public.user_can_access_progress(_target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() = _target_user
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_assigned_coach_by_user_id(_target_user);
$$;

-- chat_reports ---------------------------------------------------------------
DROP POLICY IF EXISTS "chat_reports_staff_read" ON public.chat_reports;
CREATE POLICY "chat_reports_staff_read" ON public.chat_reports FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (reporter_client_id IS NOT NULL AND public.is_assigned_coach(reporter_client_id))
  );
DROP POLICY IF EXISTS "chat_reports_staff_update" ON public.chat_reports;
CREATE POLICY "chat_reports_staff_update" ON public.chat_reports FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (reporter_client_id IS NOT NULL AND public.is_assigned_coach(reporter_client_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (reporter_client_id IS NOT NULL AND public.is_assigned_coach(reporter_client_id))
  );
