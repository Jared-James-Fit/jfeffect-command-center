
-- ============================================================
-- Coach task definitions (global defaults)
-- ============================================================
CREATE TABLE public.coach_task_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL UNIQUE,
  title text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'weekly', -- weekly | biweekly | monthly | custom_days | manual | daily
  interval_days integer, -- used when frequency='custom_days'
  due_day_of_week smallint, -- 0=Sun..6=Sat; used for weekly/biweekly
  due_time_local time NOT NULL DEFAULT '23:59',
  tz_mode text NOT NULL DEFAULT 'client', -- client | coach | fixed
  fixed_tz text,
  reminder_offsets integer[] NOT NULL DEFAULT ARRAY[-1, 0, 2, 5], -- days relative to due (neg = before)
  overdue_after_days integer, -- for daily items (e.g. bodyweight)
  reminder_after_days integer, -- for daily items
  form_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coach_task_definitions TO authenticated, anon;
GRANT ALL ON public.coach_task_definitions TO service_role;

ALTER TABLE public.coach_task_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read task definitions"
  ON public.coach_task_definitions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage task definitions"
  ON public.coach_task_definitions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Per-client overrides
-- ============================================================
CREATE TABLE public.client_task_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  enabled boolean,
  frequency text,
  interval_days integer,
  due_day_of_week smallint,
  due_time_local time,
  tz_mode text,
  fixed_tz text,
  reminder_offsets integer[],
  overdue_after_days integer,
  reminder_after_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, task_type)
);

GRANT SELECT ON public.client_task_overrides TO authenticated;
GRANT ALL ON public.client_task_overrides TO service_role;

ALTER TABLE public.client_task_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client can read own overrides"
  ON public.client_task_overrides FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_task_overrides.client_id AND c.user_id = auth.uid())
  );

CREATE POLICY "Admins manage overrides"
  ON public.client_task_overrides FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Occurrences (generated task instances)
-- ============================================================
CREATE TABLE public.client_task_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  title text NOT NULL,
  subtitle text,
  due_at_utc timestamptz NOT NULL,
  due_local_date date NOT NULL,
  client_tz text NOT NULL,
  status text NOT NULL DEFAULT 'upcoming', -- upcoming | due_soon | due_today | overdue | completed | skipped
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_definition_id uuid REFERENCES public.coach_task_definitions(id) ON DELETE SET NULL,
  source_override_id uuid REFERENCES public.client_task_overrides(id) ON DELETE SET NULL,
  payload_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  reminder_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority smallint NOT NULL DEFAULT 50,
  is_coach_requested boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_task_occ_client_status_idx ON public.client_task_occurrences (client_id, status, due_at_utc);
CREATE INDEX client_task_occ_due_idx ON public.client_task_occurrences (status, due_at_utc);
-- Prevent duplicate active occurrences per task per local day
CREATE UNIQUE INDEX client_task_occ_dedupe_active
  ON public.client_task_occurrences (client_id, task_type, due_local_date)
  WHERE status <> 'completed' AND status <> 'skipped';

GRANT SELECT, INSERT, UPDATE ON public.client_task_occurrences TO authenticated;
GRANT ALL ON public.client_task_occurrences TO service_role;

ALTER TABLE public.client_task_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client reads own occurrences"
  ON public.client_task_occurrences FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_task_occurrences.client_id AND c.user_id = auth.uid())
  );

CREATE POLICY "Client updates own occurrences (complete)"
  ON public.client_task_occurrences FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_task_occurrences.client_id AND c.user_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_task_occurrences.client_id AND c.user_id = auth.uid())
  );

CREATE POLICY "Admins insert occurrences"
  ON public.client_task_occurrences FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER trg_coach_task_definitions_updated
  BEFORE UPDATE ON public.coach_task_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_client_task_overrides_updated
  BEFORE UPDATE ON public.client_task_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_client_task_occurrences_updated
  BEFORE UPDATE ON public.client_task_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Seed evidence-based defaults
-- ============================================================
INSERT INTO public.coach_task_definitions
  (task_type, title, frequency, due_day_of_week, due_time_local, tz_mode, reminder_offsets, overdue_after_days, reminder_after_days)
VALUES
  ('weekly_checkin',      'Weekly Check-In',     'weekly',      6, '23:59', 'client', ARRAY[-1, 0, 2, 5], NULL, NULL),
  ('nutrition_review',    'Nutrition Review',    'biweekly',    6, '23:59', 'client', ARRAY[-1, 0, 2],    NULL, NULL),
  ('progress_photos',     'Progress Photos',     'custom_days', NULL, '23:59', 'client', ARRAY[-1, 0, 2], NULL, NULL),
  ('monthly_assessment',  'Monthly Assessment',  'custom_days', NULL, '23:59', 'client', ARRAY[-1, 0, 2], NULL, NULL),
  ('bodyweight',          'Bodyweight Update',   'daily',       NULL, '20:00', 'client', ARRAY[0],        5,    3),
  ('technique_review',    'Technique Review',    'manual',      NULL, '23:59', 'client', ARRAY[0, 2, 5],  NULL, NULL)
ON CONFLICT (task_type) DO NOTHING;

-- Set interval_days for the custom_days seeds (progress_photos: 28, monthly_assessment: 28)
UPDATE public.coach_task_definitions SET interval_days = 28 WHERE task_type IN ('progress_photos','monthly_assessment');
