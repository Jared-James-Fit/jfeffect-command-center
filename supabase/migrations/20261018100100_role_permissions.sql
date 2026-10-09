-- Permissions on top of roles.
--
-- role_permissions maps an app_role to named permissions ("area.verb").
-- has_permission(uid, perm) answers "may this user do this?" and is what RLS
-- and server code check, instead of hard-coding role names.
--
-- Rules:
--   * finance.* belongs to the business owner (business_owners, #339) plus
--     whatever role_permissions grants. Admins who aren't the owner don't
--     get the books, matching the owner-only Taxes & Books rule.
--   * Any other permission: admins have it (no seed row needed).
--   * Checking your OWN permissions requires an MFA-verified session (aal2),
--     so a password alone never opens the books.
--   * The mapping changes through migrations only (no write policies).

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role public.app_role NOT NULL,
  permission text NOT NULL CHECK (permission ~ '^[a-z_]+\.[a-z_]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions readable" ON public.role_permissions;
CREATE POLICY "role_permissions readable" ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.role_permissions (role, permission) VALUES
  ('finance', 'finance.read'),
  ('finance', 'finance.record')
ON CONFLICT DO NOTHING;

-- True when the caller's JWT was issued after an MFA challenge.
CREATE OR REPLACE FUNCTION public.session_mfa_verified()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid IS NOT NULL
    AND (_uid IS DISTINCT FROM auth.uid() OR public.session_mfa_verified())
    AND (
      (_perm LIKE 'finance.%' AND public.is_business_owner(_uid))
      OR (_perm NOT LIKE 'finance.%' AND EXISTS (
            SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'admin'))
      OR EXISTS (SELECT 1 FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role = ur.role
                  WHERE ur.user_id = _uid AND rp.permission = _perm)
    )
$$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_mfa_verified() TO authenticated, service_role;
