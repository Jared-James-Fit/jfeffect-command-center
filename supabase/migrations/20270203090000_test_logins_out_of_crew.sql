-- Test logins never show to the crew. On Nov 5 a QA run made two members
-- ("QA Tester A / B", jf.qa.member.a/b@example.com) on the live app, and every
-- client saw them under "Suggested for you" ("New to the Crew") and in the views
-- on the coach's lesson until the run cleaned them up.
--
-- A test login is one on a reserved test domain (RFC 2606 / 6761): example.com,
-- example.org, example.net, or any address ending .test, .example, .invalid or
-- .localhost. Real people can't sign up with those.

CREATE OR REPLACE FUNCTION public.is_test_login(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT lower(split_part(u.email, '@', 2)) IN ('example.com', 'example.org', 'example.net')
        OR lower(u.email) ~ '\.(test|example|invalid|localhost)$'
      FROM auth.users u
     WHERE u.id = _uid
  ), false)
$function$;

REVOKE ALL ON FUNCTION public.is_test_login(uuid) FROM public, anon, authenticated;

-- The crew's one directory (Find athletes, suggestions, the @ picker, mentions):
-- the live definition, with test logins left out.
CREATE OR REPLACE FUNCTION public.community_member_directory()
 RETURNS TABLE(user_id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.user_id, public.community_author(m.user_id)->>'name'
    FROM (SELECT DISTINCT x.user_id FROM (
            SELECT c.user_id FROM public.clients c
             WHERE c.user_id IS NOT NULL AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
               AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false
            UNION ALL
            SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach')) x) m
   WHERE NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)
     AND NOT public.is_test_login(m.user_id)
$function$;

-- A test login's view never counts on anyone's post (or names it in Activity).
CREATE OR REPLACE FUNCTION public.community_post_views_skip_test_logins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_test_login(NEW.viewer_user_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS community_post_views_skip_test_logins ON public.community_post_views;
CREATE TRIGGER community_post_views_skip_test_logins
  BEFORE INSERT ON public.community_post_views
  FOR EACH ROW EXECUTE FUNCTION public.community_post_views_skip_test_logins();
