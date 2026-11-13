-- Repost your own posts (Nov 13 2026).
--
-- The coach found no 🔁 under his own posts: people who post should be able
-- to repost their own content too. A repost of your own post (or a collab
-- you're on) puts it back in front of the crew the same way anyone's repost
-- does: it moves up to the repost in the feed, "You reposted" over it, and
-- it's on your profile's Reposts. Nothing else changes: the original's
-- audience still decides who can see it (a private account's crew posts are
-- 'followers', so those count too), a story, an automatic workout story, a
-- Close Friends, coach-only or private post never reposts, and nobody is
-- told about their own repost (community_notify skips the actor).

/** Why _viewer can't repost this post, or null when they can. */
CREATE OR REPLACE FUNCTION public.community_repost_refusal(_post_id uuid, _viewer uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p.id IS NULL OR p.archived_at IS NOT NULL THEN 'Post not found'
    WHEN coalesce(p.auto_shared, false) THEN 'Automatic workout stories can''t be reposted'
    WHEN p.story_only THEN 'Stories can''t be reposted'
    -- yours (or a collab you're on): anything you shared with the crew, a private account's 'followers' included
    WHEN p.author_user_id IN (_viewer, public.community_main_account(_viewer))
      OR public.community_main_account(_viewer) = ANY (public.community_post_collab_ids(p.id))
      THEN CASE WHEN p.visibility IN ('community', 'followers') THEN NULL
                ELSE 'Only posts shared with the crew can be reposted' END
    WHEN p.visibility <> 'community' THEN 'Only posts shared with the whole crew can be reposted'
  END
    FROM (SELECT 1) one
    LEFT JOIN public.community_posts p ON p.id = _post_id
$$;

REVOKE ALL ON FUNCTION public.community_repost_refusal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_repost_refusal(uuid, uuid) TO service_role;

-- A post's Activity lists who reposted it, never you: its 🔁 count leaves your own repost out too.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.community_post_activity(uuid)'::regprocedure);
  IF position('FROM rp WHERE public.community_main_account(rp.user_id) IS DISTINCT FROM v_me' in def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $r$'reposts', (SELECT count(*) FROM rp),$r$,
    $r$'reposts', (SELECT count(*) FROM rp WHERE public.community_main_account(rp.user_id) IS DISTINCT FROM v_me),$r$);
  IF position('FROM rp WHERE public.community_main_account(rp.user_id) IS DISTINCT FROM v_me' in def) = 0 THEN
    RAISE EXCEPTION 'community_post_activity: anchor not found';
  END IF;
  EXECUTE def;
END $$;
