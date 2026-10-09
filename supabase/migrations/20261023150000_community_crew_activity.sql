-- The Crew list shows training, not posting: posts are rare (a handful a
-- week), training isn't (dozens of sessions), so "No posts yet" on nearly
-- everyone made a busy crew look empty. Each member now carries when they
-- last trained (only within the last 7 days, so a quiet stretch is never
-- shown), which days they trained this week (Mon-Sun, Winnipeg time, like
-- the rest of the community week), and when they started (the profile
-- already shows it). Ordered: training now, coaches, most recently trained,
-- then by name. Rebuilt from the live definition; the rest is unchanged.
CREATE OR REPLACE FUNCTION public.community_members()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  tz constant text := 'America/Winnipeg';
  v_week timestamptz := (date_trunc('week', now() AT TIME ZONE tz)::timestamp AT TIME ZONE tz);
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(m.user_id),
             'bio', cp.bio,
             'posts', s.posts,
             'last_post_at', s.last_at,
             'live', s.live,
             'trained_at', t.trained_at,
             'week_days', t.week_days,
             'training_since', t.since)
           ORDER BY s.live DESC, (public.community_author(m.user_id)->>'is_coach')::boolean DESC, t.trained_at DESC NULLS LAST,
                    lower(coalesce(public.community_author(m.user_id)->>'name', '')))
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
          LEFT JOIN public.pl_day_completions pc ON pc.id = p.completion_id
         WHERE p.author_user_id = m.user_id
           AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
      ) s
      CROSS JOIN LATERAL (
        SELECT max(pc.completed_at) FILTER (WHERE pc.completed_at > now() - interval '7 days') AS trained_at,
               coalesce(array_agg(DISTINCT extract(isodow FROM pc.completed_at AT TIME ZONE tz)::int)
                          FILTER (WHERE pc.completed_at >= v_week), '{}') AS week_days,
               min(pc.completed_at) AS since
          FROM public.pl_day_completions pc
          JOIN public.clients c ON c.id = pc.client_id
         WHERE c.user_id = m.user_id AND pc.completed_at IS NOT NULL
      ) t
     WHERE m.user_id <> uid
       AND NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)
       AND m.user_id <> coalesce((SELECT l2.same_person_as FROM public.community_profiles l2 WHERE l2.user_id = uid), uid)
  ), '[]'::jsonb);
END;
$function$;
