
-- Enums
DO $$ BEGIN
  CREATE TYPE public.event_type AS ENUM (
    'Competition','Powerlifting Meet','Bodybuilding Show','Photoshoot','Testing Day',
    'Weigh-In','Travel','Appointment','Coaching Call','Deadline','Gym Event','Custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_importance AS ENUM ('Low','Medium','High','Critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_status AS ENUM ('Draft','Active','Completed','Archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_link_type AS ENUM (
    'Event Website','Registration Link','Schedule','Rules / Info Package','Athlete Roster',
    'Livestream','Location / Map','Hotel / Travel','Weigh-In Info','Payment Link','Google Meet','Custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_audience_scope AS ENUM (
    'selected_clients','all_coaching','app_members','program_only'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_reminder_offset AS ENUM (
    'w12','w8','w4','w2','w1','d3','d1','day_of'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- TABLES (create all first, policies after)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  event_type public.event_type NOT NULL DEFAULT 'Custom',
  event_date date NOT NULL,
  start_time time NULL,
  end_time time NULL,
  timezone text NULL,
  location text NULL,
  description text NULL,
  client_facing_notes text NULL,
  internal_notes text NULL,
  importance public.event_importance NOT NULL DEFAULT 'Medium',
  status public.event_status NOT NULL DEFAULT 'Draft',
  audience_scope public.event_audience_scope NOT NULL DEFAULT 'selected_clients',
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.event_quick_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  link_type public.event_link_type NOT NULL DEFAULT 'Custom',
  visible_to_client boolean NOT NULL DEFAULT true,
  internal_note text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date NULL,
  notes text NULL,
  visible_to_client boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  offset_key public.event_reminder_offset NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  message text NULL,
  visible_to_client boolean NOT NULL DEFAULT true,
  last_fired_on date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, offset_key)
);

CREATE TABLE IF NOT EXISTS public.event_popup_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offset_key public.event_reminder_offset NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id, offset_key)
);

CREATE TABLE IF NOT EXISTS public.event_format_prompts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================
-- GRANTS
-- =========================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_assignments     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_quick_links     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_deadlines       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_reminders       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_popup_acks      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_format_prompts  TO authenticated;
GRANT ALL ON public.events,
            public.event_assignments,
            public.event_quick_links,
            public.event_deadlines,
            public.event_reminders,
            public.event_popup_acks,
            public.event_format_prompts
       TO service_role;

-- =========================================================
-- ENABLE RLS
-- =========================================================
ALTER TABLE public.events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_quick_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_deadlines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_reminders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_popup_acks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_format_prompts ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- POLICIES
-- =========================================================

-- events
CREATE POLICY "events_admin_coach_all" ON public.events
  FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "events_clients_read" ON public.events
  FOR SELECT TO authenticated
  USING (
    status IN ('Active','Completed')
    AND (
      EXISTS (
        SELECT 1 FROM public.event_assignments ea
        JOIN public.clients c ON c.id = ea.client_id
        WHERE ea.event_id = events.id AND c.user_id = auth.uid()
      )
      OR (audience_scope = 'all_coaching' AND EXISTS (
            SELECT 1 FROM public.clients c WHERE c.user_id = auth.uid()
              AND c.archived = false AND c.status = 'Active'))
      OR (audience_scope = 'app_members' AND EXISTS (
            SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
              AND m.status = 'Active' AND m.account_type = 'app_member'))
      OR (audience_scope = 'program_only' AND EXISTS (
            SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
              AND m.status = 'Active' AND m.account_type = 'program_only'))
    )
  );

-- event_assignments
CREATE POLICY "event_assignments_admin_coach_all" ON public.event_assignments
  FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "event_assignments_clients_read" ON public.event_assignments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

-- event_quick_links
CREATE POLICY "event_quick_links_admin_coach_all" ON public.event_quick_links
  FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "event_quick_links_clients_read" ON public.event_quick_links
  FOR SELECT TO authenticated
  USING (
    visible_to_client = true
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status IN ('Active','Completed')
        AND (
          EXISTS (
            SELECT 1 FROM public.event_assignments ea
            JOIN public.clients c ON c.id = ea.client_id
            WHERE ea.event_id = e.id AND c.user_id = auth.uid()
          )
          OR (e.audience_scope = 'all_coaching' AND EXISTS (
                SELECT 1 FROM public.clients c WHERE c.user_id = auth.uid()
                  AND c.archived = false AND c.status = 'Active'))
          OR (e.audience_scope = 'app_members' AND EXISTS (
                SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
                  AND m.status = 'Active' AND m.account_type = 'app_member'))
          OR (e.audience_scope = 'program_only' AND EXISTS (
                SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
                  AND m.status = 'Active' AND m.account_type = 'program_only'))
        )
    )
  );

-- event_deadlines
CREATE POLICY "event_deadlines_admin_coach_all" ON public.event_deadlines
  FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "event_deadlines_clients_read" ON public.event_deadlines
  FOR SELECT TO authenticated
  USING (
    visible_to_client = true
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status IN ('Active','Completed')
        AND (
          EXISTS (
            SELECT 1 FROM public.event_assignments ea
            JOIN public.clients c ON c.id = ea.client_id
            WHERE ea.event_id = e.id AND c.user_id = auth.uid()
          )
          OR (e.audience_scope = 'all_coaching' AND EXISTS (
                SELECT 1 FROM public.clients c WHERE c.user_id = auth.uid()
                  AND c.archived = false AND c.status = 'Active'))
          OR (e.audience_scope = 'app_members' AND EXISTS (
                SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
                  AND m.status = 'Active' AND m.account_type = 'app_member'))
          OR (e.audience_scope = 'program_only' AND EXISTS (
                SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
                  AND m.status = 'Active' AND m.account_type = 'program_only'))
        )
    )
  );

-- event_reminders
CREATE POLICY "event_reminders_admin_coach_all" ON public.event_reminders
  FOR ALL TO authenticated
  USING (public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY "event_reminders_clients_read" ON public.event_reminders
  FOR SELECT TO authenticated
  USING (
    visible_to_client = true
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status IN ('Active','Completed')
        AND (
          EXISTS (
            SELECT 1 FROM public.event_assignments ea
            JOIN public.clients c ON c.id = ea.client_id
            WHERE ea.event_id = e.id AND c.user_id = auth.uid()
          )
          OR (e.audience_scope = 'all_coaching' AND EXISTS (
                SELECT 1 FROM public.clients c WHERE c.user_id = auth.uid()
                  AND c.archived = false AND c.status = 'Active'))
          OR (e.audience_scope = 'app_members' AND EXISTS (
                SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
                  AND m.status = 'Active' AND m.account_type = 'app_member'))
          OR (e.audience_scope = 'program_only' AND EXISTS (
                SELECT 1 FROM public.app_members m WHERE m.user_id = auth.uid()
                  AND m.status = 'Active' AND m.account_type = 'program_only'))
        )
    )
  );

-- event_popup_acks
CREATE POLICY "event_popup_acks_read" ON public.event_popup_acks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_coach_or_admin(auth.uid()));

CREATE POLICY "event_popup_acks_insert_own" ON public.event_popup_acks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- event_format_prompts (per user)
CREATE POLICY "event_format_prompts_own" ON public.event_format_prompts
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_coach_or_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_coach_or_admin(auth.uid()));

-- =========================================================
-- TRIGGERS + INDEXES
-- =========================================================
CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER event_quick_links_set_updated_at
  BEFORE UPDATE ON public.event_quick_links FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER event_deadlines_set_updated_at
  BEFORE UPDATE ON public.event_deadlines FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER event_reminders_set_updated_at
  BEFORE UPDATE ON public.event_reminders FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER event_format_prompts_set_updated_at
  BEFORE UPDATE ON public.event_format_prompts FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS events_status_date_idx       ON public.events (status, event_date);
CREATE INDEX IF NOT EXISTS events_created_by_idx        ON public.events (created_by);
CREATE INDEX IF NOT EXISTS event_assignments_event_idx  ON public.event_assignments (event_id);
CREATE INDEX IF NOT EXISTS event_assignments_client_idx ON public.event_assignments (client_id);
CREATE INDEX IF NOT EXISTS event_quick_links_event_idx  ON public.event_quick_links (event_id, sort_order);
CREATE INDEX IF NOT EXISTS event_deadlines_event_idx    ON public.event_deadlines (event_id, sort_order);
CREATE INDEX IF NOT EXISTS event_reminders_event_idx    ON public.event_reminders (event_id);
CREATE INDEX IF NOT EXISTS event_popup_acks_user_idx    ON public.event_popup_acks (user_id);
