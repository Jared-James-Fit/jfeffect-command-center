-- 1. Extend role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'coach';

-- 2. Coaches table
CREATE TABLE public.coaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  first_name text,
  last_name text,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  profile_picture_url text,
  status text NOT NULL DEFAULT 'Pending Invite',
  start_date date,
  notes text,
  last_login_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaches TO authenticated;
GRANT ALL ON public.coaches TO service_role;
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage coaches" ON public.coaches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Coach read own coach row" ON public.coaches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Coach update own coach row" ON public.coaches
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER coaches_set_updated_at BEFORE UPDATE ON public.coaches
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. Coach invites
CREATE TABLE public.coach_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_invites TO authenticated;
GRANT ALL ON public.coach_invites TO service_role;
ALTER TABLE public.coach_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage coach_invites" ON public.coach_invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Add assigned coach columns to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS assigned_coach_id uuid,
  ADD COLUMN IF NOT EXISTS onboarded_by_coach_id uuid;

CREATE INDEX IF NOT EXISTS idx_clients_assigned_coach ON public.clients(assigned_coach_id);

-- 5. Helper: current_coach_id and is_assigned_coach
CREATE OR REPLACE FUNCTION public.current_coach_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM public.coaches WHERE user_id = auth.uid() AND archived = false LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_coach(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    JOIN public.coaches co ON co.id = c.assigned_coach_id
    WHERE c.id = _client_id
      AND co.user_id = auth.uid()
      AND co.archived = false
      AND co.status = 'Active'
  )
$$;

-- 6. Activity log
CREATE TABLE public.client_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  actor_user_id uuid,
  actor_role text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_activity_log_client ON public.client_activity_log(client_id, created_at DESC);
GRANT SELECT, INSERT ON public.client_activity_log TO authenticated;
GRANT ALL ON public.client_activity_log TO service_role;
ALTER TABLE public.client_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read activity_log" ON public.client_activity_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Coach read assigned activity_log" ON public.client_activity_log
  FOR SELECT TO authenticated
  USING (public.is_assigned_coach(client_id));

CREATE POLICY "Admin or assigned coach insert activity_log" ON public.client_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.is_assigned_coach(client_id)
  );

-- 7. Extend RLS on every client-scoped table so coaches see assigned clients

-- clients
CREATE POLICY "Coach read assigned clients" ON public.clients
  FOR SELECT TO authenticated
  USING (
    assigned_coach_id IS NOT NULL
    AND assigned_coach_id = public.current_coach_id()
  );

CREATE POLICY "Coach update assigned clients" ON public.clients
  FOR UPDATE TO authenticated
  USING (assigned_coach_id = public.current_coach_id())
  WITH CHECK (assigned_coach_id = public.current_coach_id());

-- training_phases
CREATE POLICY "Coach manage assigned training_phases" ON public.training_phases
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- nutrition_targets
CREATE POLICY "Coach manage assigned nutrition_targets" ON public.nutrition_targets
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- nutrition_target_days
CREATE POLICY "Coach manage assigned nutrition_target_days" ON public.nutrition_target_days
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_targets nt
      WHERE nt.id = nutrition_target_days.target_id
        AND public.is_assigned_coach(nt.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_targets nt
      WHERE nt.id = nutrition_target_days.target_id
        AND public.is_assigned_coach(nt.client_id)
    )
  );

-- cardio_targets
CREATE POLICY "Coach manage assigned cardio_targets" ON public.cardio_targets
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- important_dates
CREATE POLICY "Coach manage assigned important_dates" ON public.important_dates
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- pt_sessions
CREATE POLICY "Coach manage assigned pt_sessions" ON public.pt_sessions
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- lift_videos
CREATE POLICY "Coach manage assigned lift_videos" ON public.lift_videos
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- lift_video_comments
CREATE POLICY "Coach manage assigned lift_video_comments" ON public.lift_video_comments
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- messages
CREATE POLICY "Coach read assigned messages" ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_assigned_coach(client_id));

CREATE POLICY "Coach send assigned messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_assigned_coach(client_id)
    AND sender_role = 'admin'
    AND sender_id = auth.uid()
  );

CREATE POLICY "Coach update assigned messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- conversation_state
CREATE POLICY "Coach manage assigned conversation_state" ON public.conversation_state
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- communication_log
CREATE POLICY "Coach manage assigned communication_log" ON public.communication_log
  FOR ALL TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- 8. Update handle_new_user to also accept coach invite tokens via raw_user_meta_data
-- (invite acceptance is handled in app code, this just keeps the trigger compatible)
