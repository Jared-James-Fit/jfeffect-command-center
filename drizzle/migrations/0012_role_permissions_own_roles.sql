-- role_permissions: a signed-in person reads only the permissions of roles
-- they hold (admins read the whole list). has_permission() is SECURITY
-- DEFINER, so permission checks are unaffected.
DROP POLICY IF EXISTS "role_permissions readable" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions own roles readable" ON public.role_permissions;
CREATE POLICY "role_permissions own roles readable" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (
    role IN (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = (SELECT auth.uid()))
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
  );
