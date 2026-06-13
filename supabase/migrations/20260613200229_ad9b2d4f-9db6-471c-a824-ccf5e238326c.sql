-- Replace broad Admin ALL policy on pl_workout_feedback with read-only SELECT.
-- Admins (and assigned coaches) keep read access; review metadata is set only
-- through mark_workout_feedback_reviewed RPC. Client INSERT + SELECT unchanged.
DROP POLICY IF EXISTS "Admin manage pl_workout_feedback" ON public.pl_workout_feedback;

-- (The existing "Coach or admin read pl_workout_feedback" SELECT policy already
-- covers admin SELECT, but make admin SELECT explicit to be self-documenting.)
CREATE POLICY "Admin read pl_workout_feedback"
  ON public.pl_workout_feedback
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Tighten table grants: remove direct UPDATE/DELETE from authenticated. All
-- legitimate writes now flow through the SECURITY DEFINER review RPC or the
-- client INSERT policy. service_role retains full access for maintenance.
REVOKE UPDATE, DELETE ON public.pl_workout_feedback FROM authenticated;

-- Rollback:
-- GRANT UPDATE, DELETE ON public.pl_workout_feedback TO authenticated;
-- DROP POLICY "Admin read pl_workout_feedback" ON public.pl_workout_feedback;
-- CREATE POLICY "Admin manage pl_workout_feedback" ON public.pl_workout_feedback
--   FOR ALL TO authenticated
--   USING (has_role(auth.uid(), 'admin'::app_role))
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
