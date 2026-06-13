-- Post-workout feedback captured after a client marks a day complete.
-- One feedback row per pl_day_completions row (enforced by UNIQUE on completion_id).

CREATE TABLE public.pl_workout_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid NOT NULL REFERENCES public.pl_day_completions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  day_id uuid NOT NULL REFERENCES public.pl_days(id) ON DELETE CASCADE,
  overall_rating integer NOT NULL,
  session_rpe integer NOT NULL,
  pain boolean NOT NULL DEFAULT false,
  pain_level integer,
  pain_area text,
  pain_note text,
  client_note text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pl_workout_feedback_completion_unique UNIQUE (completion_id),
  CONSTRAINT pl_workout_feedback_rating_range CHECK (overall_rating BETWEEN 1 AND 5),
  CONSTRAINT pl_workout_feedback_rpe_range CHECK (session_rpe BETWEEN 1 AND 10),
  CONSTRAINT pl_workout_feedback_pain_level_range CHECK (pain_level IS NULL OR pain_level BETWEEN 1 AND 10),
  CONSTRAINT pl_workout_feedback_pain_consistency CHECK (
    (pain = false AND pain_level IS NULL AND pain_area IS NULL)
    OR (pain = true)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_workout_feedback TO authenticated;
GRANT ALL ON public.pl_workout_feedback TO service_role;

ALTER TABLE public.pl_workout_feedback ENABLE ROW LEVEL SECURITY;

-- Client owns their own feedback (insert/select/update/delete bound to client.user_id).
CREATE POLICY "Client manage own pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = pl_workout_feedback.client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = pl_workout_feedback.client_id AND c.user_id = auth.uid()));

-- Assigned coach can read/update (e.g. mark reviewed) for their clients.
CREATE POLICY "Coach manage pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR ALL
  TO authenticated
  USING (public.is_assigned_coach(client_id))
  WITH CHECK (public.is_assigned_coach(client_id));

-- Admin full access.
CREATE POLICY "Admin manage pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_pl_workout_feedback_client ON public.pl_workout_feedback(client_id, created_at DESC);
CREATE INDEX idx_pl_workout_feedback_day ON public.pl_workout_feedback(day_id);
CREATE INDEX idx_pl_workout_feedback_unreviewed ON public.pl_workout_feedback(client_id) WHERE reviewed_at IS NULL;

CREATE TRIGGER trg_pl_workout_feedback_touch
  BEFORE UPDATE ON public.pl_workout_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();