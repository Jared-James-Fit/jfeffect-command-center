-- The finance login sees everything the admin sees, read-only.
--
-- How: has_role(you, 'admin') is also true for a view-only login, but only
-- inside a read-only transaction. Every read the app makes through the API
-- (PostgREST GET: table reads, counts, and functions called with get: true)
-- runs in one, and Postgres refuses every write in a read-only transaction,
-- including writes inside SECURITY DEFINER functions. So the login reads
-- exactly what the admin reads (today's rules and every rule added later, with
-- nothing to keep in sync) and can't change anything that way. Writes (POST,
-- PATCH, DELETE, server code) run read-write, where it's not an admin.
--
-- What it may change is granted separately: the books (finance.*, earlier
-- migrations), its own Cleo chat, and the server functions that check
-- payments.record / payments.request / discounts.manage.
--
-- Viewing needs an MFA-verified session, like everything else finance does.

INSERT INTO public.role_permissions (role, permission) VALUES
  ('finance', 'admin.view'),
  ('finance', 'payments.record'),
  ('finance', 'payments.request'),
  ('finance', 'discounts.manage')
ON CONFLICT DO NOTHING;

-- A view-only login, MFA-verified, that isn't an admin. Admins never match,
-- so nothing below changes anything for them.
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

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
    OR (_role = 'admin'
        AND current_setting('transaction_read_only') = 'on'
        AND _user_id = auth.uid()
        AND public.is_admin_viewer())
$$;

-- Credentials aren't information: view-only logins never read stored tokens,
-- invite or reset links, or integration keys, even where the admin can.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'google_calendar_connections', 'signnow_settings', 'wearable_connection_secrets',
    'password_recovery_tokens', 'na_guest_tokens', 'email_unsubscribe_tokens',
    'coach_invites', 'staff_invites'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS "view-only logins: no credentials" ON public.%I', t);
    EXECUTE format('CREATE POLICY "view-only logins: no credentials" ON public.%I AS RESTRICTIVE
                    FOR SELECT TO authenticated USING (NOT public.is_admin_viewer())', t);
  END LOOP;
END $$;

-- Files. Storage reads aren't read-only transactions, so the admin buckets
-- get a read rule of their own (the same buckets the admin reads).
DROP POLICY IF EXISTS "view-only logins read admin buckets" ON storage.objects;
CREATE POLICY "view-only logins read admin buckets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY[
           'agreements', 'broadcast-media', 'client-action-files', 'form-uploads', 'lift-videos',
           'media-resource-library', 'member-resources', 'message-attachments', 'nutrition-plans',
           'nutrition-submissions', 'product-images', 'progress-media', 'resource-library'])
         AND public.is_admin_viewer());

-- Cleo: a view-only login keeps its own chat and its own Cleo settings.
DROP POLICY IF EXISTS "view-only own summer messages" ON public.summer_messages;
CREATE POLICY "view-only own summer messages" ON public.summer_messages
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_admin_viewer())
  WITH CHECK (user_id = auth.uid() AND public.is_admin_viewer());

DROP POLICY IF EXISTS "view-only own summer profile" ON public.summer_profiles;
CREATE POLICY "view-only own summer profile" ON public.summer_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_admin_viewer())
  WITH CHECK (user_id = auth.uid() AND public.is_admin_viewer());
