
-- 1) Extend app_members with billing/subscription fields
ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS trial_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS hold_plan_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_invoice_status text,
  ADD COLUMN IF NOT EXISTS last_billing_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS signup_ip inet,
  ADD COLUMN IF NOT EXISTS signup_user_agent text;

CREATE INDEX IF NOT EXISTS idx_app_members_stripe_sub ON public.app_members(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_app_members_stripe_cus ON public.app_members(stripe_customer_id);

-- 2) Membership settings (single row)
CREATE TABLE IF NOT EXISTS public.jf_membership_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  monthly_price_id text,
  monthly_price_display text NOT NULL DEFAULT '$29/month',
  hold_price_id text,
  hold_price_display text NOT NULL DEFAULT '$9/month',
  trial_days int NOT NULL DEFAULT 3,
  upgrade_coaching_url text,
  support_email text,
  refund_policy text NOT NULL DEFAULT 'JF Membership is a digital subscription. Members can cancel anytime before their next billing date. Access remains active until the end of the paid billing period. Refunds are not guaranteed for used digital access. If there is a billing issue or accidental duplicate charge, contact support. Trial members can cancel before the trial ends to avoid being charged.',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jf_membership_settings TO anon, authenticated;
GRANT ALL ON public.jf_membership_settings TO service_role;
ALTER TABLE public.jf_membership_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read jf settings" ON public.jf_membership_settings FOR SELECT USING (true);
CREATE POLICY "Admin write jf settings" ON public.jf_membership_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
INSERT INTO public.jf_membership_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- 3) Billing event audit (dedupe webhooks)
CREATE TABLE IF NOT EXISTS public.jf_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text UNIQUE NOT NULL,
  type text NOT NULL,
  customer_id text,
  subscription_id text,
  member_id uuid REFERENCES public.app_members(id) ON DELETE SET NULL,
  payload jsonb,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jf_billing_events TO authenticated;
GRANT ALL ON public.jf_billing_events TO service_role;
ALTER TABLE public.jf_billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read billing events" ON public.jf_billing_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4) Trial abuse guard
CREATE TABLE IF NOT EXISTS public.jf_trial_emails (
  email_lc text PRIMARY KEY,
  first_trial_at timestamptz NOT NULL DEFAULT now(),
  stripe_customer_id text
);
GRANT SELECT ON public.jf_trial_emails TO authenticated;
GRANT ALL ON public.jf_trial_emails TO service_role;
ALTER TABLE public.jf_trial_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read trial emails" ON public.jf_trial_emails FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 5) Pending signups (post-checkout activation)
CREATE TABLE IF NOT EXISTS public.jf_pending_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE NOT NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  password_hash text NOT NULL,
  sms_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
GRANT ALL ON public.jf_pending_signups TO service_role;
ALTER TABLE public.jf_pending_signups ENABLE ROW LEVEL SECURITY;
-- service_role only; no policies for end users

-- 6) Cancellation feedback
CREATE TABLE IF NOT EXISTS public.jf_cancellation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  reason text,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.jf_cancellation_feedback TO authenticated;
GRANT ALL ON public.jf_cancellation_feedback TO service_role;
ALTER TABLE public.jf_cancellation_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Member insert own feedback" ON public.jf_cancellation_feedback FOR INSERT TO authenticated
  WITH CHECK (member_id IN (SELECT id FROM public.app_members WHERE user_id = auth.uid()));
CREATE POLICY "Admin read feedback" ON public.jf_cancellation_feedback FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 7) Access helper: verified Stripe status
CREATE OR REPLACE FUNCTION public.jf_member_has_full_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members
     WHERE user_id = _user_id
       AND account_type = 'jf_member'
       AND subscription_status IN ('Trialing','Active')
       AND status = 'Active'
  )
$$;
GRANT EXECUTE ON FUNCTION public.jf_member_has_full_access(uuid) TO authenticated, anon, service_role;

-- 8) Trigger: block self-promotion via direct UPDATE on billing fields
CREATE OR REPLACE FUNCTION public.tg_app_members_billing_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  is_admin_v boolean := false;
  is_service boolean := (current_setting('role', true) = 'service_role');
BEGIN
  IF is_service THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO is_admin_v;
  END IF;
  IF is_admin_v THEN RETURN NEW; END IF;

  -- Non-admin, non-service: cannot change protected fields
  IF NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
     OR NEW.trial_end_at IS DISTINCT FROM OLD.trial_end_at
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.cancel_at IS DISTINCT FROM OLD.cancel_at
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     OR NEW.paused_until IS DISTINCT FROM OLD.paused_until
     OR NEW.hold_plan_started_at IS DISTINCT FROM OLD.hold_plan_started_at
     OR NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION 'Not authorized to change billing/account status fields' USING ERRCODE='insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_members_billing_guard ON public.app_members;
CREATE TRIGGER app_members_billing_guard
  BEFORE UPDATE ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_members_billing_guard();
