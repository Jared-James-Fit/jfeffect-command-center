-- The finance login sees everything the admin sees, read-only.
--
-- How: has_role(you, 'admin') is also true for a view-only login, but only
-- inside a read-only transaction, and only on an API request that asks for it
-- with the x-jf-admin-view header.
--
--   * Read-only: every read the app makes through the API (PostgREST GET:
--     table reads, counts, and functions called with get: true) runs in a
--     read-only transaction, and Postgres refuses every write in one,
--     including writes inside SECURITY DEFINER functions. So the login reads
--     exactly what the admin reads (today's rules and every rule added later,
--     with nothing to keep in sync) and can't change anything that way.
--   * The header: the browser sends it; server code never does. Some server
--     functions treat "the caller can read this row" as permission to change
--     it with the service key, so on the server a view-only login must stay a
--     plain non-admin. (A server function that only reads asks for the header
--     on purpose: assertAdminView in src/lib/permissions.server.ts.) The
--     header can only ever widen reads for a view-only login; for anyone else
--     it does nothing.
--
-- What it may change is granted separately: the books (finance.*, earlier
-- migrations), its own Cleo chat, discount codes (below), and the server
-- functions that check payments.record / payments.request.
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
        AND (nullif(current_setting('request.headers', true), '')::json ->> 'x-jf-admin-view') IS NOT NULL
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

-- Discount codes: discounts.manage creates, edits and pauses them (no delete),
-- and its changes land in the same audit log as the admin's.
DROP POLICY IF EXISTS "discounts.manage read" ON public.discount_codes;
CREATE POLICY "discounts.manage read" ON public.discount_codes
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'discounts.manage'));
DROP POLICY IF EXISTS "discounts.manage insert" ON public.discount_codes;
CREATE POLICY "discounts.manage insert" ON public.discount_codes
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'discounts.manage'));
DROP POLICY IF EXISTS "discounts.manage update" ON public.discount_codes;
CREATE POLICY "discounts.manage update" ON public.discount_codes
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'discounts.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'discounts.manage'));
DROP POLICY IF EXISTS "discounts.manage read redemptions" ON public.discount_code_redemptions;
CREATE POLICY "discounts.manage read redemptions" ON public.discount_code_redemptions
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'discounts.manage'));
DROP POLICY IF EXISTS "discounts.manage audit insert" ON public.discount_code_audit_log;
CREATE POLICY "discounts.manage audit insert" ON public.discount_code_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'discounts.manage'));

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
