
-- =========================================================
-- 1) admin_audit_log
-- =========================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  action text NOT NULL,
  target_table text,
  target_id text,
  summary text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON public.admin_audit_log (action);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx ON public.admin_audit_log (actor_user_id);

GRANT SELECT, INSERT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit log" ON public.admin_audit_log;
CREATE POLICY "Admins read audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Authenticated users may insert their own audit rows (actor must be self).
-- Admin/coach actions performed via server functions should use service_role.
DROP POLICY IF EXISTS "Insert own audit row" ON public.admin_audit_log;
CREATE POLICY "Insert own audit row"
  ON public.admin_audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

-- =========================================================
-- 2) Tighten member_resources / member_plans access
-- =========================================================
DROP POLICY IF EXISTS "Members read published resources" ON public.member_resources;
CREATE POLICY "Members read published resources"
  ON public.member_resources FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      status = 'Published'
      AND (
        required_access_level IS NULL
        OR required_access_level = ''
        OR public.member_has_access(public.current_member_id(), required_access_level)
      )
    )
  );

DROP POLICY IF EXISTS "Members read published plans" ON public.member_plans;
CREATE POLICY "Members read published plans"
  ON public.member_plans FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      status = 'Published'
      AND (
        required_access_level IS NULL
        OR required_access_level = ''
        OR public.member_has_access(public.current_member_id(), required_access_level)
      )
    )
  );

-- =========================================================
-- 3) app_settings: admin/coach only
-- =========================================================
DROP POLICY IF EXISTS "Authenticated can read app_settings" ON public.app_settings;
CREATE POLICY "Admin or coach can read app_settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'coach'::app_role)
  );

-- =========================================================
-- 4) Revoke anon EXECUTE on SECURITY DEFINER helpers
--    (none of them are intended for signed-out callers)
--    Keep authenticated EXECUTE where the app actually calls via RPC.
-- =========================================================
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_assigned_coach(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_coach_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_member_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_has_access(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_client_signed_in() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ping_client_activity(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_can_see_broadcast(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_can_see_recipe(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pl_week_required_workouts(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pl_week_completed_workouts(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pl_recompute_week_status(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pl_recompute_block_status(uuid) FROM anon, PUBLIC;

-- Email queue helpers: server-only. Revoke from anon and authenticated.
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

-- =========================================================
-- 5) Pin search_path on email helpers (linter warning fix)
-- =========================================================
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;
