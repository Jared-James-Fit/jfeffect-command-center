CREATE TABLE public.email_sender_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  sender_name text NOT NULL DEFAULT 'Coach Jared / JF Effect',
  sender_email text NOT NULL DEFAULT 'jaredjamesfit@gmail.com',
  reply_to_email text NOT NULL DEFAULT 'jaredjamesfit@gmail.com',
  provider text NOT NULL DEFAULT 'gmail',
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_secure boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'Not Connected',
  last_test_at timestamptz,
  last_test_result text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_sender_settings TO authenticated;
GRANT ALL ON public.email_sender_settings TO service_role;
ALTER TABLE public.email_sender_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage email_sender_settings" ON public.email_sender_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_email_sender_settings_updated_at BEFORE UPDATE ON public.email_sender_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.email_sender_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;