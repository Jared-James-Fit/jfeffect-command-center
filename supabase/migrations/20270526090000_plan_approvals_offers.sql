-- Plan switching, part 2 (Nov 24 2026): who may buy coaching, grandfathered
-- prices and consent, and the record of every decision.
--
--   * coaching_purchase_approvals: coaching is never bought without a coach's
--     yes. A member who has never been coached applies; a former coaching
--     client asks to come back; the coach (or admin) approves, and only then
--     can they pick a package and pay. One approval at a time per client,
--     valid 30 days, used up by the purchase it allowed. Written only by the
--     server; the client reads their own, staff their clients'.
--   * plan_changes.status 'offered': a switch the coach offers a client on a
--     grandfathered or custom price. Nothing changes until the client accepts
--     it in the app (consented_at, consent_text: the exact words they agreed
--     to, including that the old price ends). At most one open offer each.
--   * plan_changes decision columns: who approved or declined a request, when
--     and why (decided_by, decided_at, decision_note).

SET lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Offers and decisions on plan changes
-- ---------------------------------------------------------------------------
ALTER TABLE public.plan_changes DROP CONSTRAINT IF EXISTS plan_changes_status_check;
ALTER TABLE public.plan_changes
  ADD CONSTRAINT plan_changes_status_check
  CHECK (status IN ('checkout', 'processing', 'awaiting_payment', 'scheduled', 'applied', 'cancelled', 'failed', 'requested', 'offered'));

ALTER TABLE public.plan_changes
  ADD COLUMN IF NOT EXISTS offer_timing text CHECK (offer_timing IS NULL OR offer_timing IN ('now', 'period_end')),
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_text text CHECK (consent_text IS NULL OR char_length(consent_text) <= 2000),
  ADD COLUMN IF NOT EXISTS decided_by uuid,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  ADD COLUMN IF NOT EXISTS agreement_version text;

-- One open offer per client (an offer is accepted, declined or withdrawn before another).
CREATE UNIQUE INDEX IF NOT EXISTS plan_changes_one_offer
  ON public.plan_changes (client_id) WHERE status = 'offered';
-- One waiting request to come back to coaching per client.
CREATE UNIQUE INDEX IF NOT EXISTS plan_changes_one_reactivation
  ON public.plan_changes (client_id) WHERE status = 'requested' AND kind = 'reactivate';

-- ---------------------------------------------------------------------------
-- A coach's yes before anyone buys coaching
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coaching_purchase_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('application', 'reactivation', 'admin')),
  application_id uuid REFERENCES public.coaching_applications(id) ON DELETE SET NULL,
  request_change_id uuid REFERENCES public.plan_changes(id) ON DELETE SET NULL,
  -- null = any coaching package they can buy; else only this one
  package_id uuid REFERENCES public.coaching_packages(id) ON DELETE SET NULL,
  approved_by uuid,
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_change_id uuid REFERENCES public.plan_changes(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS coaching_purchase_approvals_one_live
  ON public.coaching_purchase_approvals (client_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS coaching_purchase_approvals_client_idx
  ON public.coaching_purchase_approvals (client_id, approved_at DESC);

ALTER TABLE public.coaching_purchase_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read their own coaching approvals" ON public.coaching_purchase_approvals;
CREATE POLICY "Clients read their own coaching approvals" ON public.coaching_purchase_approvals
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff read coaching approvals" ON public.coaching_purchase_approvals;
CREATE POLICY "Staff read coaching approvals" ON public.coaching_purchase_approvals
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')) OR client_id IN (SELECT public.coached_client_ids()));

-- No insert / update / delete policies: only the server writes approvals.
REVOKE INSERT, UPDATE, DELETE ON public.coaching_purchase_approvals FROM anon, authenticated;
GRANT SELECT ON public.coaching_purchase_approvals TO authenticated;

-- ---------------------------------------------------------------------------
-- The tick also closes offers nobody answered in time
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('plan-changes-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'plan-changes-tick');
  PERFORM cron.schedule('plan-changes-tick', '*/10 * * * *', $cmd$
    SELECT net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/plan-changes-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)
    WHERE EXISTS (
      SELECT 1 FROM public.plan_changes
       WHERE status IN ('checkout', 'processing', 'awaiting_payment')
          OR (status = 'scheduled' AND effective_at <= now() + interval '10 minutes')
          OR (status = 'offered' AND offer_expires_at <= now())
    );
  $cmd$);
END $$;

-- ---------------------------------------------------------------------------
-- Drafts for the owner to review and publish in Admin → Legal (never
-- published here: a published version keeps its words, and publishing asks to
-- confirm the wording was reviewed). They match Coaching Agreement 3.0 and how
-- plans work in the app. The published versions describe the retired $29 USD
-- membership.
-- ---------------------------------------------------------------------------
INSERT INTO public.legal_document_versions
  (document_id, version_number, status, title, summary, body, signature_method,
   requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
SELECT d.id,
       (SELECT coalesce(max(v.version_number), 0) + 1 FROM public.legal_document_versions v WHERE v.document_id = d.id),
       'draft',
       'Cancellation & Refund Policy',
       'Plans in the app (Nov 24 2026): the free app, monthly coaching packages cancelled or changed in the app, coaching by approval, grandfathered prices kept until the client switches. Replaces the retired paid-membership wording.',
       $body$Cancellation & Refund Policy
JF Effect, operated by Jared James McIntyre
Effective date: the date this version is published    •    Website: https://jfeffect.com
This policy explains how plans are cancelled and changed, and how refunds are handled. It works together with the JF Effect Coaching Agreement (for coaching clients), the Terms of Service and the Recurring Billing Disclosure. For a coaching client, if anything here differs from the Coaching Agreement they signed, the Coaching Agreement controls.
1. The Free App
The JF Effect app is free. There is nothing to cancel. You can delete your account any time in Account → Privacy & data.
2. Monthly Plans
Coaching packages are billed monthly and renew automatically until you cancel.
You can cancel yourself in the app (Account → Your plan), or by email to coaching@jfeffect.com, before your next billing date (no later than 11:59 p.m. Winnipeg time on the day before).
A cancellation takes effect at the end of the billing period you have already paid for. You keep your plan until then and nothing more is charged. You can keep your plan any time before it ends.
Cancelling does not delete your account. Everything you logged stays, and you keep the free app.
3. Changing Plans
You can move between monthly plans in the app.
Moving to a plan that costs more takes effect right away. You are charged the difference for the rest of your current billing period (prorated), and the new price applies from your next billing date.
Moving to a plan that costs less, or to the free app, takes effect at the end of the billing period you have already paid for. Nothing is refunded or credited for the current period.
Before you confirm a change, the app shows what you will pay today, what you will pay going forward and the date the change happens. If a payment for a change does not go through, your plan stays as it was.
Plans are changed in the app. Stripe's billing page, opened from the app, is for your card, billing details, invoices and receipts.
4. Coaching by Approval
Coaching is offered by approval. If you are not a current coaching client, you apply (or ask to come back) in the app or on the website, and the Coach decides whether to accept you and for which package. A coaching package can be purchased only after approval. Applying is free.
5. Special (Grandfathered) Prices
If you pay a price other than the advertised price for your plan, you keep it as long as you stay on that plan and keep paying for it. It is never raised and you are never moved to another plan without your consent. Switching plans or cancelling ends that price, and it cannot be brought back later. The app tells you this before you confirm. The Coach may offer you a switch in the app; nothing changes unless you accept it.
6. Fixed Terms, Installment Plans and Session Packages
A fixed-term commitment or installment plan is owed in full. Cancelling billing does not end those payment obligations (see the Coaching Agreement). A session package follows the terms shown on its purchase.
7. Refunds
Charges already processed are not refundable, and there is no prorated refund for unused time or for not using a plan.
We may consider exceptions for duplicate charges, verified billing errors, or where a refund is required by law. A refund or credit given in one case does not create an obligation to give one in other cases.
8. Failed Payments
If a payment fails, Stripe tries again. You can update your card in the app (Account → Your plan). Coaching may be paused until payment is completed, as the Coaching Agreement describes.
9. Chargebacks
If you believe a charge is wrong, please contact us first at billing@jfeffect.com so we can fix it quickly. This does not take away your right to dispute a charge with your financial institution.
10. Refund Method and Timing
Approved refunds go back to your original payment method through Stripe. Your bank may take additional time to show them.
11. Contact
Cancellations: in the app, or coaching@jfeffect.com. Billing questions: billing@jfeffect.com.$body$,
       'checkbox', false, 'all_clients', NULL, true,
       'Drafted Nov 24 2026 to match Coaching Agreement 3.0 and in-app plan changes. Have it reviewed before publishing.'
  FROM public.legal_documents d
 WHERE d.slug = 'cancellation-and-refund-policy'
   AND NOT EXISTS (
     SELECT 1 FROM public.legal_document_versions v
      WHERE v.document_id = d.id AND v.summary LIKE 'Plans in the app (Nov 24 2026)%'
   );

INSERT INTO public.legal_document_versions
  (document_id, version_number, status, title, summary, body, signature_method,
   requires_reacceptance, reacceptance_audience, effective_date, needs_legal_review, legal_review_note)
SELECT d.id,
       (SELECT coalesce(max(v.version_number), 0) + 1 FROM public.legal_document_versions v WHERE v.document_id = d.id),
       'draft',
       'Recurring Billing Disclosure',
       'Plans in the app (Nov 24 2026): monthly coaching packages in CAD plus tax, prorated upgrades, changes at the end of the paid month, cancel in the app. Replaces the retired $29 USD membership wording.',
       $body$Recurring Billing Disclosure
JF Effect, operated by Jared James McIntyre
Effective date: the date this version is published    •    Website: https://jfeffect.com
1. How Billing Works
The JF Effect app is free. Coaching packages are monthly plans. When you start one, you pay its price plus applicable tax at checkout, and the same amount is charged automatically on the same day each month until you cancel. Prices are in Canadian dollars (CAD) unless the checkout says otherwise. Payments are processed by Stripe.
2. Your Price
Your price is the one shown before you confirm and on your receipt. If you have a special (grandfathered) price, it stays the same while you stay on that plan and is never changed without your consent.
3. Changing Your Plan
Moving to a plan that costs more takes effect right away and you are charged the prorated difference for the rest of your billing period. Moving to a plan that costs less, or to the free app, takes effect at the end of the period you have paid for. The app shows the amounts and dates before you confirm.
4. Cancelling
Cancel any time before your next billing date in the app (Account → Your plan) or by email to coaching@jfeffect.com. Cancellation takes effect at the end of the paid period and future charges stop. Charges already processed are not refunded (see the Cancellation & Refund Policy).
5. Receipts and Card Details
Receipts are emailed by Stripe and are in the app. You can update your card and billing details from Account → Your plan.
6. Failed Payments
If a payment fails, Stripe retries it. Update your card in the app to keep your plan.
7. Contact
billing@jfeffect.com$body$,
       'checkbox', false, 'all_clients', NULL, true,
       'Drafted Nov 24 2026 to match Coaching Agreement 3.0 and in-app plan changes. Have it reviewed before publishing.'
  FROM public.legal_documents d
 WHERE d.slug = 'recurring-billing-disclosure'
   AND NOT EXISTS (
     SELECT 1 FROM public.legal_document_versions v
      WHERE v.document_id = d.id AND v.summary LIKE 'Plans in the app (Nov 24 2026)%'
   );
