-- Team notes: Quick notes shared with a group of teammates.
--
-- A Quick note (quick_notes) is private to one person. Sharing it with
-- teammates moves it here, where everyone on `members` (the group, the person
-- who shared it included) reads and edits the same note. The Tasks page lists
-- them under Quick notes, one card per group, so a note shared with Fionna sits
-- with every other note shared with Fionna instead of turning into a task.
--
-- members: logins, in the order they were added, each once. Only people who
--   work the task board (the same people task_team_members() lists) can be on
--   one; anyone else is dropped by the tidy trigger.
-- created_by: who shared it. Only they can take it back into their own Quick
--   notes ("Remove from team", done by the app); anyone else leaves it
--   (team_note_leave) and it stays with the others.

-- Who works the task board: the admin, active coaches, and roles with tasks.manage.
CREATE OR REPLACE FUNCTION public.works_task_board(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid IS NOT NULL
     AND (public.is_coach_or_admin(_uid) OR public.has_permission(_uid, 'tasks.manage'))
$$;
REVOKE ALL ON FUNCTION public.works_task_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.works_task_board(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.team_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  members uuid[] NOT NULL,
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 500),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 100000),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- "Last edited": only a change to the words moves it.
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_notes_members_idx ON public.team_notes USING gin (members);

-- Each person once, in the order added, teammates only; who edited the words last.
CREATE OR REPLACE FUNCTION public.team_notes_tidy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kept uuid[];
BEGIN
  SELECT COALESCE(array_agg(s.u ORDER BY s.first_at), '{}')
    INTO kept
    FROM (
      SELECT m.u, min(m.ord) AS first_at
        FROM unnest(NEW.members) WITH ORDINALITY AS m(u, ord)
       WHERE m.u IS NOT NULL AND public.works_task_board(m.u)
       GROUP BY m.u
    ) s;
  IF cardinality(kept) = 0 THEN
    RAISE EXCEPTION 'A team note needs someone on the team on it';
  END IF;
  NEW.members := kept;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL OR NOT (NEW.created_by = ANY (kept)) THEN
      NEW.created_by := auth.uid();
    END IF;
    NEW.updated_by := COALESCE(NEW.updated_by, auth.uid());
  ELSE
    NEW.id := OLD.id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body THEN
      NEW.updated_at := now();
      NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
    ELSE
      NEW.updated_at := OLD.updated_at;
      NEW.updated_by := OLD.updated_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_notes_tidy ON public.team_notes;
CREATE TRIGGER team_notes_tidy
  BEFORE INSERT OR UPDATE ON public.team_notes
  FOR EACH ROW EXECUTE FUNCTION public.team_notes_tidy();

ALTER TABLE public.team_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team notes: members read" ON public.team_notes;
CREATE POLICY "Team notes: members read" ON public.team_notes
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = ANY (members) AND (SELECT public.works_task_board((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Team notes: members add" ON public.team_notes;
CREATE POLICY "Team notes: members add" ON public.team_notes
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = ANY (members) AND (SELECT public.works_task_board((SELECT auth.uid()))));

-- Leaving a note is team_note_leave(); an edit always keeps the editor on it.
DROP POLICY IF EXISTS "Team notes: members edit" ON public.team_notes;
CREATE POLICY "Team notes: members edit" ON public.team_notes
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = ANY (members) AND (SELECT public.works_task_board((SELECT auth.uid()))))
  WITH CHECK ((SELECT auth.uid()) = ANY (members));

DROP POLICY IF EXISTS "Team notes: members delete" ON public.team_notes;
CREATE POLICY "Team notes: members delete" ON public.team_notes
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = ANY (members) AND (SELECT public.works_task_board((SELECT auth.uid()))));

REVOKE ALL ON public.team_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_notes TO authenticated;

-- Take yourself off a team note; it stays with everyone else (gone once nobody's left).
CREATE OR REPLACE FUNCTION public.team_note_leave(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  n public.team_notes;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO n FROM public.team_notes WHERE id = _id AND me = ANY (members) FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM unnest(array_remove(n.members, me)) AS u WHERE public.works_task_board(u)) THEN
    UPDATE public.team_notes SET members = array_remove(members, me) WHERE id = _id;
  ELSE
    DELETE FROM public.team_notes WHERE id = _id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.team_note_leave(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_note_leave(uuid) TO authenticated;

-- Everyone on a note sees a teammate's edit without reloading.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_notes;
  END IF;
END $$;
