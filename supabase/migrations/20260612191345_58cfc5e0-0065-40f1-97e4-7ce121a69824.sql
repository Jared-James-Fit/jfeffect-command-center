
CREATE TABLE public.logged_set_edit_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_log_id uuid NULL,
  client_id uuid NULL,
  workout_id uuid NULL,
  enrollment_id uuid NULL,
  program_id uuid NULL,
  exercise_id uuid NULL,
  exercise_name text NULL,
  field_changed text NOT NULL,
  previous_value text NULL,
  new_value text NULL,
  edited_by_user_id uuid NULL,
  edited_by_role text NULL,
  edit_source text NOT NULL DEFAULT 'coach_pov',
  reason text NULL,
  page_route text NULL,
  details jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lsea_client ON public.logged_set_edit_audit (client_id, created_at DESC);
CREATE INDEX idx_lsea_set_log ON public.logged_set_edit_audit (set_log_id, created_at DESC);
CREATE INDEX idx_lsea_editor ON public.logged_set_edit_audit (edited_by_user_id, created_at DESC);

GRANT SELECT, INSERT ON public.logged_set_edit_audit TO authenticated;
GRANT ALL ON public.logged_set_edit_audit TO service_role;

ALTER TABLE public.logged_set_edit_audit ENABLE ROW LEVEL SECURITY;

-- Admins: read everything
CREATE POLICY "lsea_admin_read"
ON public.logged_set_edit_audit
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Assigned coach: read for their client
CREATE POLICY "lsea_coach_read_assigned"
ON public.logged_set_edit_audit
FOR SELECT
TO authenticated
USING (
  client_id IS NOT NULL
  AND public.is_assigned_coach(client_id)
);

-- Client: read their own audit rows
CREATE POLICY "lsea_client_read_self"
ON public.logged_set_edit_audit
FOR SELECT
TO authenticated
USING (
  client_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id AND c.user_id = auth.uid()
  )
);

-- Insert: any authenticated user can insert ONLY rows where they are the editor
-- (coach/admin POV write happens client-side via the user's bearer token).
CREATE POLICY "lsea_insert_self_as_editor"
ON public.logged_set_edit_audit
FOR INSERT
TO authenticated
WITH CHECK (
  edited_by_user_id = auth.uid()
);
