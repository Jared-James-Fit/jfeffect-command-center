-- The crew: everyone in the community, so people can find each other's
-- profiles even before they've posted. Same population as
-- can_view_community() (active, non-archived clients with portal access,
-- plus coaching staff), shown the same way posts show authors: first name,
-- their own community photo, bio. Post counts and "last shared" only count
-- posts the viewer is allowed to see. No follower counts, no rankings.
CREATE OR REPLACE FUNCTION public.community_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(m.user_id),
             'bio', cp.bio,
             'posts', s.posts,
             'last_post_at', s.last_at,
             'live', s.live)
           ORDER BY m.is_staff DESC, s.last_at DESC NULLS LAST, lower(coalesce(public.community_author(m.user_id)->>'name', '')))
      FROM (
        SELECT DISTINCT ON (x.user_id) x.user_id, x.is_staff FROM (
          SELECT c.user_id, false AS is_staff FROM public.clients c
           WHERE c.user_id IS NOT NULL
             AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
             AND coalesce(c.status, '') <> 'Archived'
             AND coalesce(c.portal_access_disabled, false) = false
          UNION ALL
          SELECT ur.user_id, true FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach')
        ) x ORDER BY x.user_id, x.is_staff DESC
      ) m
      LEFT JOIN public.community_profiles cp ON cp.user_id = m.user_id
      CROSS JOIN LATERAL (
        SELECT count(*) AS posts, max(p.created_at) AS last_at,
               coalesce(bool_or(p.locked_in_at > now() - interval '3 hours' AND pc.completed_at IS NULL), false) AS live
          FROM public.community_posts p
          JOIN public.pl_day_completions pc ON pc.id = p.completion_id
         WHERE p.author_user_id = m.user_id
           AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
      ) s
     WHERE m.user_id <> uid
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_members() TO authenticated;
