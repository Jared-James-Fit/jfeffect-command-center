-- The coach's own note on a PT session: why it was cancelled, moved or not
-- counted ("foot tattoo", "I had NAPF Championships"). Only staff read it.
-- It can't live in pt_sessions.notes: clients read their own pt_sessions rows
-- (every column), and client_visible_notes only hides notes in the app.

CREATE TABLE IF NOT EXISTS public.pt_session_coach_notes (
  pt_session_id uuid PRIMARY KEY REFERENCES public.pt_sessions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS pt_session_coach_notes_client_idx ON public.pt_session_coach_notes (client_id);

-- client_id always comes from the session (a caller can't point a note at another client).
CREATE OR REPLACE FUNCTION public.tg_pt_session_coach_notes_fill()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  SELECT s.client_id INTO NEW.client_id FROM public.pt_sessions s WHERE s.id = NEW.pt_session_id;
  NEW.note := btrim(NEW.note);
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pt_session_coach_notes_fill ON public.pt_session_coach_notes;
CREATE TRIGGER trg_pt_session_coach_notes_fill
  BEFORE INSERT OR UPDATE ON public.pt_session_coach_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_session_coach_notes_fill();

ALTER TABLE public.pt_session_coach_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage pt_session_coach_notes" ON public.pt_session_coach_notes;
CREATE POLICY "Admin manage pt_session_coach_notes" ON public.pt_session_coach_notes
  FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "Coach manage assigned pt_session_coach_notes" ON public.pt_session_coach_notes;
CREATE POLICY "Coach manage assigned pt_session_coach_notes" ON public.pt_session_coach_notes
  FOR ALL TO authenticated
  USING (client_id IN (SELECT public.coached_client_ids()))
  WITH CHECK (client_id IN (SELECT public.coached_client_ids()));

REVOKE ALL ON public.pt_session_coach_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pt_session_coach_notes TO authenticated;

SELECT public.rls_evaluate_once('pt_session_coach_notes');

NOTIFY pgrst, 'reload schema';
