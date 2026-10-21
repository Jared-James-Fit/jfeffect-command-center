-- Shared team tasks: a task on the team board can be on several people
-- (tasks.assignees, in the order they were added). Sending a private task to
-- a teammate keeps the sender on it, so both have it in My tasks and each
-- sees who else is on it.
--
-- tasks.assigned_to has always held a login (auth user id) in the app, but its
-- key still pointed at coaches(id), so every assignment failed with
-- tasks_assigned_to_fkey. It now points at auth.users and is kept as the first
-- person on the task (older readers: the media manager rule, reports).
SET lock_timeout = '3s';

UPDATE public.tasks t SET assigned_to = NULL
 WHERE t.assigned_to IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.assigned_to);
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_fkey;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignees uuid[] NOT NULL DEFAULT '{}';
UPDATE public.tasks SET assignees = ARRAY[assigned_to]
 WHERE assigned_to IS NOT NULL AND assignees = '{}';
CREATE INDEX IF NOT EXISTS tasks_assignees_idx ON public.tasks USING gin (assignees);

-- One place keeps the people on a task straight, whichever screen writes it:
-- each login once, in the order added, real logins only; nobody on a private
-- task; assigned_to / assignee_name follow the first person. A caller that
-- only sets assigned_to (older code) means "just this person".
CREATE OR REPLACE FUNCTION public.tasks_assignees_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid[];
BEGIN
  IF NEW.owner_user_id IS NOT NULL THEN
    NEW.assignees := '{}';
    NEW.assigned_to := NULL;
    NEW.assignee_name := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.assignees IS NOT DISTINCT FROM OLD.assignees
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assignees := CASE WHEN NEW.assigned_to IS NULL THEN '{}'::uuid[] ELSE ARRAY[NEW.assigned_to] END;
  ELSIF TG_OP = 'INSERT' AND coalesce(cardinality(NEW.assignees), 0) = 0 AND NEW.assigned_to IS NOT NULL THEN
    NEW.assignees := ARRAY[NEW.assigned_to];
  END IF;
  SELECT coalesce(array_agg(d.a ORDER BY d.o), '{}'::uuid[]) INTO v
    FROM (
      SELECT x.a, min(x.o) AS o
        FROM unnest(coalesce(NEW.assignees, '{}'::uuid[])) WITH ORDINALITY AS x(a, o)
       WHERE x.a IS NOT NULL
       GROUP BY x.a
    ) d
   WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.a);
  NEW.assignees := v;
  NEW.assigned_to := v[1];
  NEW.assignee_name := CASE
    WHEN v[1] IS NULL THEN NULL
    ELSE (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = v[1])
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tasks_assignees_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_assignees_sync ON public.tasks;
CREATE TRIGGER tasks_assignees_sync
  BEFORE INSERT OR UPDATE OF assignees, assigned_to, owner_user_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_assignees_sync();

-- A media manager reads the tasks they're on, not just the ones they're first on.
DROP POLICY IF EXISTS "tasks media_manager read assigned" ON public.tasks;
CREATE POLICY "tasks media_manager read assigned" ON public.tasks
  FOR SELECT TO authenticated
  USING ((SELECT public.is_media_manager((SELECT auth.uid()))) AND (SELECT auth.uid()) = ANY (assignees));
