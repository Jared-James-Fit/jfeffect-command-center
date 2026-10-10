-- The finance login signs in with a password alone: no authenticator-app step.
-- has_permission() and is_admin_viewer() no longer ask for an MFA-verified
-- (aal2) session. Everything else in them is unchanged: finance.* still needs
-- the business owner or a role grant, admins never match the viewer.

CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid IS NOT NULL
    AND (
      (_perm LIKE 'finance.%' AND public.is_business_owner(_uid))
      OR (_perm NOT LIKE 'finance.%' AND EXISTS (
            SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'admin'))
      OR EXISTS (SELECT 1 FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role = ur.role
                  WHERE ur.user_id = _uid AND rp.permission = _perm)
    )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                  JOIN public.role_permissions rp ON rp.role = ur.role
                 WHERE ur.user_id = auth.uid() AND rp.permission = 'admin.view')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
$$;

-- Nothing uses it any more.
DROP FUNCTION IF EXISTS public.session_mfa_verified();
