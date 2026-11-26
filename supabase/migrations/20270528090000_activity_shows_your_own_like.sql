-- A post's Activity shows your own like (Nov 25 2026).
--
-- The poster's Activity (community_post_activity) left the poster out
-- entirely, which is right for views (your own are never recorded) and
-- reposts (yours never count), but it also dropped your own like: the post
-- said "Likes 4" and "Liked by you", while the Likes tab listed three people.
-- Now the poster is in the list exactly when they reacted, marked is_me, and
-- every row is one person (a linked staff login's view, share or repost counts
-- as its person, whose profile a tap opens), so the tab's count and its list
-- always agree.

CREATE OR REPLACE FUNCTION public.community_post_activity(_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_me uuid;
  v_out jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_me := public.community_main_account(uid);
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.author_user_id = v_me) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  WITH v AS (
    SELECT public.community_main_account(v.viewer_user_id) AS user_id, max(v.viewed_at) AS viewed_at
      FROM public.community_post_views v
     WHERE v.post_id = _post_id AND NOT v.anonymous
     GROUP BY 1
  ), r AS (
    SELECT DISTINCT ON (x.user_id) x.user_id, x.emoji, x.created_at
      FROM (SELECT public.community_main_account(r.user_id) AS user_id, r.emoji, r.created_at
              FROM public.community_reactions r WHERE r.post_id = _post_id) x
     ORDER BY x.user_id, x.created_at DESC
  ), s AS (
    SELECT DISTINCT ON (x.user_id) x.user_id, x.created_at, x.id
      FROM (SELECT public.community_main_account(sp.author_user_id) AS user_id, sp.created_at, sp.id
              FROM public.community_posts sp
             WHERE sp.shared_post_id = _post_id AND sp.archived_at IS NULL
               AND public.community_post_visible(sp.visibility, sp.author_user_id, sp.client_id)) x
     ORDER BY x.user_id, x.created_at DESC
  ), rp AS (
    SELECT DISTINCT ON (x.user_id) x.user_id, x.created_at
      FROM (SELECT public.community_main_account(rp.user_id) AS user_id, rp.created_at
              FROM public.community_reposts rp WHERE rp.post_id = _post_id) x
     ORDER BY x.user_id, x.created_at DESC
  ), people AS (
    -- everyone else who did anything, and you only for your own like
    SELECT u.user_id FROM (SELECT user_id FROM v UNION SELECT user_id FROM r UNION SELECT user_id FROM s UNION SELECT user_id FROM rp) u
     WHERE u.user_id IS DISTINCT FROM v_me
    UNION
    SELECT r.user_id FROM r WHERE r.user_id = v_me
  ), ranked AS (
    SELECT public.community_author(pe.user_id)
             || jsonb_strip_nulls(jsonb_build_object(
                  'viewed_at', CASE WHEN pe.user_id = v_me THEN NULL ELSE v.viewed_at END,
                  'reaction', r.emoji, 'reacted_at', r.created_at,
                  'shared_at', CASE WHEN pe.user_id = v_me THEN NULL ELSE s.created_at END,
                  'share_id', CASE WHEN pe.user_id = v_me THEN NULL ELSE s.id END,
                  'reposted_at', CASE WHEN pe.user_id = v_me THEN NULL ELSE rp.created_at END,
                  'is_me', CASE WHEN pe.user_id = v_me THEN true END)) AS j,
           CASE WHEN pe.user_id = v_me THEN r.created_at ELSE greatest(r.created_at, s.created_at, rp.created_at) END AS interacted,
           v.viewed_at AS seen
      FROM people pe
      LEFT JOIN v ON v.user_id = pe.user_id
      LEFT JOIN r ON r.user_id = pe.user_id
      LEFT JOIN s ON s.user_id = pe.user_id
      LEFT JOIN rp ON rp.user_id = pe.user_id
     ORDER BY 2 DESC NULLS LAST, 3 DESC NULLS LAST
     LIMIT 500
  )
  SELECT jsonb_build_object(
           'views', (SELECT count(*) FROM public.community_post_views x WHERE x.post_id = _post_id),
           'likes', (SELECT count(*) FROM r),
           'shares', (SELECT count(*) FROM public.community_posts x WHERE x.shared_post_id = _post_id AND x.archived_at IS NULL),
           'reposts', (SELECT count(*) FROM rp WHERE rp.user_id IS DISTINCT FROM v_me),
           'people', coalesce((SELECT jsonb_agg(ranked.j ORDER BY ranked.interacted DESC NULLS LAST, ranked.seen DESC NULLS LAST) FROM ranked), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.community_post_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_activity(uuid) TO authenticated, service_role;
