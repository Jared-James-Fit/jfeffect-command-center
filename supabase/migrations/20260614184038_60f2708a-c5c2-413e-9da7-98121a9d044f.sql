
-- Allow clients to update their own pl_workout_feedback as long as it hasn't been reviewed.
CREATE POLICY "Client update own pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR UPDATE
  TO authenticated
  USING (
    reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = pl_workout_feedback.client_id
        AND c.user_id = auth.uid()
    )
  )
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
        AND dc.day_id = pl_workout_feedback.day_id
    )
  );
