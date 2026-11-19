-- Who liked a post: one rule for the "Liked by" line and the Likes list (Nov 19 2026).
--
-- The Likes list (community_post_reactors, 20270414090000_post_likes_list.sql)
-- left out anyone blocked either way, deleted or deactivated, and put you,
-- then people you follow, first. The "Liked by Marc and 12 others" line under
-- a post is built per post inside community_post_json, which still took any
-- three likers, coaches first: a deactivated account's like (one has 3 on
-- older posts) could name someone the list leaves out, and the line rarely
-- named someone you follow, Instagram's way.
--
-- community_post_likers is that rule, once: the post's likers the viewer may
-- see (no block either way, a coach always; no deactivated or deleted
-- account) with whether each is you and whether you follow them. It's plain
-- SQL with no SET clause, so it's inlined into both callers and costs index
-- lookups per liker, never a whole set per post (community_blocked_authors()
-- would add ~3 ms to every post in the feed). Both callers order by you,
-- then people you follow, then newest.

CREATE OR REPLACE FUNCTION public.community_post_likers(_post_id uuid, _viewer_main uuid)
RETURNS TABLE (user_id uuid, main uuid, emoji text, at timestamptz, me boolean, followed boolean)
LANGUAGE sql
STABLE
AS $$
  SELECT r.user_id, m.main, r.emoji, r.created_at,
         m.main = _viewer_main,
         EXISTS (SELECT 1 FROM public.community_follows f
                  WHERE f.follower_id = _viewer_main AND f.followee_id = m.main)
    FROM public.community_reactions r
    CROSS JOIN LATERAL (
      SELECT coalesce((SELECT cp.same_person_as FROM public.community_profiles cp WHERE cp.user_id = r.user_id), r.user_id) AS main
    ) m
   WHERE r.post_id = _post_id
     AND (m.main = _viewer_main OR (
           NOT EXISTS (SELECT 1 FROM public.clients c
                        WHERE c.user_id IN (r.user_id, m.main) AND c.status = 'Deactivated')
       AND NOT EXISTS (SELECT 1 FROM public.account_deletions d
                        WHERE d.user_id IN (r.user_id, m.main) AND d.status IN ('pending', 'deleted'))
       AND CASE WHEN EXISTS (SELECT 1 FROM public.chat_user_blocks b
                              WHERE (b.user_id = _viewer_main AND b.blocked_user_id IN (r.user_id, m.main))
                                 OR (b.blocked_user_id = _viewer_main AND b.user_id IN (r.user_id, m.main)))
                -- a coach is never hidden from the crew (community_blocked_authors)
                THEN public.community_is_coach(m.main)
                ELSE true END))
$$;
REVOKE ALL ON FUNCTION public.community_post_likers(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The Likes list
CREATE OR REPLACE FUNCTION public.community_post_reactors(_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(l.user_id),
             'is_me', l.me,
             'emoji', l.emoji,
             'created_at', l.at)
           ORDER BY l.me DESC, l.followed DESC, l.at DESC)
      FROM public.community_post_likers(_post_id, public.community_main_account(uid)) l), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_reactors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_reactors(uuid) TO authenticated;

-- The "Liked by" line's three faces, inside community_post_json
CREATE OR REPLACE FUNCTION pg_temp.patch_fn(_sig text, _pairs text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d text := pg_get_functiondef(_sig::regprocedure);
  i int;
BEGIN
  FOR i IN 1 .. array_length(_pairs, 1) / 2 LOOP
    IF position(_pairs[2 * i] IN d) > 0 THEN
      CONTINUE; -- already applied
    END IF;
    IF position(_pairs[2 * i - 1] IN d) = 0 THEN
      RAISE EXCEPTION '% : fragment % not found', _sig, i;
    END IF;
    d := replace(d, _pairs[2 * i - 1], _pairs[2 * i]);
  END LOOP;
  EXECUTE d;
END $$;

-- and the counts by the heart (per kind and in all), so "and 12 others" is
-- 12 people the list shows (Instagram hides a deactivated account's likes too;
-- League points, post scores and the feed's ranking read the table, unchanged)
SELECT pg_temp.patch_fn('public.community_post_json(uuid, uuid)', ARRAY[
$old$    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),$old$,
$new$    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT l.emoji, count(*) c FROM public.community_post_likers(n.id, public.community_main_account(_viewer)) l
                                    GROUP BY l.emoji) x), '{}'::jsonb),$new$,
$old$    'reaction_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = n.id),$old$,
$new$    'reaction_count', (SELECT count(*) FROM public.community_post_likers(n.id, public.community_main_account(_viewer)) l),$new$,
$old$    'reactors', coalesce((SELECT jsonb_agg(x.j ORDER BY x.coach DESC, x.at DESC)
                            FROM (SELECT public.community_author(r.user_id)
                                         || jsonb_build_object('is_me', public.community_main_account(r.user_id) = public.community_main_account(_viewer)) AS j,
                                         public.community_is_coach(r.user_id) AS coach, r.created_at AS at
                                    FROM public.community_reactions r WHERE r.post_id = n.id
                                   ORDER BY public.community_is_coach(r.user_id) DESC, r.created_at DESC LIMIT 3) x), '[]'::jsonb),$old$,
$new$    'reactors', coalesce((SELECT jsonb_agg(public.community_author(t.user_id) || jsonb_build_object('is_me', t.me)
                                       ORDER BY t.me DESC, t.followed DESC, t.at DESC)
                            FROM (SELECT l.user_id, l.me, l.followed, l.at
                                    FROM public.community_post_likers(n.id, public.community_main_account(_viewer)) l
                                   ORDER BY l.me DESC, l.followed DESC, l.at DESC LIMIT 3) t), '[]'::jsonb),$new$
]);
