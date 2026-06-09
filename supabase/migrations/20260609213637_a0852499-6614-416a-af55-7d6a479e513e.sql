
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;

CREATE TABLE public.sms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  from_phone text,
  brand_name text NOT NULL DEFAULT 'Jared James Coaching',
  manual_default_template text NOT NULL DEFAULT 'Hi {first_name}, this is {brand}. You have a new message in your coaching app — please open it when you can. Reply STOP to opt out.',
  reminder_steps jsonb NOT NULL DEFAULT '[
    {"delay_minutes": 30, "enabled": true, "template": "Hi {first_name}, this is {brand}. You have an unread message in your coaching app from your coach. Please open the app to read it. Reply STOP to opt out."},
    {"delay_minutes": 240, "enabled": true, "template": "Hi {first_name}, this is a reminder from {brand}. Your coach is still waiting for you to read their message in the coaching app. Reply STOP to opt out."}
  ]'::jsonb,
  rate_limit_per_hour int NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_settings TO authenticated;
GRANT ALL ON public.sms_settings TO service_role;
ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage sms_settings" ON public.sms_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  to_phone text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('manual','reminder')),
  reminder_step int,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  twilio_sid text,
  error text,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_log_client_created_idx ON public.sms_log(client_id, created_at DESC);
CREATE INDEX sms_log_message_step_idx ON public.sms_log(message_id, reminder_step) WHERE message_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_log TO authenticated;
GRANT ALL ON public.sms_log TO service_role;
ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read sms_log" ON public.sms_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));
CREATE POLICY "Admins insert sms_log" ON public.sms_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_assigned_coach(client_id));

INSERT INTO public.sms_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;
