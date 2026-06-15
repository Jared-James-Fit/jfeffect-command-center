
-- =====================================================================
-- 1. Extend nutrition_targets
-- =====================================================================
ALTER TABLE public.nutrition_targets
  ADD COLUMN IF NOT EXISTS update_cadence text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS cadence_interval_days integer,
  ADD COLUMN IF NOT EXISTS last_updated_date date,
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS tracking_status text NOT NULL DEFAULT 'up_to_date',
  ADD COLUMN IF NOT EXISTS goal_direction text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS assigned_coach_id uuid;

ALTER TABLE public.nutrition_targets
  DROP CONSTRAINT IF EXISTS nt_update_cadence_chk;
ALTER TABLE public.nutrition_targets
  ADD CONSTRAINT nt_update_cadence_chk CHECK (update_cadence IN ('weekly','biweekly','monthly','custom','manual','paused'));

ALTER TABLE public.nutrition_targets
  DROP CONSTRAINT IF EXISTS nt_tracking_status_chk;
ALTER TABLE public.nutrition_targets
  ADD CONSTRAINT nt_tracking_status_chk CHECK (tracking_status IN ('up_to_date','due_soon','due_today','overdue','submitted','under_review','published','paused','not_needed'));

CREATE INDEX IF NOT EXISTS idx_nt_tracking_status ON public.nutrition_targets(tracking_status);
CREATE INDEX IF NOT EXISTS idx_nt_next_due ON public.nutrition_targets(next_due_date);

-- =====================================================================
-- 2. nutrition_update_submissions
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nutrition_update_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  target_id uuid REFERENCES public.nutrition_targets(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'submitted',
  -- body fields
  current_bodyweight numeric(6,2),
  avg_bodyweight numeric(6,2),
  bodyweight_unit text NOT NULL DEFAULT 'lb',
  compliance_pct integer,
  hunger_rating integer,
  energy_rating integer,
  digestion_rating integer,
  sleep_rating integer,
  training_performance_rating integer,
  steps_completed integer,
  cardio_completed text,
  missed_meals text,
  notes text,
  goal_direction text,
  progress_photo_urls text[] NOT NULL DEFAULT '{}',
  -- snapshots / review
  previous_targets_json jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  published_at timestamptz,
  coach_note text,
  published_targets_json jsonb,
  allow_resubmit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nutrition_update_submissions
  DROP CONSTRAINT IF EXISTS nus_status_chk;
ALTER TABLE public.nutrition_update_submissions
  ADD CONSTRAINT nus_status_chk CHECK (status IN ('submitted','under_review','published','dismissed'));

-- only one open submission per client (anti-spam)
DROP INDEX IF EXISTS uq_nus_open_per_client;
CREATE UNIQUE INDEX uq_nus_open_per_client
  ON public.nutrition_update_submissions(client_id)
  WHERE status IN ('submitted','under_review');

CREATE INDEX IF NOT EXISTS idx_nus_client ON public.nutrition_update_submissions(client_id);
CREATE INDEX IF NOT EXISTS idx_nus_status ON public.nutrition_update_submissions(status);
CREATE INDEX IF NOT EXISTS idx_nus_submitted_at ON public.nutrition_update_submissions(submitted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_update_submissions TO authenticated;
GRANT ALL ON public.nutrition_update_submissions TO service_role;

ALTER TABLE public.nutrition_update_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nus_admin_all" ON public.nutrition_update_submissions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "nus_coach_assigned" ON public.nutrition_update_submissions
  FOR ALL TO authenticated
  USING (is_assigned_coach(client_id))
  WITH CHECK (is_assigned_coach(client_id));

CREATE POLICY "nus_client_read_own" ON public.nutrition_update_submissions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

CREATE POLICY "nus_client_insert_own" ON public.nutrition_update_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
    AND status = 'submitted'
  );

CREATE TRIGGER trg_nus_updated_at BEFORE UPDATE ON public.nutrition_update_submissions
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- 3. nutrition_review_tasks
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nutrition_review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.nutrition_update_submissions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assigned_coach_id uuid,
  status text NOT NULL DEFAULT 'open',
  due_at timestamptz,
  completed_at timestamptz,
  sla_breached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nutrition_review_tasks
  DROP CONSTRAINT IF EXISTS nrt_status_chk;
ALTER TABLE public.nutrition_review_tasks
  ADD CONSTRAINT nrt_status_chk CHECK (status IN ('open','done','snoozed'));

CREATE INDEX IF NOT EXISTS idx_nrt_status ON public.nutrition_review_tasks(status);
CREATE INDEX IF NOT EXISTS idx_nrt_coach ON public.nutrition_review_tasks(assigned_coach_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_review_tasks TO authenticated;
GRANT ALL ON public.nutrition_review_tasks TO service_role;
ALTER TABLE public.nutrition_review_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nrt_admin_all" ON public.nutrition_review_tasks
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "nrt_coach_assigned" ON public.nutrition_review_tasks
  FOR ALL TO authenticated
  USING (is_assigned_coach(client_id))
  WITH CHECK (is_assigned_coach(client_id));

CREATE TRIGGER trg_nrt_updated_at BEFORE UPDATE ON public.nutrition_review_tasks
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- 4. nutrition_automation_settings (singleton)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nutrition_automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  default_cadence text NOT NULL DEFAULT 'weekly',
  cadence_interval_days integer,
  reminder_lead_days integer NOT NULL DEFAULT 2,
  overdue_reminder_days integer NOT NULL DEFAULT 1,
  client_reminders_enabled boolean NOT NULL DEFAULT true,
  coach_reminders_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  coach_review_sla_hours integer NOT NULL DEFAULT 24,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nas_singleton ON public.nutrition_automation_settings(singleton);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_automation_settings TO authenticated;
GRANT ALL ON public.nutrition_automation_settings TO service_role;
ALTER TABLE public.nutrition_automation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nas_read_authenticated" ON public.nutrition_automation_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "nas_admin_manage" ON public.nutrition_automation_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_nas_updated_at BEFORE UPDATE ON public.nutrition_automation_settings
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

INSERT INTO public.nutrition_automation_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- =====================================================================
-- 5. nutrition_notification_log
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nutrition_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  recipient_user_id uuid,
  submission_id uuid REFERENCES public.nutrition_update_submissions(id) ON DELETE SET NULL,
  kind text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  error text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nnl_client ON public.nutrition_notification_log(client_id);
CREATE INDEX IF NOT EXISTS idx_nnl_kind_sent ON public.nutrition_notification_log(kind, sent_at DESC);

GRANT SELECT, INSERT ON public.nutrition_notification_log TO authenticated;
GRANT ALL ON public.nutrition_notification_log TO service_role;
ALTER TABLE public.nutrition_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nnl_admin_read" ON public.nutrition_notification_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR (client_id IS NOT NULL AND is_assigned_coach(client_id)));

-- =====================================================================
-- 6. Helper functions
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_apply_nutrition_cadence(_target_id uuid)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence text;
  v_interval integer;
  v_last date;
  v_next date;
BEGIN
  SELECT update_cadence, cadence_interval_days, COALESCE(last_updated_date, current_date)
    INTO v_cadence, v_interval, v_last
  FROM public.nutrition_targets WHERE id = _target_id;

  IF v_cadence IS NULL OR v_cadence IN ('manual','paused') THEN
    v_next := NULL;
  ELSIF v_cadence = 'weekly' THEN
    v_next := v_last + INTERVAL '7 days';
  ELSIF v_cadence = 'biweekly' THEN
    v_next := v_last + INTERVAL '14 days';
  ELSIF v_cadence = 'monthly' THEN
    v_next := v_last + INTERVAL '1 month';
  ELSIF v_cadence = 'custom' THEN
    v_next := v_last + (COALESCE(v_interval, 7) || ' days')::interval;
  END IF;

  UPDATE public.nutrition_targets SET next_due_date = v_next WHERE id = _target_id;
  RETURN v_next;
END $$;

CREATE OR REPLACE FUNCTION public.fn_recompute_nutrition_status(_target_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence text;
  v_next date;
  v_client uuid;
  v_open_status text;
  v_new_status text;
  v_lead int;
BEGIN
  SELECT update_cadence, next_due_date, client_id
    INTO v_cadence, v_next, v_client
  FROM public.nutrition_targets WHERE id = _target_id;

  IF v_cadence = 'paused' THEN
    UPDATE public.nutrition_targets SET tracking_status = 'paused' WHERE id = _target_id;
    RETURN 'paused';
  END IF;

  SELECT status INTO v_open_status FROM public.nutrition_update_submissions
   WHERE client_id = v_client AND status IN ('submitted','under_review')
   ORDER BY submitted_at DESC LIMIT 1;

  IF v_open_status IS NOT NULL THEN
    v_new_status := v_open_status;
  ELSIF v_next IS NULL THEN
    v_new_status := 'up_to_date';
  ELSE
    SELECT reminder_lead_days INTO v_lead FROM public.nutrition_automation_settings LIMIT 1;
    v_lead := COALESCE(v_lead, 2);
    IF v_next < current_date THEN v_new_status := 'overdue';
    ELSIF v_next = current_date THEN v_new_status := 'due_today';
    ELSIF v_next <= current_date + (v_lead || ' days')::interval THEN v_new_status := 'due_soon';
    ELSE v_new_status := 'up_to_date';
    END IF;
  END IF;

  UPDATE public.nutrition_targets SET tracking_status = v_new_status WHERE id = _target_id;
  RETURN v_new_status;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_apply_nutrition_cadence(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_recompute_nutrition_status(uuid) TO authenticated, service_role;

-- =====================================================================
-- 7. Storage policies for nutrition-submissions bucket
-- =====================================================================
DROP POLICY IF EXISTS "nutrition_subs_client_upload" ON storage.objects;
CREATE POLICY "nutrition_subs_client_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nutrition-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "nutrition_subs_client_read_own" ON storage.objects;
CREATE POLICY "nutrition_subs_client_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nutrition-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "nutrition_subs_admin_read" ON storage.objects;
CREATE POLICY "nutrition_subs_admin_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nutrition-submissions'
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'coach'::app_role))
  );
