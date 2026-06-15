-- ────────────────────────────────────────────────────────────────────
-- 1) notification_dedupe: idempotency table for cross-channel onboarding
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.notification_dedupe (
  key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms','email')),
  member_id UUID NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, channel)
);

GRANT SELECT ON public.notification_dedupe TO authenticated;
GRANT ALL ON public.notification_dedupe TO service_role;

ALTER TABLE public.notification_dedupe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read notification_dedupe"
  ON public.notification_dedupe
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_notification_dedupe_member ON public.notification_dedupe(member_id);

-- ────────────────────────────────────────────────────────────────────
-- 2) membership_onboarding_email_settings: admin-editable email content
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.membership_onboarding_email_settings (
  id BOOLEAN NOT NULL PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled BOOLEAN NOT NULL DEFAULT true,
  subject TEXT NOT NULL DEFAULT 'Welcome to JF Membership — {first_name}, you''re in',
  preheader TEXT NOT NULL DEFAULT 'Your trial is live. Here''s how to log in and what to expect.',
  welcome_message TEXT NOT NULL DEFAULT 'You''re officially in. JF Membership gives you the same training brain Jared uses with his 1-on-1 athletes — programs, recipes, articles, and the tools to keep training intelligently for the long haul.',
  next_step TEXT NOT NULL DEFAULT 'Open the app, finish setting up your account, and browse this month''s training and recipes. New drops every month.',
  support_email TEXT NOT NULL DEFAULT 'jaredjamesfit@gmail.com',
  cancel_instructions TEXT NOT NULL DEFAULT 'Cancel anytime from Billing inside the app, or reply to this email and we''ll take care of it before your next charge.',
  product_name TEXT NOT NULL DEFAULT 'JF Membership',
  monthly_price_display TEXT NOT NULL DEFAULT '$29 USD/month plus applicable tax',
  trial_timezone TEXT NOT NULL DEFAULT 'America/Winnipeg',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.membership_onboarding_email_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON public.membership_onboarding_email_settings TO authenticated;
GRANT ALL ON public.membership_onboarding_email_settings TO service_role;

ALTER TABLE public.membership_onboarding_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read onboarding email settings"
  ON public.membership_onboarding_email_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update onboarding email settings"
  ON public.membership_onboarding_email_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.update_membership_onboarding_email_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_membership_onboarding_email_settings_updated_at
  BEFORE UPDATE ON public.membership_onboarding_email_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_membership_onboarding_email_settings_updated_at();