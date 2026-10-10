-- Task Manager: everyone gets their own tasks and Quick Notes, plus the shared team board.
--
-- tasks.owner_user_id
--   set  => a personal task. Only its owner can see or change it. The rule is
--           RESTRICTIVE, so no permissive rule (admin, coach, tasks.manage, the
--           finance admin-view read) can reach someone else's personal task.
--   null => a team task on the shared board, under the existing scope 'admin'
--           rules. Every existing row is null, so the board is unchanged.
--
-- tasks.assigned_to holds the assignee's auth user id (the media-manager rule
-- already reads it that way); task_team_members() lists who can be assigned.
--
-- quick_notes: Quick Notes move off the device (localStorage) into the database,
-- so they follow the person instead of the phone and stay private to them. The id
-- is the note's existing local id (text), which client_file_notes.quick_note_id
-- already points at, so client-file links carry over untouched.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS tasks_owner_user_id_idx
  ON public.tasks (owner_user_id) WHERE owner_user_id IS NOT NULL;

DROP POLICY IF EXISTS "personal tasks stay with their owner" ON public.tasks;
CREATE POLICY "personal tasks stay with their owner" ON public.tasks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (owner_user_id IS NULL OR owner_user_id = auth.uid())
  WITH CHECK (owner_user_id IS NULL OR owner_user_id = auth.uid());

-- Who can be assigned a team task: the admin, active coaches with a login, and
-- every role holding tasks.manage (finance). Only people who work the board can ask.
CREATE OR REPLACE FUNCTION public.task_team_members()
RETURNS TABLE (user_id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.uid, COALESCE(NULLIF(btrim(p.full_name), ''), 'Team member')
    FROM (
      SELECT ur.user_id AS uid FROM public.user_roles ur WHERE ur.role = 'admin'
      UNION
      SELECT c.user_id FROM public.coaches c
       WHERE c.user_id IS NOT NULL AND c.archived = false AND c.status = 'Active'
      UNION
      SELECT ur.user_id FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role = ur.role
       WHERE rp.permission = 'tasks.manage'
    ) m
    LEFT JOIN public.profiles p ON p.id = m.uid
   WHERE public.is_coach_or_admin(auth.uid())
      OR public.has_permission(auth.uid(), 'tasks.manage')
   ORDER BY 2
$$;
REVOKE ALL ON FUNCTION public.task_team_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_team_members() TO authenticated;

CREATE TABLE IF NOT EXISTS public.quick_notes (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set by the app: linking a client or restoring from Recently Deleted keeps a
  -- note's place in the list, so this is "last edited", not "last written".
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quick_notes_owner_idx ON public.quick_notes (owner_user_id, updated_at DESC);

ALTER TABLE public.quick_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own quick notes" ON public.quick_notes;
CREATE POLICY "Own quick notes" ON public.quick_notes
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
REVOKE ALL ON public.quick_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_notes TO authenticated;
