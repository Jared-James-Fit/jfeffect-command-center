-- =========================================================================
-- Phase 2: Membership notification safety mode
-- Additive only. No destructive changes. Existing automations untouched.
-- =========================================================================

-- 1) Notification safety mode setting (default: dry_run)
INSERT INTO public.app_settings (key, value)
VALUES (
  'jf_membership_notifications',
  jsonb_build_object(
    'mode', 'dry_run',
    'allowlist_phones', '[]'::jsonb,
    'allowlist_emails', '[]'::jsonb,
    'updated_at', now(),
    'note', 'Default dry_run. Flip to allowlist for staff testing, live only for launch.'
  )::text
)
ON CONFLICT (key) DO NOTHING;

-- 2) Audit table for every membership notification attempt
CREATE TABLE IF NOT EXISTS public.jf_notification_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         text NOT NULL CHECK (channel IN ('sms','email')),
  trigger_key     text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('dry_run','allowlist','live')),
  decision        text NOT NULL CHECK (decision IN ('sent','dry_run','suppressed','failed','skipped')),
  reason          text,
  member_id       uuid REFERENCES public.app_members(id) ON DELETE SET NULL,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  recipient       text,
  rendered_body   text,
  automation_id   uuid REFERENCES public.sms_automations(id) ON DELETE SET NULL,
  sms_log_id      uuid REFERENCES public.sms_log(id) ON DELETE SET NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.jf_notification_attempts TO authenticated;
GRANT ALL    ON public.jf_notification_attempts TO service_role;

ALTER TABLE public.jf_notification_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read jf_notification_attempts"
  ON public.jf_notification_attempts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role writes happen via supabaseAdmin and bypass RLS; no insert
-- policy is created on purpose so an authenticated user (even an admin)
-- cannot forge attempt rows from the client.

CREATE INDEX IF NOT EXISTS jf_notification_attempts_member_idx
  ON public.jf_notification_attempts (member_id, created_at DESC)
  WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jf_notification_attempts_trigger_idx
  ON public.jf_notification_attempts (trigger_key, created_at DESC);
CREATE INDEX IF NOT EXISTS jf_notification_attempts_decision_idx
  ON public.jf_notification_attempts (decision, created_at DESC);

-- 3) Inactive lifecycle SMS automation DRAFTS
-- All seeded with active=false. Admin must explicitly enable each one.
-- Skips any trigger_type that already has an automation (idempotent).
WITH drafts(name, trigger_type, body, internal_note) AS (
  VALUES
    ('Trial ending soon (draft)',
     'subscription_trial_ending',
     'Hi {first_name}, your JF Effect trial ends in {days_left} days. Manage your membership: {billing_link}',
     'Draft. Review wording, then flip active=true after launch.'),
    ('Payment failed (draft)',
     'subscription_payment_failed',
     'Hi {first_name}, we couldn''t process your JF Effect payment. Please update your card within 5 days to keep access: {billing_link}',
     'Draft. Fires on invoice.payment_failed.'),
    ('Payment recovered (draft)',
     'subscription_payment_recovered',
     'Hi {first_name}, your JF Effect payment went through. Thanks for staying with us!',
     'Draft. Fires when a previously-failed invoice succeeds.'),
    ('Grace period warning (draft)',
     'subscription_grace_warning',
     'Hi {first_name}, your JF Effect access ends in {days_left} days unless your payment goes through. Update card: {billing_link}',
     'Draft. Fires on day 3 of the 5-day grace window.'),
    ('Subscription cancelled (draft)',
     'subscription_cancelled',
     'Hi {first_name}, your JF Effect membership is set to end on {period_end}. You''ll keep full access until then. Change of heart? {billing_link}',
     'Draft. Fires when cancel_at_period_end becomes true.'),
    ('Subscription ended (draft)',
     'subscription_ended',
     'Hi {first_name}, your JF Effect membership has ended. We''d love to have you back any time: {restart_link}',
     'Draft. Fires when subscription is fully ended after period.'),
    ('Subscription restarted (draft)',
     'subscription_restarted',
     'Welcome back to JF Effect, {first_name}! Your membership is active again.',
     'Draft. Fires when a previously-ended member starts a new subscription.')
)
INSERT INTO public.sms_automations
  (name, category, trigger_type, body, active, internal_note)
SELECT d.name, 'Membership Lifecycle', d.trigger_type, d.body, false, d.internal_note
FROM drafts d
WHERE NOT EXISTS (
  SELECT 1 FROM public.sms_automations a WHERE a.trigger_type = d.trigger_type
);
