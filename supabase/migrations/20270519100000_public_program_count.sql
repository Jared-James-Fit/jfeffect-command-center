-- How many JF Effect programs are in the members' app, for the home page's
-- proof strip (Nov 23 2026). The page used to say "15" in its source, which
-- went stale the day a program was added; it now reads this count, so a
-- program listed for members (Programming → Programs → Membership app) shows
-- up on jfeffect.com with nothing typed.
--
-- "Live" is the members' library's own rule (library-view.ts `isLiveListing`,
-- listMembershipLibrary): status 'Published' and membership_status 'live'.
-- Anyone may ask (the home page is public); it returns one number and reads
-- nothing else about the programs.

SET lock_timeout = '8s';

CREATE OR REPLACE FUNCTION public.public_program_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::integer
    FROM public.member_plans
   WHERE status = 'Published' AND membership_status = 'live'
$$;
REVOKE ALL ON FUNCTION public.public_program_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_program_count() TO anon, authenticated, service_role;
