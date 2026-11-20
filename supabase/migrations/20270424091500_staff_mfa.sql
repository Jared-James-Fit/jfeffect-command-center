-- Two-step sign-in for the admin and finance logins (src/lib/mfa-rules.ts).
--
-- The rule, Supabase's "enforce MFA for those who enrolled": a login that has
-- a verified authenticator (auth.mfa_factors) holds its staff rights only in
-- a session that has had the code (the access token's "aal" = 'aal2'). A
-- password alone, a stolen one included, gets nothing a client wouldn't.
-- Logins without an authenticator are exactly as before, so this changes
-- nothing for anyone until they set one up (the app asks the admin and the
-- finance login to, the first time they open it).
--
-- The four functions every staff rule goes through each gain that one check,
-- and nothing else changes in them (their bodies are production's as of
-- Nov 20 2026):
--   has_role          every staff role (never 'client'); the admin-view
--                     branch goes through is_admin_viewer, which checks too
--   has_permission    finance.* and every role permission
--   is_admin_viewer   the finance login's read-only admin view
--   is_business_owner the books
-- The check applies only to the caller's own session (_uid = auth.uid()):
-- asking whether someone else holds a role, the server (service role, no
-- auth.uid()) and pg_cron are unaffected. It runs only after the role itself
-- is found (CASE), so a client's query never looks at auth.mfa_factors.
--
-- mfa_enforced_logins() is for the server's guard (mfa-guard.server.ts),
-- which refuses every server function to such a session: many server
-- functions read user_roles themselves and then act as the service role, so
-- the database's check alone wouldn't reach them.
--
-- Locked out (a lost phone, no backup authenticator): remove the login's
-- factors as the database owner and they set up a new one on next open:
--   DELETE FROM auth.mfa_factors WHERE user_id = '<login id>';
-- (docs/SECURITY_AUDIT_2026-11.md, "Two-step sign-in").

SET lock_timeout = '5s';

-- ── The session may use this login's staff rights ───────────────────────────
CREATE OR REPLACE FUNCTION public.caller_mfa_ok(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS DISTINCT FROM auth.uid()
      OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      OR NOT EXISTS (
           SELECT 1 FROM auth.mfa_factors f
            WHERE f.user_id = _uid AND f.status = 'verified'
         );
$function$;
REVOKE ALL ON FUNCTION public.caller_mfa_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_mfa_ok(uuid) TO authenticated, service_role;

-- ── The logins whose sessions need their code (server only) ─────────────────
CREATE OR REPLACE FUNCTION public.mfa_enforced_logins()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT f.user_id
    FROM auth.mfa_factors f
   WHERE f.status = 'verified';
$function$;
REVOKE ALL ON FUNCTION public.mfa_enforced_logins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_enforced_logins() TO service_role;

-- ── has_role ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
             THEN (_role = 'client' OR public.caller_mfa_ok(_user_id))
           ELSE false
         END
    OR (_role = 'admin'
        AND current_setting('transaction_read_only') = 'on'
        AND (nullif(current_setting('request.headers', true), '')::json ->> 'x-jf-admin-view') IS NOT NULL
        AND _user_id = auth.uid()
        AND public.is_admin_viewer())
$function$;

-- ── is_business_owner ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_business_owner(_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.business_owners WHERE user_id = _uid)
             THEN public.caller_mfa_ok(_uid)
           ELSE false
         END;
$function$;

-- ── has_permission ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid, _perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN _uid IS NULL THEN false
           WHEN (_perm LIKE 'finance.%' AND public.is_business_owner(_uid))
             OR (_perm NOT LIKE 'finance.%' AND EXISTS (
                   SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'admin'))
             OR EXISTS (SELECT 1 FROM public.user_roles ur
                          JOIN public.role_permissions rp ON rp.role = ur.role
                         WHERE ur.user_id = _uid AND rp.permission = _perm)
             THEN public.caller_mfa_ok(_uid)
           ELSE false
         END
$function$;

-- ── is_admin_viewer ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN auth.uid() IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.user_roles ur
                          JOIN public.role_permissions rp ON rp.role = ur.role
                         WHERE ur.user_id = auth.uid() AND rp.permission = 'admin.view')
            AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                             WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
             THEN public.caller_mfa_ok(auth.uid())
           ELSE false
         END
$function$;

RESET lock_timeout;
