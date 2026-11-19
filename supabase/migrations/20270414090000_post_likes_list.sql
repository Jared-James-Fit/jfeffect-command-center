-- Who liked a post, Instagram's way (Nov 19 2026).
--
-- The coach asked for crew posts to show who liked them, like Instagram.
-- The list was already there for anyone who can see the post
-- (community_post_reactors), but on the paged feed (where nearly everyone
-- reads Crew) nothing opened it: the number under the heart was part of the
-- like button. The app now opens it from that number, from "Liked by …"
-- under a post's buttons, and from the same line under a post's words in its
-- sheet (reactors-sheet.tsx).
--
-- Here: the list Instagram shows. Nobody the viewer has blocked or been
-- blocked by, and no deleted or deactivated account
-- (community_blocked_authors, the same set the feed hides), and in
-- Instagram's order: you first, then people you follow, then everyone else,
-- newest first. Who can see it is unchanged: whoever can see the post.

CREATE OR REPLACE FUNCTION public.community_post_reactors(_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  me  uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  me := public.community_main_account(uid);
  RETURN coalesce((
    WITH blocked AS MATERIALIZED (SELECT b AS id FROM public.community_blocked_authors() b WHERE b IS NOT NULL),
         followed AS MATERIALIZED (SELECT f AS id FROM public.community_followed_authors() f WHERE f IS NOT NULL),
         likes AS (
           SELECT r.user_id, r.emoji, r.created_at,
                  coalesce(public.community_main_account(r.user_id), r.user_id) AS main
             FROM public.community_reactions r
            WHERE r.post_id = _post_id)
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(l.user_id),
             'is_me', l.main = me,
             'emoji', l.emoji,
             'created_at', l.created_at)
           ORDER BY (l.main = me) DESC,
                    (l.main IN (SELECT id FROM followed) OR l.user_id IN (SELECT id FROM followed)) DESC,
                    l.created_at DESC)
      FROM likes l
     WHERE l.user_id NOT IN (SELECT id FROM blocked)
       AND l.main NOT IN (SELECT id FROM blocked)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_post_reactors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_reactors(uuid) TO authenticated;
