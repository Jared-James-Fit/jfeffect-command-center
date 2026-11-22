-- Rollback for the Nov 22 2026 coach authorization hardening:
--   §1 supabase/migrations/20270507093000_cleo_actions_run_as_requester.sql
--   §2 supabase/migrations/20270507094000_coach_money_read_only.sql
--   §3 supabase/migrations/20270507094500_coach_client_data_scoped.sql
-- Each section stands alone (its own transaction) and puts back the policies
-- exactly as the latest migration before them wrote them (each one's source is
-- named). Run as the database owner, only the sections you need, newest first.
--
-- The app side:
--   §1 the code (cleo-actions.server.ts) calls cleo_action_target_allowed and
--      cleo_mark_client_reviews_reviewed_as; without them a coach's approved
--      request fails closed ("Cleo can't run coach requests until the database
--      is updated") and nothing runs as the owner. To bring back the old
--      behaviour (approval ran as the owner) revert the app commit as well.
--   §2 a coach's Add sale / archive-a-sale / membership payment were also
--      narrowed in code (purchase-archive.functions.ts,
--      member-payment-ledger.functions.ts); revert those files for the old flow.
--   §3 nothing in the app depends on it.

SET lock_timeout = '5s';

-- ── §3. Client data scoped to a coach's own clients ─────────────────────────
BEGIN;

-- 20261005090000_nutrition_ai_plans.sql
DROP POLICY IF EXISTS "staff read nutrition ai plans" ON public.nutrition_ai_plans;
CREATE POLICY "staff read nutrition ai plans" ON public.nutrition_ai_plans FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role));

-- 20260612185330_ceb4bb50-70a0-44a2-a4cd-bda4394d9f7e.sql
DROP POLICY IF EXISTS "Coaches view alerts for their clients" ON public.support_alerts;
CREATE POLICY "Coaches view alerts for their clients" ON public.support_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         OR (support_alerts.client_id IS NOT NULL AND public.is_assigned_coach(support_alerts.client_id))
         OR public.is_coach_or_admin(auth.uid()));
DROP POLICY IF EXISTS "Coaches update alerts" ON public.support_alerts;
CREATE POLICY "Coaches update alerts" ON public.support_alerts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_coach_or_admin(auth.uid()));

-- 20260708162344_68de3a25-bb14-48b4-a7a8-65af8aa3b6be.sql
DROP POLICY IF EXISTS "Admins and coaches can read completion link review" ON public.pl_completion_link_review;
CREATE POLICY "Admins and coaches can read completion link review" ON public.pl_completion_link_review FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'coach'::app_role));

-- 20260611035111_3f9bb1a3-1777-4d5b-81df-3d9a04b33c38.sql
DROP POLICY IF EXISTS "warmup_assignments_admin_all" ON public.warmup_assignments;
DROP POLICY IF EXISTS "warmup_assignments_coach_own_clients" ON public.warmup_assignments;
DROP POLICY IF EXISTS "warmup_assignments_admin_coach_all" ON public.warmup_assignments;
CREATE POLICY "warmup_assignments_admin_coach_all" ON public.warmup_assignments FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid())) WITH CHECK (public.is_coach_or_admin(auth.uid()));

-- 20260610083818_9bcf776a-7fc9-4ed8-91ae-2ba71821553c.sql (event_assignments)
DROP POLICY IF EXISTS "event_assignments_admin_all" ON public.event_assignments;
DROP POLICY IF EXISTS "event_assignments_coach_own_clients" ON public.event_assignments;
DROP POLICY IF EXISTS "event_assignments_admin_coach_all" ON public.event_assignments;
CREATE POLICY "event_assignments_admin_coach_all" ON public.event_assignments FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid())) WITH CHECK (public.is_coach_or_admin(auth.uid()));

-- 20260610011032_fc6c9a86-24bc-460d-80de-faf68e23c84f.sql
DROP POLICY IF EXISTS "mass_message_log_select" ON public.mass_message_log;
CREATE POLICY "mass_message_log_select" ON public.mass_message_log FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

-- 20260613021244_59e28475-e160-4259-b6fc-978fdb0e9fdb.sql (submission reviews and their children)
DROP POLICY IF EXISTS "submission_reviews coach read assigned" ON public.submission_reviews;
CREATE POLICY "submission_reviews coach read assigned" ON public.submission_reviews FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()) AND (client_id IS NULL OR public.is_assigned_coach(client_id)));
DROP POLICY IF EXISTS "submission_reviews coach update assigned" ON public.submission_reviews;
CREATE POLICY "submission_reviews coach update assigned" ON public.submission_reviews FOR UPDATE TO authenticated
  USING (public.is_coach_or_admin(auth.uid()) AND client_id IS NOT NULL AND public.is_assigned_coach(client_id))
  WITH CHECK (public.is_coach_or_admin(auth.uid()) AND client_id IS NOT NULL AND public.is_assigned_coach(client_id));
DROP POLICY IF EXISTS "scheduled_responses coach read" ON public.scheduled_submission_responses;
CREATE POLICY "scheduled_responses coach read" ON public.scheduled_submission_responses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.submission_reviews r WHERE r.id = scheduled_submission_responses.review_id
                 AND public.is_coach_or_admin(auth.uid()) AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))));
DROP POLICY IF EXISTS "submission_ai_generations coach read assigned" ON public.submission_ai_generations;
CREATE POLICY "submission_ai_generations coach read assigned" ON public.submission_ai_generations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.submission_reviews r WHERE r.id = submission_ai_generations.review_id
                 AND public.is_coach_or_admin(auth.uid()) AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))));
DROP POLICY IF EXISTS "audit_events coach read" ON public.submission_audit_events;
CREATE POLICY "audit_events coach read" ON public.submission_audit_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.submission_reviews r WHERE r.id = submission_audit_events.review_id
                 AND public.is_coach_or_admin(auth.uid()) AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))));
DROP POLICY IF EXISTS "audit_events coach insert" ON public.submission_audit_events;
CREATE POLICY "audit_events coach insert" ON public.submission_audit_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.submission_reviews r WHERE r.id = submission_audit_events.review_id
                      AND public.is_coach_or_admin(auth.uid()) AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))));
DROP POLICY IF EXISTS "delivery_attempts coach read" ON public.submission_delivery_attempts;
CREATE POLICY "delivery_attempts coach read" ON public.submission_delivery_attempts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.submission_reviews r WHERE r.id = submission_delivery_attempts.review_id
                 AND public.is_coach_or_admin(auth.uid()) AND (r.client_id IS NULL OR public.is_assigned_coach(r.client_id))));

-- 20260610191403_022ebea6-1620-4efb-8ef8-e164423af92b.sql and 20260616154052_fdd2faf3-5f5d-489e-b484-cfa086de5b15.sql
DROP POLICY IF EXISTS "fillout_submissions coach read" ON public.fillout_submissions;
CREATE POLICY "fillout_submissions coach read" ON public.fillout_submissions FOR SELECT
  USING (is_coach_or_admin(auth.uid()) AND (client_id IS NULL OR is_assigned_coach(client_id)));
DROP POLICY IF EXISTS "fillout_submissions coach update" ON public.fillout_submissions;
CREATE POLICY "fillout_submissions coach update" ON public.fillout_submissions FOR UPDATE TO authenticated
  USING (public.is_coach_or_admin(auth.uid()) AND (client_id IS NULL OR public.is_assigned_coach(client_id)))
  WITH CHECK (public.is_coach_or_admin(auth.uid()) AND (client_id IS NULL OR public.is_assigned_coach(client_id)));

COMMIT;

-- ── §2. Money read-only for a coach ─────────────────────────────────────────
BEGIN;

-- 20260604191159_5a79a117-bd96-4973-a6d1-eeb56d6efe48.sql
DROP POLICY IF EXISTS "Coach read assigned purchase_records" ON public.purchase_records;
DROP POLICY IF EXISTS "Coach manage assigned purchase_records" ON public.purchase_records;
CREATE POLICY "Coach manage assigned purchase_records" ON public.purchase_records FOR ALL TO authenticated
  USING (is_assigned_coach(client_id)) WITH CHECK (is_assigned_coach(client_id));

-- 20260720035258_8497dcf2-e9f1-49b0-8d7e-a74d9b33794b.sql
DROP POLICY IF EXISTS "Admin manage member_payment_ledger" ON public.member_payment_ledger;
DROP POLICY IF EXISTS "Coach read assigned member_payment_ledger" ON public.member_payment_ledger;
DROP POLICY IF EXISTS "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach_for_member(member_id)))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR (public.has_role(auth.uid(), 'coach'::app_role) AND public.is_assigned_coach_for_member(member_id)));

-- 20270505090000_coaching_packages.sql
DROP POLICY IF EXISTS "Admins add package enrollments" ON public.coaching_package_enrollments;
DROP POLICY IF EXISTS "Admins change package enrollments" ON public.coaching_package_enrollments;
DROP POLICY IF EXISTS "Staff add package enrollments" ON public.coaching_package_enrollments;
CREATE POLICY "Staff add package enrollments" ON public.coaching_package_enrollments FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));
DROP POLICY IF EXISTS "Staff change package enrollments" ON public.coaching_package_enrollments;
CREATE POLICY "Staff change package enrollments" ON public.coaching_package_enrollments FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

-- 20260822023044_b3bb1bac-12cc-4abf-b781-2ac9ef20f58c.sql
DROP POLICY IF EXISTS "Admins view payment share links" ON public.payment_share_links;
DROP POLICY IF EXISTS "Coaches view their clients' payment share links" ON public.payment_share_links;
DROP POLICY IF EXISTS "Staff can view payment share links" ON public.payment_share_links;
CREATE POLICY "Staff can view payment share links" ON public.payment_share_links FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coach'));

COMMIT;

-- ── §1. Cleo's cards run as the requester ───────────────────────────────────
BEGIN;

DROP FUNCTION IF EXISTS public.cleo_mark_client_reviews_reviewed_as(uuid, uuid);
DROP FUNCTION IF EXISTS public.cleo_action_target_allowed(uuid, uuid);
ALTER TABLE public.cleo_actions DROP CONSTRAINT IF EXISTS cleo_actions_runs_as_requester;
ALTER TABLE public.cleo_actions DROP COLUMN IF EXISTS executed_as;
COMMENT ON COLUMN public.cleo_actions.decided_by IS NULL;

-- 20261101090000_cleo_actions.sql
DROP POLICY IF EXISTS "cleo actions: requester and owner read" ON public.cleo_actions;
CREATE POLICY "cleo actions: requester and owner read" ON public.cleo_actions FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.is_business_owner(auth.uid()));

COMMIT;
