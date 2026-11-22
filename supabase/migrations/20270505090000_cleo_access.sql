-- Who can use Cleo, the AI assistant (Admin → Settings → AI & Cleo).
--
-- The admin always can. The finance login and coaches can only while the
-- admin has them switched on (app_settings 'cleo_access'). Clients and JF
-- members never can: there is no client-facing Cleo, so nothing here can
-- switch one on.
--
-- One rule, `cleo_allowed()`, read by every Cleo server function before it
-- does anything (src/lib/cleo-access.server.ts) and by the policies that let
-- a coach keep their own Cleo chats, settings and attachments.
--
-- Defaults keep today's access exactly: the finance login on, coaches off.

INSERT INTO public.app_settings (key, value)
VALUES ('cleo_access', '{"coach":false,"finance":true}')
ON CONFLICT (key) DO NOTHING;

/** (internal) The admin's Cleo access settings, with the defaults filled in. */
CREATE OR REPLACE FUNCTION public.cleo_access_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  raw text;
  j jsonb := '{}'::jsonb;
BEGIN
  SELECT value INTO raw FROM public.app_settings WHERE key = 'cleo_access';
  BEGIN
    j := coalesce(raw::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN
    j := '{}'::jsonb;
  END;
  RETURN jsonb_build_object(
    'coach', coalesce((j ->> 'coach')::boolean, false),
    'finance', coalesce((j ->> 'finance')::boolean, true)
  );
END $$;

REVOKE ALL ON FUNCTION public.cleo_access_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_access_settings() TO service_role;

/** May the signed-in person use Cleo right now? The admin always; the finance login and coaches only while switched on. */
CREATE OR REPLACE FUNCTION public.cleo_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.has_role(auth.uid(), 'admin'::public.app_role) THEN true
    WHEN public.is_admin_viewer() THEN (public.cleo_access_settings() ->> 'finance')::boolean
    WHEN public.has_role(auth.uid(), 'coach'::public.app_role) THEN (public.cleo_access_settings() ->> 'coach')::boolean
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.cleo_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_allowed() TO authenticated, service_role;

/** The admin reads the settings (anyone else is refused). */
CREATE OR REPLACE FUNCTION public.cleo_access_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an admin can see who has Cleo' USING ERRCODE = '42501';
  END IF;
  RETURN public.cleo_access_settings();
END $$;

REVOKE ALL ON FUNCTION public.cleo_access_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_access_get() TO authenticated, service_role;

/** The admin switches Cleo on or off for coaches and the finance login. */
CREATE OR REPLACE FUNCTION public.cleo_access_set(_coach boolean, _finance boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v text := jsonb_build_object('coach', coalesce(_coach, false), 'finance', coalesce(_finance, false))::text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an admin can change who has Cleo' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('cleo_access', v, now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
  RETURN public.cleo_access_settings();
END $$;

REVOKE ALL ON FUNCTION public.cleo_access_set(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleo_access_set(boolean, boolean) TO authenticated, service_role;

-- A coach with Cleo keeps their own chats, settings and attachments, like the
-- admin and the finance login already do (their policies are unchanged).
DROP POLICY IF EXISTS "cleo users own summer messages" ON public.summer_messages;
CREATE POLICY "cleo users own summer messages" ON public.summer_messages
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_allowed()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_allowed()));

DROP POLICY IF EXISTS "cleo users own summer chats" ON public.summer_chats;
CREATE POLICY "cleo users own summer chats" ON public.summer_chats
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_allowed()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_allowed()));

DROP POLICY IF EXISTS "cleo users own summer profile" ON public.summer_profiles;
CREATE POLICY "cleo users own summer profile" ON public.summer_profiles
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_allowed()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_allowed()));

DROP POLICY IF EXISTS "cleo users own summer attachments" ON public.summer_attachments;
CREATE POLICY "cleo users own summer attachments" ON public.summer_attachments
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_allowed()))
  WITH CHECK (user_id = (SELECT auth.uid())
              AND split_part(path, '/', 1) = (SELECT auth.uid())::text
              AND (SELECT public.cleo_allowed()));

DROP POLICY IF EXISTS "cleo users attachments read" ON storage.objects;
CREATE POLICY "cleo users attachments read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cleo-attachments'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
         AND (SELECT public.cleo_allowed()));

DROP POLICY IF EXISTS "cleo users attachments insert" ON storage.objects;
CREATE POLICY "cleo users attachments insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cleo-attachments'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
              AND (SELECT public.cleo_allowed()));

DROP POLICY IF EXISTS "cleo users attachments delete" ON storage.objects;
CREATE POLICY "cleo users attachments delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cleo-attachments'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
         AND (SELECT public.cleo_allowed()));
