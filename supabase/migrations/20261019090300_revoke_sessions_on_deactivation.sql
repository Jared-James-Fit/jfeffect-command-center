-- Deactivating a coach or client (or emptying a staff login of its roles)
-- signs that login out everywhere.
--
-- revoke_user_sessions() deletes the login's auth sessions; their refresh
-- tokens go with them, so no device can renew its access token. An access
-- token already issued keeps working until it expires (Auth > JWT expiry,
-- 1 hour by default), but RLS already reads live status: an archived coach
-- fails is_assigned_coach / is_active_coach straight away.
--
-- Triggers fire on the deactivation itself, so every path is covered: server
-- functions, the admin pages that update rows from the browser, and SQL.
-- A login that is also a staff account isn't signed out because its client
-- record was deactivated (existing mixed accounts, until they're split).

CREATE OR REPLACE FUNCTION public.revoke_user_sessions(_uid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RETURN 0;
  END IF;
  BEGIN
    DELETE FROM auth.sessions WHERE user_id = _uid;
    GET DIAGNOSTICS n = ROW_COUNT;
    -- Legacy refresh tokens that predate sessions.
    DELETE FROM auth.refresh_tokens WHERE user_id = _uid::text AND session_id IS NULL;
  EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN
    -- Never block the deactivation itself; leave a trace in the logs.
    RAISE WARNING 'revoke_user_sessions(%): %', _uid, SQLERRM;
    RETURN -1;
  END;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.login_has_staff_role(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r
                  WHERE r.user_id = _uid AND r.role::text IN ('admin', 'coach', 'media_manager', 'finance'))
$$;
REVOKE ALL ON FUNCTION public.login_has_staff_role(uuid) FROM PUBLIC, anon;

-- Coach: active (not archived, status Active) -> anything else.
CREATE OR REPLACE FUNCTION public.tg_coach_deactivated_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND OLD.archived = false AND OLD.status = 'Active'
     AND (NEW.archived = true OR NEW.status IS DISTINCT FROM 'Active') THEN
    PERFORM public.revoke_user_sessions(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS coach_deactivated_revoke_sessions ON public.coaches;
CREATE TRIGGER coach_deactivated_revoke_sessions
  AFTER UPDATE OF archived, status ON public.coaches
  FOR EACH ROW EXECUTE FUNCTION public.tg_coach_deactivated_revoke();

-- Client: deactivated, archived, or portal access switched off.
CREATE OR REPLACE FUNCTION public.tg_client_deactivated_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND (
       (coalesce(NEW.portal_access_disabled, false) AND NOT coalesce(OLD.portal_access_disabled, false))
       OR (coalesce(NEW.archived, false) AND NOT coalesce(OLD.archived, false))
       OR (NEW.status = 'Deactivated' AND OLD.status IS DISTINCT FROM 'Deactivated')
     )
     AND NOT public.login_has_staff_role(NEW.user_id) THEN
    PERFORM public.revoke_user_sessions(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS client_deactivated_revoke_sessions ON public.clients;
CREATE TRIGGER client_deactivated_revoke_sessions
  AFTER UPDATE OF portal_access_disabled, archived, status ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_deactivated_revoke();

-- Staff login losing its last staff role (e.g. revoking a media manager or
-- finance login) while it has no client/member record to fall back to.
CREATE OR REPLACE FUNCTION public.tg_staff_role_removed_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role::text IN ('admin', 'coach', 'media_manager', 'finance')
     AND NOT public.login_has_staff_role(OLD.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = OLD.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.app_members m WHERE m.user_id = OLD.user_id) THEN
    PERFORM public.revoke_user_sessions(OLD.user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS staff_role_removed_revoke_sessions ON public.user_roles;
CREATE TRIGGER staff_role_removed_revoke_sessions
  AFTER DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_staff_role_removed_revoke();
