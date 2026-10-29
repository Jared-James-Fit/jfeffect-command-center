-- Rankings, athlete cards and group chats show a person's community photo,
-- never their account photo.
--
-- The account photo (profiles.avatar_url, clients.profile_picture_url) is the
-- verification photo taken at account setup, for the coach. Crew posts moved
-- to the photo people upload for Crew (community_profiles.avatar_path,
-- 20261007120000_community_avatars.sql), but the League, Hall of Strength,
-- powerlifting careers, athlete level cards and coach-run group chats still
-- read the account photo: Reece's and Nicole's verification photos sat on the
-- podium, while Jennifer, who did upload one for Crew, showed as initials.
--
-- One rule now, public.community_avatar(user): the photo they put on their
-- Crew profile, else (a coach, or a coach's linked athlete login) the coach's
-- team photo, else nothing (initials). community_author uses it too.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.community_avatar(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT coalesce((SELECT cp0.same_person_as FROM public.community_profiles cp0 WHERE cp0.user_id = _user_id), _user_id) AS uid
  ),
  accounts AS (
    SELECT me.uid AS user_id FROM me
    UNION
    SELECT cpl.user_id FROM public.community_profiles cpl JOIN me ON cpl.same_person_as = me.uid
  )
  SELECT coalesce(
    (SELECT cp.avatar_path FROM public.community_profiles cp JOIN me ON cp.user_id = me.uid),
    (SELECT c3.profile_picture_url
       FROM public.coaches c3 JOIN accounts a ON a.user_id = c3.user_id
      WHERE nullif(btrim(c3.profile_picture_url), '') IS NOT NULL
        AND (EXISTS (SELECT 1 FROM public.community_profiles t JOIN me ON t.user_id = me.uid WHERE t.title IS NOT NULL)
             OR EXISTS (SELECT 1 FROM accounts a2
                         WHERE public.has_role(a2.user_id, 'admin') OR public.has_role(a2.user_id, 'coach')))
      LIMIT 1))
  WHERE _user_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.community_avatar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_author(_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT coalesce((SELECT cp0.same_person_as FROM public.community_profiles cp0 WHERE cp0.user_id = _user_id), _user_id) AS uid
  ),
  accounts AS (
    SELECT me.uid AS user_id FROM me
    UNION
    SELECT cpl.user_id FROM public.community_profiles cpl JOIN me ON cpl.same_person_as = me.uid
  )
  SELECT jsonb_build_object(
    'user_id', me.uid,
    'is_coach', (staff.yes OR cp.title IS NOT NULL),
    'title', CASE WHEN staff.yes OR cp.title IS NOT NULL THEN coalesce(cp.title, 'Coach · JF Effect') END,
    'name', CASE
      WHEN cp.title IS NOT NULL THEN coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(co.full_name), ''), nullif(btrim(p.full_name), ''), 'Coach')
      WHEN staff.yes THEN coalesce(nullif(btrim(co.first_name), ''), nullif(split_part(btrim(coalesce(co.full_name, p.full_name, '')), ' ', 1), ''), 'Coach')
      ELSE coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''),
                    nullif(split_part(btrim(coalesce(c.full_name, p.full_name, '')), ' ', 1), ''), 'Athlete') END,
    'avatar_url', public.community_avatar(me.uid),
    'username', cp.username)
  FROM me
  LEFT JOIN public.community_profiles cp ON cp.user_id = me.uid
  LEFT JOIN public.profiles p ON p.id = me.uid
  LEFT JOIN LATERAL (SELECT * FROM public.clients c1 WHERE c1.user_id = me.uid LIMIT 1) c ON true
  LEFT JOIN LATERAL (SELECT * FROM public.coaches c2 WHERE c2.user_id = me.uid LIMIT 1) co ON true
  LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM accounts a WHERE public.has_role(a.user_id, 'admin') OR public.has_role(a.user_id, 'coach')) AS yes) staff ON true
$function$;
REVOKE ALL ON FUNCTION public.community_author(uuid) FROM PUBLIC, anon, authenticated;

-- The rankings and athlete-card functions each read the photo in one spot,
-- `<profiles alias>.avatar_url` (profiles joined on the athlete's login), so
-- that column is swapped for community_avatar(<alias>.id) in place, leaving
-- the rest of each (long) function exactly as it is. Stops if one doesn't
-- look as expected; a function already switched is left alone.
DO $$
DECLARE
  fn text;
  f oid;
  def text;
  nxt text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'get_athlete_public_profile', 'get_athlete_rankings', 'get_powerlifting_career',
    'get_strength_board', 'get_strength_board_all', 'get_strength_board_meets',
    'get_strength_board_roster', 'league_month_scores'
  ] LOOP
    FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn LOOP
      def := pg_get_functiondef(f);
      IF def !~ '\m(p|pr)\.avatar_url\M' THEN
        IF position('community_avatar(' IN def) = 0 THEN
          RAISE EXCEPTION '% reads no profile photo and no community photo: check it by hand', fn;
        END IF;
        CONTINUE;
      END IF;
      IF def !~* 'join public\.profiles (p|pr) on \1\.id = [a-z]+\.user_id' THEN
        RAISE EXCEPTION '% joins profiles some other way: check it by hand', fn;
      END IF;
      nxt := regexp_replace(def, 'group by c\.id, p\.avatar_url', 'group by c.id, public.community_avatar(p.id)', 'gi');
      nxt := regexp_replace(nxt, '\m(p|pr)\.avatar_url\M', 'public.community_avatar(\1.id) AS avatar_url', 'g');
      IF nxt ~ '\m(p|pr)\.avatar_url\M' THEN
        RAISE EXCEPTION '% still reads a profile photo', fn;
      END IF;
      EXECUTE nxt;
    END LOOP;
  END LOOP;
END $$;

-- Coach-run group chats: members see each other's community photos too (the
-- member-made ones already went through community_author).
CREATE OR REPLACE FUNCTION public.get_group_member_profiles(_group_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, role text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.chat_can_see(_group_id, auth.uid()) THEN RETURN; END IF;
  IF coalesce(public.chat_kind(_group_id), 'group') <> 'group' THEN
    RETURN QUERY
    SELECT gm.user_id, a->>'name', a->>'avatar_url', gm.role::text
      FROM public.chat_group_members gm, LATERAL public.community_author(gm.user_id) a
     WHERE gm.group_id = _group_id;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT gm.user_id,
         COALESCE(p.full_name, c.full_name, co.full_name, 'Member') AS full_name,
         public.community_avatar(gm.user_id) AS avatar_url,
         gm.role::text
    FROM public.chat_group_members gm
    LEFT JOIN public.profiles p ON p.id = gm.user_id
    LEFT JOIN public.clients c ON c.user_id = gm.user_id
    LEFT JOIN public.coaches co ON co.user_id = gm.user_id
   WHERE gm.group_id = _group_id;
END;
$function$;
