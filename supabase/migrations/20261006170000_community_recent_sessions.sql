-- "Share a workout" picker: the signed-in athlete's own finished sessions from
-- the last 30 days, newest first, with the post already made for each (if
-- any) so the picker can say "Posted" and reopening edits instead of
-- duplicating. Read-only; scoped to auth.uid() (coach "View as client" sees
-- nothing, matching community_save_post which refuses anyone but the athlete).
CREATE OR REPLACE FUNCTION public.community_recent_completions(_limit int DEFAULT 8)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(s.x ORDER BY s.at DESC), '[]'::jsonb)
  FROM (
    SELECT pc.completed_at AS at,
           jsonb_build_object(
             'completion_id', pc.id,
             'completed_at', pc.completed_at,
             'title', coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout'),
             'duration_min', nullif(pc.actual_duration_min, 0),
             'post_id', p.id,
             'visibility', p.visibility,
             'athlete_name', coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''),
                                      nullif(split_part(btrim(coalesce(c.full_name, '')), ' ', 1), ''))) AS x
      FROM public.pl_day_completions pc
      JOIN public.clients c ON c.id = pc.client_id
      LEFT JOIN public.pl_days d ON d.id = pc.day_id
      LEFT JOIN public.community_posts p ON p.completion_id = pc.id
     WHERE auth.uid() IS NOT NULL
       AND c.user_id = auth.uid()
       AND pc.completed_at IS NOT NULL
       AND pc.completed_at > now() - interval '30 days'
     ORDER BY pc.completed_at DESC
     LIMIT least(greatest(coalesce(_limit, 8), 1), 20)
  ) s
$$;
REVOKE ALL ON FUNCTION public.community_recent_completions(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_recent_completions(int) TO authenticated;
