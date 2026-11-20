-- Full-size Crew photos for the photo viewer (Nov 19 2026).
--
-- A Crew photo is saved twice: `<uid>/community-<t>.jpg` at 512 px, which
-- every face in the app loads, and `<uid>/community-<t>-full.jpg` at up to
-- 1080 px beside it, which only the photo viewer loads when someone taps a
-- profile photo to enlarge it (community-media.ts, photo-zoom.ts).
--
-- Whoever may see a Crew photo may see its full-size copy, and nobody else:
-- the copy is shared exactly when the photo it belongs to is. Nothing else
-- about who reads the avatars folder changes (own folder, staff, a shared
-- Crew photo or a coach's team photo).
CREATE OR REPLACE FUNCTION public.avatar_is_shared(_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _name IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.avatar_path = _name)
    OR (
      _name LIKE '%/community-%-full.jpg'
      AND EXISTS (SELECT 1 FROM public.community_profiles cp WHERE cp.avatar_path = left(_name, -9) || '.jpg')
    )
    OR EXISTS (SELECT 1 FROM public.coaches co WHERE co.profile_picture_url = _name)
  )
$$;
REVOKE ALL ON FUNCTION public.avatar_is_shared(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatar_is_shared(text) TO authenticated, service_role;
