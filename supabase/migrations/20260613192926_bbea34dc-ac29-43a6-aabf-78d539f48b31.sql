-- 1) Replace policies: split client/coach/admin and drop blanket update access.
DROP POLICY IF EXISTS "Client manage own pl_workout_feedback" ON public.pl_workout_feedback;
DROP POLICY IF EXISTS "Coach manage pl_workout_feedback" ON public.pl_workout_feedback;
DROP POLICY IF EXISTS "Admin manage pl_workout_feedback" ON public.pl_workout_feedback;

-- Client: insert only for own completion (derived ownership check), and only when not yet reviewed.
CREATE POLICY "Client insert own pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (
    reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.pl_day_completions dc
      JOIN public.clients c ON c.id = dc.client_id
      WHERE dc.id = pl_workout_feedback.completion_id
        AND c.user_id = auth.uid()
        AND dc.client_id = pl_workout_feedback.client_id
        AND dc.day_id     = pl_workout_feedback.day_id
    )
  );

-- Client read own.
CREATE POLICY "Client read own pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = pl_workout_feedback.client_id AND c.user_id = auth.uid())
  );

-- Coach / admin read.
CREATE POLICY "Coach or admin read pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach(client_id)
  );

-- Admin full management (kept for support workflows).
CREATE POLICY "Admin manage pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Intentionally NO general UPDATE/DELETE policy for clients or coaches.
-- Coaches must use the mark_workout_feedback_reviewed RPC below; RLS without
-- an UPDATE policy blocks every other write path.

-- 2) Tighten the pain consistency CHECK constraint.
ALTER TABLE public.pl_workout_feedback DROP CONSTRAINT IF EXISTS pl_workout_feedback_pain_consistency;
ALTER TABLE public.pl_workout_feedback ADD CONSTRAINT pl_workout_feedback_pain_consistency CHECK (
  (pain = false AND pain_level IS NULL AND pain_area IS NULL)
  OR (
    pain = true
    AND pain_level IS NOT NULL AND pain_level BETWEEN 1 AND 10
    AND pain_area  IS NOT NULL AND length(btrim(pain_area)) > 0
  )
);

-- 3) Narrow RPC: only updates reviewed_by / reviewed_at, derives reviewer from auth.uid().
CREATE OR REPLACE FUNCTION public.mark_workout_feedback_reviewed(_feedback_id uuid)
RETURNS public.pl_workout_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.pl_workout_feedback;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row FROM public.pl_workout_feedback WHERE id = _feedback_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'feedback_not_found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_assigned_coach(v_row.client_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.pl_workout_feedback
     SET reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = _feedback_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_workout_feedback_reviewed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_workout_feedback_reviewed(uuid) TO authenticated;