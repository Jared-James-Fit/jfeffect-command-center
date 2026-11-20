-- Read rules that let every signed-in person (or anyone) read whole tables or
-- whole file areas are narrowed to the people who need them. Admins keep
-- their existing manage-everything rules; the public Hall of Strength,
-- careers and rankings read through SECURITY DEFINER functions and are
-- unaffected.

-- Clients whose powerlifting records the caller may read: their own client
-- record, a staff login's linked client account, and the clients they coach.
CREATE OR REPLACE FUNCTION public.powerlifting_visible_client_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id FROM public.clients c WHERE c.user_id = auth.uid()
  UNION
  SELECT public.linked_client_id() WHERE public.linked_client_id() IS NOT NULL
  UNION
  SELECT public.coached_client_ids()
$$;
REVOKE ALL ON FUNCTION public.powerlifting_visible_client_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.powerlifting_visible_client_ids() TO authenticated, service_role;

-- A photo in the avatars area that other athletes are meant to see: a Crew
-- profile photo or a coach's team photo (what community_avatar() returns).
-- Account / verification photos are not shared.
CREATE OR REPLACE FUNCTION public.avatar_is_shared(_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _name IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.avatar_path = _name)
    OR EXISTS (SELECT 1 FROM public.coaches co WHERE co.profile_picture_url = _name)
  )
$$;
REVOKE ALL ON FUNCTION public.avatar_is_shared(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatar_is_shared(text) TO authenticated, service_role;

-- Powerlifting results: own, linked, coached clients; view-only staff.
DROP POLICY IF EXISTS "Authenticated read athlete records" ON public.athlete_powerlifting_results;
CREATE POLICY "Read own or coached athlete records"
  ON public.athlete_powerlifting_results FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin_viewer())
    OR client_id IN (SELECT public.powerlifting_visible_client_ids())
    OR athlete_id IN (
      SELECT pa.id FROM public.powerlifting_athletes pa
       WHERE pa.client_id IN (SELECT public.powerlifting_visible_client_ids()))
  );

DROP POLICY IF EXISTS "Authenticated read powerlifting athletes" ON public.powerlifting_athletes;
CREATE POLICY "Read own or coached powerlifting athletes"
  ON public.powerlifting_athletes FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin_viewer())
    OR client_id IN (SELECT public.powerlifting_visible_client_ids())
  );

DROP POLICY IF EXISTS "Authenticated read coaching periods" ON public.powerlifting_coaching_periods;
CREATE POLICY "Read own or coached coaching periods"
  ON public.powerlifting_coaching_periods FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin_viewer())
    OR athlete_id IN (
      SELECT pa.id FROM public.powerlifting_athletes pa
       WHERE pa.client_id IN (SELECT public.powerlifting_visible_client_ids()))
  );

-- Access level catalog: staff screens only (was readable by anyone).
DROP POLICY IF EXISTS "Anyone can read access_levels" ON public.access_levels;
CREATE POLICY "Staff read access_levels"
  ON public.access_levels FOR SELECT TO authenticated
  USING (
    (SELECT public.is_coach_or_admin((SELECT auth.uid())))
    OR (SELECT public.is_admin_viewer())
  );

-- Read only by the server and admins (their manage rules stay).
DROP POLICY IF EXISTS "Authenticated read product_access_grants" ON public.product_access_grants;
DROP POLICY IF EXISTS "Authenticated read jf settings" ON public.jf_membership_settings;
DROP POLICY IF EXISTS "auth read live agents" ON public.live_support_agents;

-- Avatars: your own folder, staff, or a photo meant to be shown to others.
DROP POLICY IF EXISTS "Auth view avatars" ON storage.objects;
CREATE POLICY "Read own, shared or staff avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars' AND (
      (storage.foldername(name))[1] = (SELECT auth.uid()::text)
      OR (SELECT public.is_coach_or_admin((SELECT auth.uid())))
      OR (SELECT public.is_admin_viewer())
      OR public.avatar_is_shared(name)
    )
  );

-- Agreement template PDFs: staff only (admins and view-only logins already
-- have their own rules).
DROP POLICY IF EXISTS "Read template pdf via auth" ON storage.objects;
CREATE POLICY "Coaches read agreement templates"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'agreements'
    AND (storage.foldername(name))[1] = 'templates'
    AND (SELECT public.is_coach_or_admin((SELECT auth.uid())))
  );

-- Chat sounds play from the long-lived link saved when they're uploaded, so
-- only the admins and coaches who manage the library read the files.
DROP POLICY IF EXISTS "chat-sounds read authed" ON storage.objects;
CREATE POLICY "chat-sounds admin/coach read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-sounds'
    AND (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role)
              OR public.has_role((SELECT auth.uid()), 'coach'::app_role))
  );

-- Product images: signed by the admin product screens only.
DROP POLICY IF EXISTS "authenticated read product images" ON storage.objects;
CREATE POLICY "Coaches read product images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (SELECT public.is_coach_or_admin((SELECT auth.uid())))
  );
