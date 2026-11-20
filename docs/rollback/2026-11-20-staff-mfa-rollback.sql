-- Rollback for supabase/migrations/20270424091500_staff_mfa.sql.
-- Puts has_role, has_permission, is_admin_viewer and is_business_owner back
-- exactly as production had them on Nov 20 2026 (read from pg_get_functiondef
-- before the change), then drops the two new functions. Run as the database
-- owner. The app side: remove staffMfaGuard from src/start.ts and
-- <StaffMfaGate> from src/routes/_authenticated/route.tsx. Authenticators
-- people added can stay (nothing reads them any more) or be removed with
--   DELETE FROM auth.mfa_factors WHERE user_id = '<login id>';

SET lock_timeout = '5s';
BEGIN;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
    OR (_role = 'admin'
        AND current_setting('transaction_read_only') = 'on'
        AND (nullif(current_setting('request.headers', true), '')::json ->> 'x-jf-admin-view') IS NOT NULL
        AND _user_id = auth.uid()
        AND public.is_admin_viewer())
$function$;

CREATE OR REPLACE FUNCTION public.is_business_owner(_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.business_owners where user_id = _uid); $function$;

CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid, _perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL
    AND (
      (_perm LIKE 'finance.%' AND public.is_business_owner(_uid))
      OR (_perm NOT LIKE 'finance.%' AND EXISTS (
            SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'admin'))
      OR EXISTS (SELECT 1 FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role = ur.role
                  WHERE ur.user_id = _uid AND rp.permission = _perm)
    )
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                  JOIN public.role_permissions rp ON rp.role = ur.role
                 WHERE ur.user_id = auth.uid() AND rp.permission = 'admin.view')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
$function$;

DROP FUNCTION IF EXISTS public.mfa_enforced_logins();
DROP FUNCTION IF EXISTS public.caller_mfa_ok(uuid);

COMMIT;
RESET lock_timeout;
