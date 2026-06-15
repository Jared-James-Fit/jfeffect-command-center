
-- ============================================================
-- Goals & Setup: tables, RLS, audit, coach-notification trigger
-- ============================================================

-- Helper: is the signed-in user the assigned coach for this client?
-- Lives here so policies can call it.
CREATE OR REPLACE FUNCTION public.is_assigned_coach_for_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    JOIN public.coaches co ON co.id = c.assigned_coach_id
    WHERE c.id = _client_id
      AND co.user_id = auth.uid()
  );
$$;

-- Helper: is the signed-in user the client owner?
CREATE OR REPLACE FUNCTION public.is_client_owner(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = _client_id
      AND c.user_id = auth.uid()
  );
$$;

-- ============================================================
-- 1) client_goals_setup
-- ============================================================
CREATE TABLE public.client_goals_setup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Goals
  main_goal text,
  main_goal_other text,
  goal_target text,

  -- Training availability
  training_days_per_week integer,
  available_weekdays text[] NOT NULL DEFAULT '{}'::text[],
  workout_length_minutes integer,

  -- Training experience
  training_experience text,
  training_styles text[] NOT NULL DEFAULT '{}'::text[],

  -- Gym and equipment
  training_location text,
  equipment text[] NOT NULL DEFAULT '{}'::text[],
  -- { "Home": ["Dumbbells","Resistance bands"], "Hotel gym": [...] }
  equipment_by_location jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Nutrition
  nutrition_goal text,
  nutrition_preference text,
  food_restrictions_has boolean NOT NULL DEFAULT false,
  food_restrictions_details text,
  nutrition_challenges text[] NOT NULL DEFAULT '{}'::text[],

  -- Injuries
  injuries_has boolean NOT NULL DEFAULT false,
  injuries_details text,

  -- Final notes
  final_notes text,

  -- Lifecycle
  completed_at timestamptz,
  last_reviewed_at timestamptz,
  last_reviewed_by uuid,
  update_requested_at timestamptz,
  update_requested_by uuid,
  update_request_message text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_goals_setup TO authenticated;
GRANT ALL ON public.client_goals_setup TO service_role;

ALTER TABLE public.client_goals_setup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client can read own goals setup"
ON public.client_goals_setup FOR SELECT TO authenticated
USING (public.is_client_owner(client_id));

CREATE POLICY "coach/admin can read goals setup"
ON public.client_goals_setup FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
  OR public.is_assigned_coach_for_client(client_id)
);

CREATE POLICY "client can insert own goals setup"
ON public.client_goals_setup FOR INSERT TO authenticated
WITH CHECK (public.is_client_owner(client_id));

CREATE POLICY "coach/admin can insert goals setup"
ON public.client_goals_setup FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
  OR public.is_assigned_coach_for_client(client_id)
);

CREATE POLICY "client can update own goals setup"
ON public.client_goals_setup FOR UPDATE TO authenticated
USING (public.is_client_owner(client_id))
WITH CHECK (public.is_client_owner(client_id));

CREATE POLICY "coach/admin can update goals setup"
ON public.client_goals_setup FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
  OR public.is_assigned_coach_for_client(client_id)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
  OR public.is_assigned_coach_for_client(client_id)
);

-- updated_at trigger (reuse generic helper if present)
CREATE OR REPLACE FUNCTION public.cgs_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_cgs_touch
BEFORE UPDATE ON public.client_goals_setup
FOR EACH ROW EXECUTE FUNCTION public.cgs_touch_updated_at();

-- ============================================================
-- 2) client_goals_setup_notes (private coach notes)
-- ============================================================
CREATE TABLE public.client_goals_setup_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cgs_notes_client_idx ON public.client_goals_setup_notes(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_goals_setup_notes TO authenticated;
GRANT ALL ON public.client_goals_setup_notes TO service_role;

ALTER TABLE public.client_goals_setup_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach/admin can read goals notes"
ON public.client_goals_setup_notes FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
  OR public.is_assigned_coach_for_client(client_id)
);

CREATE POLICY "coach/admin can insert goals notes"
ON public.client_goals_setup_notes FOR INSERT TO authenticated
WITH CHECK (
  (public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'coach')
    OR public.is_assigned_coach_for_client(client_id))
  AND author_id = auth.uid()
);

CREATE POLICY "author can delete own goals note"
ON public.client_goals_setup_notes FOR DELETE TO authenticated
USING (author_id = auth.uid());

-- ============================================================
-- 3) client_goals_setup_audit
-- ============================================================
CREATE TABLE public.client_goals_setup_audit (
  id bigserial PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  changed_by uuid,
  changed_fields text[] NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cgs_audit_client_idx ON public.client_goals_setup_audit(client_id, created_at DESC);

GRANT SELECT, INSERT ON public.client_goals_setup_audit TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.client_goals_setup_audit_id_seq TO authenticated;
GRANT ALL ON public.client_goals_setup_audit TO service_role;
GRANT ALL ON SEQUENCE public.client_goals_setup_audit_id_seq TO service_role;

ALTER TABLE public.client_goals_setup_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach/admin can read goals audit"
ON public.client_goals_setup_audit FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'coach')
  OR public.is_assigned_coach_for_client(client_id)
);

-- Audit + coach notification trigger
CREATE OR REPLACE FUNCTION public.cgs_audit_and_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed text[] := '{}'::text[];
  notify_fields text[] := ARRAY[
    'main_goal','main_goal_other','goal_target',
    'training_days_per_week','available_weekdays','workout_length_minutes',
    'training_location','equipment','equipment_by_location',
    'injuries_has','injuries_details',
    'nutrition_goal','food_restrictions_has','food_restrictions_details'
  ];
  should_notify boolean := false;
  coach_row record;
  client_row record;
  notify_summary text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := ARRAY['(created)'];
    should_notify := true;
  ELSE
    IF NEW.main_goal IS DISTINCT FROM OLD.main_goal THEN changed := array_append(changed,'main_goal'); END IF;
    IF NEW.main_goal_other IS DISTINCT FROM OLD.main_goal_other THEN changed := array_append(changed,'main_goal_other'); END IF;
    IF NEW.goal_target IS DISTINCT FROM OLD.goal_target THEN changed := array_append(changed,'goal_target'); END IF;
    IF NEW.training_days_per_week IS DISTINCT FROM OLD.training_days_per_week THEN changed := array_append(changed,'training_days_per_week'); END IF;
    IF NEW.available_weekdays IS DISTINCT FROM OLD.available_weekdays THEN changed := array_append(changed,'available_weekdays'); END IF;
    IF NEW.workout_length_minutes IS DISTINCT FROM OLD.workout_length_minutes THEN changed := array_append(changed,'workout_length_minutes'); END IF;
    IF NEW.training_experience IS DISTINCT FROM OLD.training_experience THEN changed := array_append(changed,'training_experience'); END IF;
    IF NEW.training_styles IS DISTINCT FROM OLD.training_styles THEN changed := array_append(changed,'training_styles'); END IF;
    IF NEW.training_location IS DISTINCT FROM OLD.training_location THEN changed := array_append(changed,'training_location'); END IF;
    IF NEW.equipment IS DISTINCT FROM OLD.equipment THEN changed := array_append(changed,'equipment'); END IF;
    IF NEW.equipment_by_location IS DISTINCT FROM OLD.equipment_by_location THEN changed := array_append(changed,'equipment_by_location'); END IF;
    IF NEW.nutrition_goal IS DISTINCT FROM OLD.nutrition_goal THEN changed := array_append(changed,'nutrition_goal'); END IF;
    IF NEW.nutrition_preference IS DISTINCT FROM OLD.nutrition_preference THEN changed := array_append(changed,'nutrition_preference'); END IF;
    IF NEW.food_restrictions_has IS DISTINCT FROM OLD.food_restrictions_has THEN changed := array_append(changed,'food_restrictions_has'); END IF;
    IF NEW.food_restrictions_details IS DISTINCT FROM OLD.food_restrictions_details THEN changed := array_append(changed,'food_restrictions_details'); END IF;
    IF NEW.nutrition_challenges IS DISTINCT FROM OLD.nutrition_challenges THEN changed := array_append(changed,'nutrition_challenges'); END IF;
    IF NEW.injuries_has IS DISTINCT FROM OLD.injuries_has THEN changed := array_append(changed,'injuries_has'); END IF;
    IF NEW.injuries_details IS DISTINCT FROM OLD.injuries_details THEN changed := array_append(changed,'injuries_details'); END IF;
    IF NEW.final_notes IS DISTINCT FROM OLD.final_notes THEN changed := array_append(changed,'final_notes'); END IF;
    should_notify := changed && notify_fields;
  END IF;

  IF array_length(changed,1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.client_goals_setup_audit (client_id, changed_by, changed_fields, before, after)
  VALUES (
    NEW.client_id,
    auth.uid(),
    changed,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW)
  );

  -- Coach notification via tasks (assigned to the assigned coach)
  IF should_notify THEN
    SELECT c.id AS client_id, c.full_name, c.assigned_coach_id, co.user_id AS coach_user_id
      INTO client_row
    FROM public.clients c
    LEFT JOIN public.coaches co ON co.id = c.assigned_coach_id
    WHERE c.id = NEW.client_id;

    IF client_row.assigned_coach_id IS NOT NULL THEN
      notify_summary := 'Goals & Setup updated for ' || COALESCE(client_row.full_name,'client')
        || ' — ' || array_to_string(changed, ', ');
      INSERT INTO public.tasks (title, notes, quadrant, status, scope, assigned_to, created_by)
      VALUES (
        notify_summary,
        'Client updated their Goals & Setup. Review and adjust their plan if needed.',
        'do',
        'open',
        'admin',
        client_row.assigned_coach_id,
        auth.uid()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cgs_audit_and_notify
AFTER INSERT OR UPDATE ON public.client_goals_setup
FOR EACH ROW EXECUTE FUNCTION public.cgs_audit_and_notify();
