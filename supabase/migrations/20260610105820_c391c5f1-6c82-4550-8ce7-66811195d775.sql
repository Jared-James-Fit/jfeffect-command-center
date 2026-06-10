
-- 1. add phone to app_members
ALTER TABLE public.app_members ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.app_members ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;

-- 2. sms_log: allow member-only sends (no client row) + track automation
ALTER TABLE public.sms_log ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.sms_log DROP CONSTRAINT IF EXISTS sms_log_client_id_fkey;
ALTER TABLE public.sms_log ADD CONSTRAINT sms_log_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.sms_log ADD COLUMN IF NOT EXISTS app_member_id uuid REFERENCES public.app_members(id) ON DELETE SET NULL;
ALTER TABLE public.sms_log ADD COLUMN IF NOT EXISTS automation_id uuid REFERENCES public.sms_automations(id) ON DELETE SET NULL;
ALTER TABLE public.sms_log ADD COLUMN IF NOT EXISTS automation_trigger text;

CREATE INDEX IF NOT EXISTS sms_log_member_created_idx ON public.sms_log (app_member_id, created_at DESC) WHERE app_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_log_automation_idx ON public.sms_log (automation_id, created_at DESC) WHERE automation_id IS NOT NULL;

-- 3. allow members to read their own sms_log rows
DROP POLICY IF EXISTS "Member can read own sms_log" ON public.sms_log;
CREATE POLICY "Member can read own sms_log" ON public.sms_log
  FOR SELECT TO authenticated
  USING (
    app_member_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.app_members m WHERE m.id = sms_log.app_member_id AND m.user_id = auth.uid())
  );

-- 4. seed default automations (idempotent by name)
INSERT INTO public.sms_automations (name, category, trigger_type, trigger_config, delay_minutes, audience_type, audience_config, body, active, max_per_client_per_day, respect_quiet_hours, internal_note)
SELECT
  'New account — send setup link',
  'Onboarding',
  'account_created',
  '{}'::jsonb,
  0,
  'new_members',
  '{}'::jsonb,
  'Hi {first_name}! Welcome to {brand}. Tap this link to finish setting up your account and log in: {setup_link}',
  true,
  3,
  false,
  'Fires the moment an admin creates a new app member or a member is auto-created from a signup. The {setup_link} tag inserts the one-time setup URL.'
WHERE NOT EXISTS (SELECT 1 FROM public.sms_automations WHERE trigger_type = 'account_created');

INSERT INTO public.sms_automations (name, category, trigger_type, trigger_config, delay_minutes, audience_type, audience_config, body, active, max_per_client_per_day, respect_quiet_hours, internal_note)
SELECT
  'JF Membership purchased — send setup link',
  'Onboarding',
  'subscription_purchased',
  '{}'::jsonb,
  0,
  'new_members',
  '{}'::jsonb,
  'Thanks for joining {brand}, {first_name}! Your JF Membership is active. Set up your app account here: {setup_link}',
  true,
  3,
  false,
  'Fires from the Stripe webhook when a JF Membership subscription is created or trialing. The {setup_link} tag inserts the one-time setup URL so the new subscriber can log in immediately.'
WHERE NOT EXISTS (SELECT 1 FROM public.sms_automations WHERE trigger_type = 'subscription_purchased');
