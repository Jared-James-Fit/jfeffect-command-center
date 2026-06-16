
-- 1. Extend coaching_applications with new quick-apply fields
ALTER TABLE public.coaching_applications
  ADD COLUMN IF NOT EXISTS obstacle text,
  ADD COLUMN IF NOT EXISTS obstacle_other text,
  ADD COLUMN IF NOT EXISTS training_location text,
  ADD COLUMN IF NOT EXISTS coaching_interest text,
  ADD COLUMN IF NOT EXISTS readiness text,
  ADD COLUMN IF NOT EXISTS tracking_willingness text,
  ADD COLUMN IF NOT EXISTS investment_readiness text,
  ADD COLUMN IF NOT EXISTS preferred_contact text,
  ADD COLUMN IF NOT EXISTS best_time text,
  ADD COLUMN IF NOT EXISTS why_now_tags text[],
  ADD COLUMN IF NOT EXISTS consent_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS application_source text,
  ADD COLUMN IF NOT EXISTS qualification_label text,
  ADD COLUMN IF NOT EXISTS scoring jsonb,
  ADD COLUMN IF NOT EXISTS call_status text DEFAULT 'not_booked',
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id);

-- 2. Link appointments to coaching applications (for post-booking notifications)
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.coaching_applications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_application_id ON public.appointments(application_id);
CREATE INDEX IF NOT EXISTS idx_coaching_applications_call_status ON public.coaching_applications(call_status);
CREATE INDEX IF NOT EXISTS idx_coaching_applications_qualification_label ON public.coaching_applications(qualification_label);

-- 3. Notification recipients for coaching applications
CREATE TABLE IF NOT EXISTS public.coaching_app_notification_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text,
  phone text,
  email text,
  receive_application_sms boolean NOT NULL DEFAULT false,
  receive_booking_sms boolean NOT NULL DEFAULT false,
  receive_application_email boolean NOT NULL DEFAULT false,
  receive_booking_email boolean NOT NULL DEFAULT false,
  priority_only boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_app_notification_recipients TO authenticated;
GRANT ALL ON public.coaching_app_notification_recipients TO service_role;

ALTER TABLE public.coaching_app_notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage coaching app recipients"
  ON public.coaching_app_notification_recipients
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_coaching_app_recipients_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_coaching_app_recipients_updated_at ON public.coaching_app_notification_recipients;
CREATE TRIGGER trg_coaching_app_recipients_updated_at
  BEFORE UPDATE ON public.coaching_app_notification_recipients
  FOR EACH ROW EXECUTE FUNCTION public.touch_coaching_app_recipients_updated_at();

-- 4. Seed default recipients (idempotent: only insert if no rows exist yet)
INSERT INTO public.coaching_app_notification_recipients
  (name, role, phone, email,
   receive_application_sms, receive_booking_sms,
   receive_application_email, receive_booking_email,
   priority_only, paused)
SELECT * FROM (VALUES
  ('Primary Admin', 'Owner', NULL::text, NULL::text, true, true, true, true, false, false),
  ('Yannick Ring', 'Media Manager / Team Member', '+13435714378', NULL::text, true, true, false, false, false, false)
) AS v(name, role, phone, email,
       receive_application_sms, receive_booking_sms,
       receive_application_email, receive_booking_email,
       priority_only, paused)
WHERE NOT EXISTS (SELECT 1 FROM public.coaching_app_notification_recipients);
