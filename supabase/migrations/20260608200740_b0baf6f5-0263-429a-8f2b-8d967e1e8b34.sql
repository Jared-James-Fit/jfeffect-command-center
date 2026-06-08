
-- Per-exercise notes from clients during workouts
CREATE TABLE public.pl_exercise_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  day_id uuid NOT NULL REFERENCES public.pl_days(id) ON DELETE CASCADE,
  row_id uuid REFERENCES public.pl_exercise_rows(id) ON DELETE SET NULL,
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  exercise_name text NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','edited')),
  coach_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, day_id, row_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_exercise_notes TO authenticated;
GRANT ALL ON public.pl_exercise_notes TO service_role;

ALTER TABLE public.pl_exercise_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client manage own pl_exercise_notes"
  ON public.pl_exercise_notes
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = pl_exercise_notes.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = pl_exercise_notes.client_id AND c.user_id = auth.uid()));

CREATE POLICY "Admin manage pl_exercise_notes"
  ON public.pl_exercise_notes
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach manage pl_exercise_notes"
  ON public.pl_exercise_notes
  TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

CREATE INDEX pl_exercise_notes_client_day_idx ON public.pl_exercise_notes (client_id, day_id);
CREATE INDEX pl_exercise_notes_coach_seen_idx ON public.pl_exercise_notes (coach_seen_at) WHERE coach_seen_at IS NULL;

CREATE TRIGGER tg_pl_exercise_notes_updated
  BEFORE UPDATE ON public.pl_exercise_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Automatic workout tracking columns
ALTER TABLE public.pl_day_completions
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS in_progress_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_method text CHECK (completion_method IN ('manual','automatic'));

-- Allow draft completion rows (no completed_at yet)
ALTER TABLE public.pl_day_completions
  ALTER COLUMN completed_at DROP NOT NULL;
