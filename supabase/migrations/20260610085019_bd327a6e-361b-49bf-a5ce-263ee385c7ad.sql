
-- Enums
CREATE TYPE public.appointment_type AS ENUM (
  'Coaching Call','Check-In Call','Onboarding Call','Strategy Call',
  'Consultation','In-Person Session','Assessment','Nutrition Review',
  'Program Review','Custom'
);
CREATE TYPE public.appointment_status AS ENUM ('Scheduled','Completed','Cancelled','NoShow');
CREATE TYPE public.appointment_source AS ENUM ('manual','booking_link','external');
CREATE TYPE public.gcal_connection_status AS ENUM ('connected','reconnect_required','disconnected');
CREATE TYPE public.reminder_audience AS ENUM ('attendee','host');
CREATE TYPE public.reminder_status AS ENUM ('pending','sent','failed','skipped');

-- google_calendar_connections
CREATE TABLE public.google_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  google_account_email text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  selected_calendar_id text,
  selected_calendar_name text,
  status public.gcal_connection_status NOT NULL DEFAULT 'connected',
  last_synced_at timestamptz,
  last_error text,
  scopes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_connections TO authenticated;
GRANT ALL ON public.google_calendar_connections TO service_role;
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coaches manage own gcal connection" ON public.google_calendar_connections
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR user_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR user_id = auth.uid());
CREATE TRIGGER trg_gcal_conn_updated_at BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- booking_links
CREATE TABLE public.booking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  appointment_type public.appointment_type NOT NULL DEFAULT 'Coaching Call',
  host_coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  duration_minutes integer NOT NULL DEFAULT 30,
  buffer_before_minutes integer NOT NULL DEFAULT 0,
  buffer_after_minutes integer NOT NULL DEFAULT 0,
  max_per_day integer,
  min_notice_hours integer NOT NULL DEFAULT 2,
  max_advance_days integer NOT NULL DEFAULT 60,
  timezone text NOT NULL DEFAULT 'America/New_York',
  meet_enabled boolean NOT NULL DEFAULT true,
  collect_phone boolean NOT NULL DEFAULT true,
  collect_notes boolean NOT NULL DEFAULT true,
  sms_reminders_enabled boolean NOT NULL DEFAULT true,
  reminder_offsets_minutes integer[] NOT NULL DEFAULT ARRAY[1440,120]::integer[],
  allow_reschedule boolean NOT NULL DEFAULT true,
  allow_cancel boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_links_host ON public.booking_links(host_coach_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_links TO authenticated;
GRANT ALL ON public.booking_links TO service_role;
ALTER TABLE public.booking_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin or host manage booking links" ON public.booking_links
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR host_coach_id = public.current_coach_id()
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR host_coach_id = public.current_coach_id()
  );
CREATE TRIGGER trg_booking_links_updated_at BEFORE UPDATE ON public.booking_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- booking_link_availability
CREATE TABLE public.booking_link_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_link_id uuid NOT NULL REFERENCES public.booking_links(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bla_link ON public.booking_link_availability(booking_link_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_link_availability TO authenticated;
GRANT ALL ON public.booking_link_availability TO service_role;
ALTER TABLE public.booking_link_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin or host manage availability" ON public.booking_link_availability
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.booking_links bl
       WHERE bl.id = booking_link_id
         AND bl.host_coach_id = public.current_coach_id()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.booking_links bl
       WHERE bl.id = booking_link_id
         AND bl.host_coach_id = public.current_coach_id()
    )
  );

-- appointments
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  external_name text,
  external_email text,
  external_phone text,
  appointment_type public.appointment_type NOT NULL DEFAULT 'Coaching Call',
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  location text,
  meet_link text,
  google_event_id text,
  google_calendar_id text,
  status public.appointment_status NOT NULL DEFAULT 'Scheduled',
  attendee_notes text,
  internal_notes text,
  source public.appointment_source NOT NULL DEFAULT 'manual',
  booking_link_id uuid REFERENCES public.booking_links(id) ON DELETE SET NULL,
  sms_reminders_enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_appt_host_starts ON public.appointments(host_coach_id, starts_at);
CREATE INDEX idx_appt_client_starts ON public.appointments(client_id, starts_at);
CREATE INDEX idx_appt_status ON public.appointments(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin sees all appointments" ON public.appointments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Host coach manages own appointments" ON public.appointments
  FOR ALL TO authenticated
  USING (host_coach_id = public.current_coach_id())
  WITH CHECK (host_coach_id = public.current_coach_id());
CREATE POLICY "Client can view own appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
  );
CREATE TRIGGER trg_appt_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- appointment_reminders
CREATE TABLE public.appointment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  audience public.reminder_audience NOT NULL,
  offset_minutes integer NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status public.reminder_status NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reminders_due ON public.appointment_reminders(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_reminders_appt ON public.appointment_reminders(appointment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_reminders TO authenticated;
GRANT ALL ON public.appointment_reminders TO service_role;
ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reminders follow appointment access" ON public.appointment_reminders
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a
       WHERE a.id = appointment_id
         AND (
           public.has_role(auth.uid(),'admin'::app_role)
           OR a.host_coach_id = public.current_coach_id()
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.appointments a
       WHERE a.id = appointment_id
         AND (
           public.has_role(auth.uid(),'admin'::app_role)
           OR a.host_coach_id = public.current_coach_id()
         )
    )
  );

-- appointment_audit_log
CREATE TABLE public.appointment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_appt_audit_appt ON public.appointment_audit_log(appointment_id);
GRANT SELECT, INSERT ON public.appointment_audit_log TO authenticated;
GRANT ALL ON public.appointment_audit_log TO service_role;
ALTER TABLE public.appointment_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit follows appointment access" ON public.appointment_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a
       WHERE a.id = appointment_id
         AND (
           public.has_role(auth.uid(),'admin'::app_role)
           OR a.host_coach_id = public.current_coach_id()
           OR (a.client_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = a.client_id AND c.user_id = auth.uid()))
         )
    )
  );
CREATE POLICY "Admin or host insert audit" ON public.appointment_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.appointments a
       WHERE a.id = appointment_id
         AND (
           public.has_role(auth.uid(),'admin'::app_role)
           OR a.host_coach_id = public.current_coach_id()
         )
    )
  );
