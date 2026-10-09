-- Admin requires MFA in the database, not just in the UI.
--
-- has_role(auth.uid(), 'admin') is what every existing admin RLS policy
-- checks. It now only counts in an MFA-verified (aal2) session, so a stolen
-- admin password alone can't read or write admin data through the API.
-- Checks about OTHER users (has_role(some_user, 'admin')) and service-role
-- code (no auth.uid()) are unchanged. Other roles are unchanged.
--
-- APPLY ONLY AFTER the admin has enrolled an authenticator through the new
-- /admin two-step verification screen (PR "Staff MFA"), and TOTP is enabled
-- under Supabase Auth > Multi-Factor. Until the admin's session is aal2,
-- admin pages show no data.
--
-- Roll back: re-run the previous definition
--   CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
--   AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
     AND (_role <> 'admin' OR _user_id IS DISTINCT FROM auth.uid() OR public.session_mfa_verified())
$$;
