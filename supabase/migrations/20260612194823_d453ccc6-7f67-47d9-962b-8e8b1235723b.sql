ALTER TABLE public.app_members
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_state text,
  ADD COLUMN IF NOT EXISTS address_zip text,
  ADD COLUMN IF NOT EXISTS address_country text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS goals text,
  ADD COLUMN IF NOT EXISTS training_background text,
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.member_setup_complete(_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members m
    WHERE m.id = _member_id
      AND m.avatar_url IS NOT NULL AND length(btrim(m.avatar_url)) > 0
      AND m.phone IS NOT NULL AND length(btrim(m.phone)) > 0
      AND (m.sms_opt_out = false OR m.sms_consent_at IS NOT NULL)
      AND m.date_of_birth IS NOT NULL
      AND m.address_line1 IS NOT NULL AND length(btrim(m.address_line1)) > 0
      AND m.emergency_contact_name IS NOT NULL AND length(btrim(m.emergency_contact_name)) > 0
      AND m.emergency_contact_phone IS NOT NULL AND length(btrim(m.emergency_contact_phone)) > 0
      AND m.goals IS NOT NULL AND length(btrim(m.goals)) > 0
      AND m.training_background IS NOT NULL AND length(btrim(m.training_background)) > 0
  )
$$;

CREATE TABLE IF NOT EXISTS public.member_support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL UNIQUE REFERENCES public.app_members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  last_member_message_at timestamptz,
  last_team_message_at timestamptz,
  unread_for_team int NOT NULL DEFAULT 0,
  unread_for_member int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.member_support_threads TO authenticated;
GRANT ALL ON public.member_support_threads TO service_role;

ALTER TABLE public.member_support_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY mst_admin_all ON public.member_support_threads
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY mst_coach_select ON public.member_support_threads
  FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

CREATE POLICY mst_coach_update ON public.member_support_threads
  FOR UPDATE TO authenticated
  USING (public.is_coach_or_admin(auth.uid()))
  WITH CHECK (public.is_coach_or_admin(auth.uid()));

CREATE POLICY mst_member_self_select ON public.member_support_threads
  FOR SELECT TO authenticated
  USING (member_id = public.current_member_id());

CREATE POLICY mst_member_self_insert ON public.member_support_threads
  FOR INSERT TO authenticated
  WITH CHECK (member_id = public.current_member_id());

CREATE POLICY mst_member_self_update ON public.member_support_threads
  FOR UPDATE TO authenticated
  USING (member_id = public.current_member_id())
  WITH CHECK (member_id = public.current_member_id());

CREATE TABLE IF NOT EXISTS public.member_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.member_support_threads(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.app_members(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('member','team')),
  category text NOT NULL DEFAULT 'question' CHECK (category IN ('question','bug','suggestion','reply')),
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msm_thread_created ON public.member_support_messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msm_member_created ON public.member_support_messages (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msm_category ON public.member_support_messages (category);

GRANT SELECT, INSERT, UPDATE ON public.member_support_messages TO authenticated;
GRANT ALL ON public.member_support_messages TO service_role;

ALTER TABLE public.member_support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY msm_admin_all ON public.member_support_messages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY msm_coach_select ON public.member_support_messages
  FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(auth.uid()));

CREATE POLICY msm_coach_insert ON public.member_support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_coach_or_admin(auth.uid())
    AND sender_role = 'team'
    AND sender_user_id = auth.uid()
  );

CREATE POLICY msm_member_self_select ON public.member_support_messages
  FOR SELECT TO authenticated
  USING (member_id = public.current_member_id());

CREATE POLICY msm_member_self_insert ON public.member_support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = public.current_member_id()
    AND sender_role = 'member'
    AND sender_user_id = auth.uid()
  );

CREATE OR REPLACE FUNCTION public.tg_msm_bump_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_role = 'member' THEN
    UPDATE public.member_support_threads
       SET last_member_message_at = NEW.created_at,
           unread_for_team = unread_for_team + 1,
           status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
           updated_at = now()
     WHERE id = NEW.thread_id;
  ELSE
    UPDATE public.member_support_threads
       SET last_team_message_at = NEW.created_at,
           unread_for_member = unread_for_member + 1,
           status = 'answered',
           updated_at = now()
     WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_msm_bump_thread ON public.member_support_messages;
CREATE TRIGGER tg_msm_bump_thread
AFTER INSERT ON public.member_support_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_msm_bump_thread();

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.member_support_messages';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.member_support_threads';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;