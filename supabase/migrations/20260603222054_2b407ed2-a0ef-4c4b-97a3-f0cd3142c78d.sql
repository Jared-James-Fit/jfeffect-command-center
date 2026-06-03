
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Winnipeg',
  ADD COLUMN IF NOT EXISTS default_session_location text DEFAULT 'Iron Image Gym',
  ADD COLUMN IF NOT EXISTS sessions_purchased integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS package_tracking_enabled boolean NOT NULL DEFAULT false;

-- PT Sessions
CREATE TABLE IF NOT EXISTS public.pt_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  session_type text NOT NULL DEFAULT 'Personal Training Session',
  custom_type text,
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Winnipeg',
  location text NOT NULL DEFAULT 'Iron Image Gym',
  notes text,
  client_visible_notes boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'Scheduled',
  visible_to_client boolean NOT NULL DEFAULT true,
  reminders_enabled boolean NOT NULL DEFAULT true,
  send_confirmation_email boolean NOT NULL DEFAULT true,
  confirmation_sent_at timestamptz,
  reminder_24h_sent_at timestamptz,
  reminder_1h_sent_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pt_sessions TO authenticated;
GRANT ALL ON public.pt_sessions TO service_role;
ALTER TABLE public.pt_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage pt_sessions" ON public.pt_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Client read own pt_sessions" ON public.pt_sessions
  FOR SELECT TO authenticated
  USING (visible_to_client = true AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = pt_sessions.client_id AND c.user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.tg_pt_session_compute_ts()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.starts_at := ((NEW.session_date::text || ' ' || NEW.start_time::text)::timestamp) AT TIME ZONE NEW.timezone;
  NEW.ends_at   := ((NEW.session_date::text || ' ' || NEW.end_time::text)::timestamp) AT TIME ZONE NEW.timezone;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_pt_sessions_compute_ts
  BEFORE INSERT OR UPDATE ON public.pt_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_session_compute_ts();

CREATE INDEX IF NOT EXISTS idx_pt_sessions_client ON public.pt_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_starts_at ON public.pt_sessions(starts_at);

-- Nutrition Targets
CREATE TABLE IF NOT EXISTS public.nutrition_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'Maintenance',
  custom_phase text,
  goal text NOT NULL DEFAULT 'Maintain bodyweight',
  custom_goal text,
  structure text NOT NULL DEFAULT 'Same Every Day',
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'Active',
  ending_soon_days integer NOT NULL DEFAULT 7,
  client_notes text,
  admin_notes text,
  visible_to_client boolean NOT NULL DEFAULT true,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_targets TO authenticated;
GRANT ALL ON public.nutrition_targets TO service_role;
ALTER TABLE public.nutrition_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage nutrition_targets" ON public.nutrition_targets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Client read own nutrition_targets" ON public.nutrition_targets
  FOR SELECT TO authenticated
  USING (visible_to_client AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = nutrition_targets.client_id AND c.user_id = auth.uid()
  ));

CREATE TRIGGER trg_nutrition_targets_updated_at BEFORE UPDATE ON public.nutrition_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.nutrition_target_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.nutrition_targets(id) ON DELETE CASCADE,
  day_label text NOT NULL DEFAULT 'Daily',
  calories integer,
  protein integer,
  carbs integer,
  fats integer,
  fibre integer,
  water integer,
  steps integer,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_target_days TO authenticated;
GRANT ALL ON public.nutrition_target_days TO service_role;
ALTER TABLE public.nutrition_target_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage nutrition_target_days" ON public.nutrition_target_days
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Client read own nutrition_target_days" ON public.nutrition_target_days
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nutrition_targets nt
    JOIN public.clients c ON c.id = nt.client_id
    WHERE nt.id = nutrition_target_days.target_id
      AND nt.visible_to_client = true
      AND c.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_ntd_target ON public.nutrition_target_days(target_id);

-- Cardio Targets
CREATE TABLE IF NOT EXISTS public.cardio_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phase_id uuid,
  goal text,
  cardio_type text NOT NULL DEFAULT 'Incline Walking',
  custom_type text,
  frequency_per_week integer,
  duration_minutes integer,
  intensity text,
  heart_rate_zone text,
  step_target integer,
  machine_preference text,
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'Active',
  ending_soon_days integer NOT NULL DEFAULT 7,
  client_notes text,
  admin_notes text,
  visible_to_client boolean NOT NULL DEFAULT true,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cardio_targets TO authenticated;
GRANT ALL ON public.cardio_targets TO service_role;
ALTER TABLE public.cardio_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage cardio_targets" ON public.cardio_targets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Client read own cardio_targets" ON public.cardio_targets
  FOR SELECT TO authenticated
  USING (visible_to_client AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = cardio_targets.client_id AND c.user_id = auth.uid()
  ));

CREATE TRIGGER trg_cardio_targets_updated_at BEFORE UPDATE ON public.cardio_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
