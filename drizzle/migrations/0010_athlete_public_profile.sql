CREATE OR REPLACE FUNCTION public.get_athlete_public_profile(_client_id uuid)
RETURNS TABLE (client_id uuid, display_name text, avatar_url text, xp bigint, workouts_completed bigint, workouts_fully_logged bigint, first_workout_at timestamptz, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id,
    COALESCE(NULLIF(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)),
    p.avatar_url,
    COALESCE(sum(e.xp),0)::bigint,
    count(*) FILTER (WHERE e.event_type = 'workout_completed'),
    count(*) FILTER (WHERE e.event_type = 'workout_fully_logged'),
    min(e.occurred_at) FILTER (WHERE e.event_type = 'workout_completed'),
    (c.user_id = auth.uid())
  FROM public.clients c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  LEFT JOIN public.athlete_xp_events e ON e.client_id = c.id
  WHERE auth.uid() IS NOT NULL AND c.id = _client_id
    AND (c.user_id = auth.uid() OR (COALESCE(c.archived,false) = false AND c.archived_at IS NULL AND COALESCE(c.status,'') <> 'Archived'))
  GROUP BY c.id, p.avatar_url;
$$;
REVOKE EXECUTE ON FUNCTION public.get_athlete_public_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_athlete_public_profile(uuid) TO authenticated;