-- Tagged people read as their @username, Instagram's way.
--
-- 1. Every person card (community_author: post authors, collaborators, the
--    people a caption tags, reactors, the @ picker's list) carries the
--    person's username. It's read from the community_profiles row the
--    function already joins, so it costs nothing extra. The app shows a tag
--    as "@username" whatever the caption typed ("Marc", "@Marc").
-- 2. A caption tags "@username" as well as "@Name" (the @ picker now puts in
--    the username), as a whole tag wherever it is ("@fred" is never the start
--    of "@fred.lifts"). Usernames are unique, so no name clash to skip; "."
--    can't end one, so "@marc." is @marc and a full stop.

CREATE OR REPLACE FUNCTION public.community_author(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'avatar_url', coalesce(cp.avatar_path, CASE WHEN staff.yes OR cp.title IS NOT NULL THEN coachpic.pic END),
    'username', cp.username)
  FROM me
  LEFT JOIN public.community_profiles cp ON cp.user_id = me.uid
  LEFT JOIN public.profiles p ON p.id = me.uid
  LEFT JOIN LATERAL (SELECT * FROM public.clients c1 WHERE c1.user_id = me.uid LIMIT 1) c ON true
  LEFT JOIN LATERAL (SELECT * FROM public.coaches c2 WHERE c2.user_id = me.uid LIMIT 1) co ON true
  LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM accounts a WHERE public.has_role(a.user_id, 'admin') OR public.has_role(a.user_id, 'coach')) AS yes) staff ON true
  LEFT JOIN LATERAL (SELECT c3.profile_picture_url AS pic FROM public.coaches c3 JOIN accounts a ON a.user_id = c3.user_id
                      WHERE nullif(btrim(c3.profile_picture_url), '') IS NOT NULL LIMIT 1) coachpic ON true
$$;

-- Who a caption names: "@Name", "@username" (or, for app-written recaps, the
-- bare name) as a whole word. Names two people share are skipped (no
-- guessing), the author isn't their own mention, "@Alyssa Amanda" beats
-- someone called "Alyssa", and "@marc" is the person whose username it is.
CREATE OR REPLACE FUNCTION public.community_caption_mentions(_caption text, _author uuid, _plain boolean DEFAULT false)
RETURNS TABLE (user_id uuid, text text, pos int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH all_dir AS (SELECT d.user_id, btrim(d.name) AS name FROM public.community_member_directory() d WHERE nullif(btrim(d.name), '') IS NOT NULL),
  dir AS (
    SELECT a.user_id, a.name FROM all_dir a
     WHERE lower(a.name) IN (SELECT lower(a2.name) FROM all_dir a2 GROUP BY 1 HAVING count(*) = 1)
       AND a.user_id <> public.community_main_account(_author)
  ),
  handles AS (
    SELECT cp.user_id, cp.username AS name FROM public.community_profiles cp
     WHERE NOT _plain AND cp.username IS NOT NULL
       AND cp.user_id IN (SELECT a.user_id FROM all_dir a)
       AND cp.user_id <> public.community_main_account(_author)
  ),
  cap AS (SELECT lower(coalesce(_caption, '')) AS c),
  hits AS (
    SELECT dir.user_id, CASE WHEN _plain THEN dir.name ELSE '@' || dir.name END AS text, x.pos, length(dir.name) AS len, 0 AS rank
      FROM dir, cap
     CROSS JOIN LATERAL (SELECT strpos(cap.c, CASE WHEN _plain THEN '' ELSE '@' END || lower(dir.name)) AS pos) x
     WHERE x.pos > 0
       AND substr(cap.c, x.pos + length(dir.name) + CASE WHEN _plain THEN 0 ELSE 1 END, 1) !~ '[[:alnum:]_]'
       AND (NOT _plain OR x.pos = 1 OR substr(cap.c, x.pos - 1, 1) !~ '[[:alnum:]_@]')
    UNION ALL
    -- the whole tag, wherever it is: "@fred" is never the start of "@fred.lifts"
    SELECT h.user_id, '@' || h.name AS text, x.pos, length(h.name) AS len, 1 AS rank
      FROM handles h, cap
     CROSS JOIN LATERAL (SELECT regexp_instr(cap.c, '@' || replace(lower(h.name), '.', '[.]') || '(?![a-z0-9_]|[.][a-z0-9_])') AS pos) x
     WHERE x.pos > 0
  )
  -- the longest wins at a spot; a tie goes to the username (what "@" means on Instagram)
  SELECT h.user_id, h.text, h.pos FROM hits h
   WHERE NOT EXISTS (SELECT 1 FROM hits h2 WHERE h2.pos = h.pos AND (h2.len > h.len OR (h2.len = h.len AND h2.rank > h.rank)))
$$;
REVOKE ALL ON FUNCTION public.community_caption_mentions(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
