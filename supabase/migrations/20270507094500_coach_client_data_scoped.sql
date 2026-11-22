-- A coach sees their own clients' records, never every client's.
--
-- These tables hold one client's data but let any coach (or any active coach
-- record, is_coach_or_admin) read it, whoever the client's coach is, and some
-- let them change it:
--   nutrition_ai_plans          every client's AI targets and meal plan (has_role coach)
--   support_alerts              read and change any client's alerts (a trailing OR is_coach_or_admin)
--   pl_completion_link_review   every client's workout-link review rows
--   warmup_assignments          read and write warm-ups assigned to any client, block or day
--   event_assignments           read and write any client's event assignments
--   mass_message_log            every staff broadcast's words and audience
--   submission_reviews, fillout_submissions and the submission_* tables that
--   hang off a review: rows with client_id IS NULL (unmatched submissions,
--   website entries) were readable by every coach
--
-- Now: the admin as before; a coach only for clients assigned to them
-- (`client_id IN (SELECT coached_client_ids())`, read once per query), and
-- rows that belong to no client (unmatched submissions, system alerts) are
-- the admin's. Clients, the finance login and the server are unchanged.
--
-- Left team-wide on purpose (shared business resources, not one client's):
-- the task board (works_task_board), the exercise library, program templates
-- and warm-up protocols, the organization's forms, booking setup, Crew
-- moderation by staff, and warm-up assignments on a library exercise
-- (scope 'exercise').

SET lock_timeout = '5s';

-- ── nutrition_ai_plans ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "staff read nutrition ai plans" ON public.nutrition_ai_plans;
CREATE POLICY "staff read nutrition ai plans" ON public.nutrition_ai_plans
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR client_id IN (SELECT public.coached_client_ids())
  );
SELECT public.rls_evaluate_once('nutrition_ai_plans');

-- ── support_alerts ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Coaches view alerts for their clients" ON public.support_alerts;
CREATE POLICY "Coaches view alerts for their clients" ON public.support_alerts
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR client_id IN (SELECT public.coached_client_ids())
    OR (coach_id IS NOT NULL AND coach_id = (SELECT public.current_coach_id())
        AND (SELECT public.is_coach_or_admin((SELECT auth.uid()))))
  );
DROP POLICY IF EXISTS "Coaches update alerts" ON public.support_alerts;
CREATE POLICY "Coaches update alerts" ON public.support_alerts
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR client_id IN (SELECT public.coached_client_ids())
    OR (coach_id IS NOT NULL AND coach_id = (SELECT public.current_coach_id())
        AND (SELECT public.is_coach_or_admin((SELECT auth.uid()))))
  )
  WITH CHECK (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR client_id IN (SELECT public.coached_client_ids())
    OR (coach_id IS NOT NULL AND coach_id = (SELECT public.current_coach_id())
        AND (SELECT public.is_coach_or_admin((SELECT auth.uid()))))
  );
SELECT public.rls_evaluate_once('support_alerts');

-- ── pl_completion_link_review ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins and coaches can read completion link review" ON public.pl_completion_link_review;
CREATE POLICY "Admins and coaches can read completion link review" ON public.pl_completion_link_review
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR client_id IN (SELECT public.coached_client_ids())
  );
SELECT public.rls_evaluate_once('pl_completion_link_review');

-- ── warmup_assignments ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "warmup_assignments_admin_coach_all" ON public.warmup_assignments;
DROP POLICY IF EXISTS "warmup_assignments_admin_all" ON public.warmup_assignments;
CREATE POLICY "warmup_assignments_admin_all" ON public.warmup_assignments
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
DROP POLICY IF EXISTS "warmup_assignments_coach_own_clients" ON public.warmup_assignments;
CREATE POLICY "warmup_assignments_coach_own_clients" ON public.warmup_assignments
  FOR ALL TO authenticated
  USING (
    (SELECT public.is_coach_or_admin((SELECT auth.uid())))
    AND (
      scope = 'exercise'
      OR (scope = 'client' AND client_id IN (SELECT public.coached_client_ids()))
      OR (scope = 'pl_block' AND pl_block_id IN (
            SELECT b.id FROM public.pl_blocks b WHERE b.client_id IN (SELECT public.coached_client_ids())))
      OR (scope = 'pl_day' AND pl_day_id IN (
            SELECT d.id FROM public.pl_days d
              JOIN public.pl_weeks w ON w.id = d.week_id
              JOIN public.pl_blocks b ON b.id = w.block_id
             WHERE b.client_id IN (SELECT public.coached_client_ids())))
    )
  )
  WITH CHECK (
    (SELECT public.is_coach_or_admin((SELECT auth.uid())))
    AND (
      scope = 'exercise'
      OR (scope = 'client' AND client_id IN (SELECT public.coached_client_ids()))
      OR (scope = 'pl_block' AND pl_block_id IN (
            SELECT b.id FROM public.pl_blocks b WHERE b.client_id IN (SELECT public.coached_client_ids())))
      OR (scope = 'pl_day' AND pl_day_id IN (
            SELECT d.id FROM public.pl_days d
              JOIN public.pl_weeks w ON w.id = d.week_id
              JOIN public.pl_blocks b ON b.id = w.block_id
             WHERE b.client_id IN (SELECT public.coached_client_ids())))
    )
  );
SELECT public.rls_evaluate_once('warmup_assignments');

-- ── event_assignments ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "event_assignments_admin_coach_all" ON public.event_assignments;
DROP POLICY IF EXISTS "event_assignments_admin_all" ON public.event_assignments;
CREATE POLICY "event_assignments_admin_all" ON public.event_assignments
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
DROP POLICY IF EXISTS "event_assignments_coach_own_clients" ON public.event_assignments;
CREATE POLICY "event_assignments_coach_own_clients" ON public.event_assignments
  FOR ALL TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK (client_id IN (SELECT public.coached_client_ids()));
SELECT public.rls_evaluate_once('event_assignments');

-- ── mass_message_log ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mass_message_log_select" ON public.mass_message_log;
CREATE POLICY "mass_message_log_select" ON public.mass_message_log
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR (sent_by = (SELECT auth.uid()) AND (SELECT public.is_coach_or_admin((SELECT auth.uid()))))
  );
SELECT public.rls_evaluate_once('mass_message_log');

-- ── submission_reviews ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "submission_reviews coach read assigned" ON public.submission_reviews;
CREATE POLICY "submission_reviews coach read assigned" ON public.submission_reviews
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "submission_reviews coach update assigned" ON public.submission_reviews;
CREATE POLICY "submission_reviews coach update assigned" ON public.submission_reviews
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK (client_id IN (SELECT public.coached_client_ids()));
SELECT public.rls_evaluate_once('submission_reviews');

-- The tables that hang off a review: a coach's own clients' reviews only.
DROP POLICY IF EXISTS "scheduled_responses coach read" ON public.scheduled_submission_responses;
CREATE POLICY "scheduled_responses coach read" ON public.scheduled_submission_responses
  FOR SELECT TO authenticated
  USING (review_id IN (SELECT r.id FROM public.submission_reviews r WHERE r.client_id IN (SELECT public.coached_client_ids())));
SELECT public.rls_evaluate_once('scheduled_submission_responses');

DROP POLICY IF EXISTS "submission_ai_generations coach read assigned" ON public.submission_ai_generations;
CREATE POLICY "submission_ai_generations coach read assigned" ON public.submission_ai_generations
  FOR SELECT TO authenticated
  USING (review_id IN (SELECT r.id FROM public.submission_reviews r WHERE r.client_id IN (SELECT public.coached_client_ids())));
SELECT public.rls_evaluate_once('submission_ai_generations');

DROP POLICY IF EXISTS "audit_events coach read" ON public.submission_audit_events;
CREATE POLICY "audit_events coach read" ON public.submission_audit_events
  FOR SELECT TO authenticated
  USING (review_id IN (SELECT r.id FROM public.submission_reviews r WHERE r.client_id IN (SELECT public.coached_client_ids())));
DROP POLICY IF EXISTS "audit_events coach insert" ON public.submission_audit_events;
CREATE POLICY "audit_events coach insert" ON public.submission_audit_events
  FOR INSERT TO authenticated
  WITH CHECK (review_id IN (SELECT r.id FROM public.submission_reviews r WHERE r.client_id IN (SELECT public.coached_client_ids())));
SELECT public.rls_evaluate_once('submission_audit_events');

DROP POLICY IF EXISTS "delivery_attempts coach read" ON public.submission_delivery_attempts;
CREATE POLICY "delivery_attempts coach read" ON public.submission_delivery_attempts
  FOR SELECT TO authenticated
  USING (review_id IN (SELECT r.id FROM public.submission_reviews r WHERE r.client_id IN (SELECT public.coached_client_ids())));
SELECT public.rls_evaluate_once('submission_delivery_attempts');

-- ── fillout_submissions ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "fillout_submissions coach read" ON public.fillout_submissions;
CREATE POLICY "fillout_submissions coach read" ON public.fillout_submissions
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "fillout_submissions coach update" ON public.fillout_submissions;
CREATE POLICY "fillout_submissions coach update" ON public.fillout_submissions
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK (client_id IN (SELECT public.coached_client_ids()));
SELECT public.rls_evaluate_once('fillout_submissions');
