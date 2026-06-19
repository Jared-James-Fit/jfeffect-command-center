-- Revoke all column privileges from authenticated, then re-grant only non-sensitive columns
REVOKE ALL ON public.google_calendar_connections FROM authenticated;

GRANT SELECT (id, coach_id, user_id, google_account_email, token_expires_at, selected_calendar_id, selected_calendar_name, status, last_synced_at, last_error, scopes, created_at, updated_at)
  ON public.google_calendar_connections TO authenticated;

GRANT UPDATE (selected_calendar_id, selected_calendar_name, status)
  ON public.google_calendar_connections TO authenticated;

GRANT DELETE ON public.google_calendar_connections TO authenticated;

GRANT ALL ON public.google_calendar_connections TO service_role;

-- Replace the single FOR ALL policy with per-command policies so the column-level grants apply cleanly
DROP POLICY IF EXISTS "Coaches manage own gcal connection" ON public.google_calendar_connections;

CREATE POLICY "Coaches read own gcal connection"
ON public.google_calendar_connections
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR user_id = auth.uid());

CREATE POLICY "Coaches update own gcal connection"
ON public.google_calendar_connections
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR user_id = auth.uid())
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR user_id = auth.uid());

CREATE POLICY "Coaches delete own gcal connection"
ON public.google_calendar_connections
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR user_id = auth.uid());
