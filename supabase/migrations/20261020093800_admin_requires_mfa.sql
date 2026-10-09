-- Admin requires MFA in the database, not just in the UI.
--
-- has_role(auth.uid(), 'admin') is what every existing admin RLS policy
-- checks. It now only counts in an MFA-verified (aal2) session, so a stolen
-- admin password alone can't read or write admin data through the API.
-- Checks about OTHER users (has_role(some_user, 'admin')) and service-role
-- code (no auth.uid()) are unchanged. Other roles are unchanged.
--
-- It keeps the finance login's read-only admin view from
-- 20261020093700_finance_admin_view.sql (that login is MFA-verified already),
-- so this file must run after that one; its timestamp says so. is_admin_viewer()
-- is restated here so this file also works on its own.
--
-- APPLY ONLY AFTER the admin has enrolled an authenticator through the new
-- /admin two-step verification screen (PR "Staff MFA"), and TOTP is enabled
-- under Supabase Auth > Multi-Factor. Until the admin's session is aal2,
-- admin pages show no data.
--
-- Roll back: re-run has_role from 20261020093700_finance_admin_view.sql.
CREATE OR REPLACE FUNCTION public.is_admin_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.session_mfa_verified()
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                  JOIN public.role_permissions rp ON rp.role = ur.role
                 WHERE ur.user_id = auth.uid() AND rp.permission = 'admin.view')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
$$;
REVOKE ALL ON FUNCTION public.is_admin_viewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_viewer() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
          AND (_role <> 'admin' OR _user_id IS DISTINCT FROM auth.uid() OR public.session_mfa_verified()))
    OR (_role = 'admin'
        AND current_setting('transaction_read_only') = 'on'
        AND (nullif(current_setting('request.headers', true), '')::json ->> 'x-jf-admin-view') IS NOT NULL
        AND _user_id = auth.uid()
        AND public.is_admin_viewer())
$$;
