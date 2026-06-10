
-- ============================================================
-- Group chat permission mode
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.group_permission_mode AS ENUM ('everyone', 'admins_only', 'read_only');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.group_member_role AS ENUM ('admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- chat_groups
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  permission_mode public.group_permission_mode NOT NULL DEFAULT 'everyone',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_groups TO authenticated;
GRANT ALL ON public.chat_groups TO service_role;
ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- chat_group_members
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_group_members (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.group_member_role NOT NULL DEFAULT 'member',
  last_read_at timestamptz,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_group_members_user_idx ON public.chat_group_members(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_group_members TO authenticated;
GRANT ALL ON public.chat_group_members TO service_role;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- group_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL DEFAULT 'member',
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_messages_group_created_idx ON public.group_messages(group_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_messages TO authenticated;
GRANT ALL ON public.group_messages TO service_role;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- group_message_reactions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.group_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.group_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_message_reactions TO authenticated;
GRANT ALL ON public.group_message_reactions TO service_role;
ALTER TABLE public.group_message_reactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- mass_message_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mass_message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mode text NOT NULL, -- 'individual' | 'group'
  group_id uuid REFERENCES public.chat_groups(id) ON DELETE SET NULL,
  audience_summary text,
  body text NOT NULL DEFAULT '',
  recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.mass_message_log TO authenticated;
GRANT ALL ON public.mass_message_log TO service_role;
ALTER TABLE public.mass_message_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper functions (SECURITY DEFINER to avoid RLS recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_group_members
    WHERE group_id = _group_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_group_members
    WHERE group_id = _group_id AND user_id = _user_id AND role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_group(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::app_role)
    OR public.is_group_admin(_group_id, _user_id)
    OR EXISTS (
      SELECT 1 FROM public.chat_groups
      WHERE id = _group_id AND created_by = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.coaches
      WHERE user_id = _user_id AND archived = false AND status = 'Active'
    )
$$;

CREATE OR REPLACE FUNCTION public.is_coach_or_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.coaches
      WHERE user_id = _user_id AND archived = false AND status = 'Active'
    )
$$;

CREATE OR REPLACE FUNCTION public.user_is_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_coach_or_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.clients
      WHERE user_id = _user_id AND archived = false AND status = 'Active'
    )
    OR EXISTS (
      SELECT 1 FROM public.app_members
      WHERE user_id = _user_id AND status = 'Active'
    )
$$;

GRANT EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_group_admin(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_group(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_coach_or_admin(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_active(uuid) TO authenticated, anon, service_role;

-- ============================================================
-- RLS Policies — chat_groups
-- ============================================================
DROP POLICY IF EXISTS "chat_groups_select" ON public.chat_groups;
CREATE POLICY "chat_groups_select" ON public.chat_groups
FOR SELECT TO authenticated
USING (
  public.user_is_active(auth.uid())
  AND (
    public.is_coach_or_admin(auth.uid())
    OR public.is_group_member(id, auth.uid())
  )
);

DROP POLICY IF EXISTS "chat_groups_insert" ON public.chat_groups;
CREATE POLICY "chat_groups_insert" ON public.chat_groups
FOR INSERT TO authenticated
WITH CHECK (
  public.is_coach_or_admin(auth.uid())
  AND created_by = auth.uid()
);

DROP POLICY IF EXISTS "chat_groups_update" ON public.chat_groups;
CREATE POLICY "chat_groups_update" ON public.chat_groups
FOR UPDATE TO authenticated
USING (public.can_manage_group(id, auth.uid()))
WITH CHECK (public.can_manage_group(id, auth.uid()));

DROP POLICY IF EXISTS "chat_groups_delete" ON public.chat_groups;
CREATE POLICY "chat_groups_delete" ON public.chat_groups
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- RLS Policies — chat_group_members
-- ============================================================
DROP POLICY IF EXISTS "chat_group_members_select" ON public.chat_group_members;
CREATE POLICY "chat_group_members_select" ON public.chat_group_members
FOR SELECT TO authenticated
USING (
  public.user_is_active(auth.uid())
  AND (
    public.is_coach_or_admin(auth.uid())
    OR user_id = auth.uid()
    OR public.is_group_member(group_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "chat_group_members_insert" ON public.chat_group_members;
CREATE POLICY "chat_group_members_insert" ON public.chat_group_members
FOR INSERT TO authenticated
WITH CHECK (
  public.can_manage_group(group_id, auth.uid())
);

DROP POLICY IF EXISTS "chat_group_members_update" ON public.chat_group_members;
CREATE POLICY "chat_group_members_update" ON public.chat_group_members
FOR UPDATE TO authenticated
USING (
  public.can_manage_group(group_id, auth.uid())
  OR user_id = auth.uid()  -- members can update their own last_read_at
)
WITH CHECK (
  public.can_manage_group(group_id, auth.uid())
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "chat_group_members_delete" ON public.chat_group_members;
CREATE POLICY "chat_group_members_delete" ON public.chat_group_members
FOR DELETE TO authenticated
USING (
  public.can_manage_group(group_id, auth.uid())
  OR user_id = auth.uid()  -- members can remove themselves
);

-- ============================================================
-- RLS Policies — group_messages
-- ============================================================
DROP POLICY IF EXISTS "group_messages_select" ON public.group_messages;
CREATE POLICY "group_messages_select" ON public.group_messages
FOR SELECT TO authenticated
USING (
  public.user_is_active(auth.uid())
  AND (
    public.is_coach_or_admin(auth.uid())
    OR public.is_group_member(group_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "group_messages_insert" ON public.group_messages;
CREATE POLICY "group_messages_insert" ON public.group_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.user_is_active(auth.uid())
  AND (
    -- coach/admin can always post
    public.is_coach_or_admin(auth.uid())
    OR (
      public.is_group_member(group_id, auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.chat_groups g
        WHERE g.id = group_id
          AND g.archived = false
          AND g.permission_mode = 'everyone'
      )
    )
  )
);

DROP POLICY IF EXISTS "group_messages_update" ON public.group_messages;
CREATE POLICY "group_messages_update" ON public.group_messages
FOR UPDATE TO authenticated
USING (
  sender_id = auth.uid()
  OR public.can_manage_group(group_id, auth.uid())
)
WITH CHECK (
  sender_id = auth.uid()
  OR public.can_manage_group(group_id, auth.uid())
);

DROP POLICY IF EXISTS "group_messages_delete" ON public.group_messages;
CREATE POLICY "group_messages_delete" ON public.group_messages
FOR DELETE TO authenticated
USING (
  sender_id = auth.uid()
  OR public.can_manage_group(group_id, auth.uid())
);

-- ============================================================
-- RLS Policies — group_message_reactions
-- ============================================================
DROP POLICY IF EXISTS "group_message_reactions_select" ON public.group_message_reactions;
CREATE POLICY "group_message_reactions_select" ON public.group_message_reactions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.group_messages m
    WHERE m.id = message_id
      AND (
        public.is_coach_or_admin(auth.uid())
        OR public.is_group_member(m.group_id, auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "group_message_reactions_insert" ON public.group_message_reactions;
CREATE POLICY "group_message_reactions_insert" ON public.group_message_reactions
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.group_messages m
    WHERE m.id = message_id
      AND (
        public.is_coach_or_admin(auth.uid())
        OR public.is_group_member(m.group_id, auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "group_message_reactions_delete" ON public.group_message_reactions;
CREATE POLICY "group_message_reactions_delete" ON public.group_message_reactions
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ============================================================
-- RLS Policies — mass_message_log
-- ============================================================
DROP POLICY IF EXISTS "mass_message_log_select" ON public.mass_message_log;
CREATE POLICY "mass_message_log_select" ON public.mass_message_log
FOR SELECT TO authenticated
USING (public.is_coach_or_admin(auth.uid()));

DROP POLICY IF EXISTS "mass_message_log_insert" ON public.mass_message_log;
CREATE POLICY "mass_message_log_insert" ON public.mass_message_log
FOR INSERT TO authenticated
WITH CHECK (
  public.is_coach_or_admin(auth.uid())
  AND sent_by = auth.uid()
);

-- ============================================================
-- updated_at trigger
-- ============================================================
DROP TRIGGER IF EXISTS chat_groups_set_updated_at ON public.chat_groups;
CREATE TRIGGER chat_groups_set_updated_at
BEFORE UPDATE ON public.chat_groups
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- Realtime
-- ============================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_groups;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_members;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.group_message_reactions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
