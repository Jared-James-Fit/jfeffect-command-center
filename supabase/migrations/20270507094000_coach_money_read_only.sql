-- A coach reads their own clients' money; they never write it.
--
-- "Coach manage assigned purchase_records" (20260604191159) was FOR ALL: any
-- coach could insert, change or delete a sale for a client assigned to them
-- straight through the API, amounts, payment status and session counts
-- included (which session credits and the books read). The member ledger had
-- the same FOR ALL for coaches, and coaching package enrollments (a client's
-- contracted price and the sale that anchors their included calls) were
-- coach-writable. Sales, payments, prices and packages are the owner's
-- (billing.manage in docs/COACHING_PLATFORM.md), and money permissions aren't
-- grantable to a coach until the money functions take a client and check it.
--
-- Now, for a coach: read-only, and only for clients assigned to them.
--   purchase_records              SELECT for coached clients (was FOR ALL)
--   member_payment_ledger         SELECT for a coached member (was FOR ALL)
--   coaching_package_enrollments  SELECT for coached clients (insert / update now the admin's)
--   payment_share_links           SELECT for coached clients' sales (was every coach, every sale)
-- Admins, the finance login, clients and the server are unchanged.
--
-- Coach flows that still write money keep working through code that checks
-- the assignment itself:
--   * Charge for it (sellSessions → sell_booked_sessions, SECURITY DEFINER,
--     admin or the client's own coach) makes the sale; its checkout and short
--     link are saved by createAssignmentCheckout / mintShareLinkForPurchase,
--     which read the sale through the coach's own RLS (assigned clients only)
--     and save the link with the service role.
--   * PT session credits follow the session's status in the database
--     (pt_session_settle_credit), which a coach changes on their own client's
--     sessions as before.
-- Everything else that writes a sale is the admin's (AssignOfferDialog, Quick
-- sell, renew_session_package, recordPayment, refunds, archiving a sale).

SET lock_timeout = '5s';

-- ── purchase_records ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Coach manage assigned purchase_records" ON public.purchase_records;
DROP POLICY IF EXISTS "Coach read assigned purchase_records" ON public.purchase_records;
CREATE POLICY "Coach read assigned purchase_records" ON public.purchase_records
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()));

SELECT public.rls_evaluate_once('purchase_records');

-- ── member_payment_ledger ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_coach_full_access_payment_ledger" ON public.member_payment_ledger;
DROP POLICY IF EXISTS "Admin manage member_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "Admin manage member_payment_ledger" ON public.member_payment_ledger
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
DROP POLICY IF EXISTS "Coach read assigned member_payment_ledger" ON public.member_payment_ledger;
CREATE POLICY "Coach read assigned member_payment_ledger" ON public.member_payment_ledger
  FOR SELECT TO authenticated
  USING (member_id IN (
    SELECT m.id FROM public.app_members m
      JOIN public.clients c ON c.user_id = m.user_id
     WHERE c.id IN (SELECT public.coached_client_ids())
  ));

SELECT public.rls_evaluate_once('member_payment_ledger');

-- ── coaching_package_enrollments ───────────────────────────────────────────
DROP POLICY IF EXISTS "Staff add package enrollments" ON public.coaching_package_enrollments;
DROP POLICY IF EXISTS "Staff change package enrollments" ON public.coaching_package_enrollments;
DROP POLICY IF EXISTS "Admins add package enrollments" ON public.coaching_package_enrollments;
CREATE POLICY "Admins add package enrollments" ON public.coaching_package_enrollments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
DROP POLICY IF EXISTS "Admins change package enrollments" ON public.coaching_package_enrollments;
CREATE POLICY "Admins change package enrollments" ON public.coaching_package_enrollments
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
-- "Staff read package enrollments" (admin, or a coached client) stays as it is.

SELECT public.rls_evaluate_once('coaching_package_enrollments');

-- ── payment_share_links ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can view payment share links" ON public.payment_share_links;
DROP POLICY IF EXISTS "Admins view payment share links" ON public.payment_share_links;
CREATE POLICY "Admins view payment share links" ON public.payment_share_links
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
DROP POLICY IF EXISTS "Coaches view their clients' payment share links" ON public.payment_share_links;
CREATE POLICY "Coaches view their clients' payment share links" ON public.payment_share_links
  FOR SELECT TO authenticated
  USING (purchase_record_id IN (
    SELECT pr.id FROM public.purchase_records pr
     WHERE pr.client_id IN (SELECT public.coached_client_ids())
  ));

SELECT public.rls_evaluate_once('payment_share_links');
