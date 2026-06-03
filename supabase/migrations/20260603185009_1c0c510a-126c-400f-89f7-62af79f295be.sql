
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'client');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own or admin" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Update own or admin" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin insert profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

-- Updated-at helper
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create profile + default client role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Clients (coaching info; linked to a user account)
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  instagram TEXT,
  start_date DATE,
  coaching_package TEXT,
  coaching_type TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  tags TEXT[] NOT NULL DEFAULT '{}',
  payment_status TEXT DEFAULT 'Not Sent',
  stripe_link TEXT,
  program_sheet_link TEXT,
  drive_folder_link TEXT,
  checkin_form_link TEXT,
  agreement_link TEXT,
  calendar_link TEXT,
  goals TEXT,
  injuries TEXT,
  nutrition_notes TEXT,
  training_notes TEXT,
  lifestyle_notes TEXT,
  coach_notes TEXT,
  program_phase TEXT,
  last_program_update DATE,
  next_program_update DATE,
  renewal_date DATE,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin all clients" ON public.clients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Client read own" ON public.clients FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Offers / Products
CREATE TABLE public.offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  offer_type TEXT,
  description TEXT,
  price NUMERIC,
  currency TEXT DEFAULT 'USD',
  payment_structure TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  stripe_payment_link TEXT,
  checkout_url TEXT,
  success_url TEXT,
  cancel_url TEXT,
  delivery_notes TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offers TO authenticated;
GRANT ALL ON public.offers TO service_role;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage offers" ON public.offers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER offers_updated_at BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Exercises
CREATE TABLE public.exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  muscle_group TEXT,
  equipment TEXT,
  youtube_url TEXT,
  cues TEXT,
  common_mistakes TEXT,
  difficulty TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exercises TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.exercises TO authenticated;
GRANT ALL ON public.exercises TO service_role;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All auth read exercises" ON public.exercises FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage exercises" ON public.exercises FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER exercises_updated_at BEFORE UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- App shortcuts
CREATE TABLE public.app_shortcuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  notes TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_shortcuts TO authenticated;
GRANT ALL ON public.app_shortcuts TO service_role;
ALTER TABLE public.app_shortcuts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage shortcuts" ON public.app_shortcuts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Communication log
CREATE TABLE public.communication_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  comm_type TEXT,
  summary TEXT,
  follow_up_needed BOOLEAN DEFAULT false,
  priority TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_log TO authenticated;
GRANT ALL ON public.communication_log TO service_role;
ALTER TABLE public.communication_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage comm log" ON public.communication_log FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default app shortcuts
INSERT INTO public.app_shortcuts (name, description, url, sort_order) VALUES
  ('Stripe', 'Payments & subscriptions', 'https://dashboard.stripe.com', 1),
  ('Google Drive', 'Client files & folders', 'https://drive.google.com', 2),
  ('Google Sheets', 'Training programs', 'https://sheets.google.com', 3),
  ('Google Calendar', 'Calls & sessions', 'https://calendar.google.com', 4),
  ('Fillout', 'Forms & check-ins', 'https://fillout.com', 5),
  ('SignNow', 'Coaching agreements', 'https://signnow.com', 6),
  ('Zapier', 'Automations', 'https://zapier.com/app/dashboard', 7),
  ('YouTube', 'Exercise library source', 'https://studio.youtube.com', 8),
  ('Gmail', 'Email', 'https://mail.google.com', 9),
  ('Canva', 'Content & branding', 'https://canva.com', 10);
