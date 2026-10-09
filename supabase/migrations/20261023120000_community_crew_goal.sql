-- The crew's weekly goal: one shared number of sessions (Mon-Sun, Winnipeg
-- time, like the rest of the community week). Every finished workout moves
-- it, from anyone, so the crew pulls together instead of only competing.
-- The bar is a little past the crew's last four weeks (x1.08, up to the next
-- 5, at least 10), so it stretches without being out of reach. Nothing is
-- stored: it's worked out from the workouts themselves. No pushes.

-- Active clients (the same roster the weekly recap counts).
CREATE OR REPLACE FUNCTION public.community_crew_roster()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(cl.id), '{}') FROM public.clients cl
   WHERE cl.user_id IS NOT NULL
     AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
     AND coalesce(cl.status, '') <> 'Archived'
     AND coalesce(cl.portal_access_disabled, false) = false
$function$;
REVOKE ALL ON FUNCTION public.community_crew_roster() FROM PUBLIC, anon, authenticated;

-- The target for the week starting _week (a Monday).
CREATE OR REPLACE FUNCTION public.community_crew_target(_week date, _roster uuid[])
RETURNS int
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT greatest(10, (ceil(coalesce(avg(w.n), 0) * 1.08 / 5) * 5)::int)
    FROM (SELECT g.i, count(pc.id) AS n
            FROM generate_series(1, 4) AS g(i)
            LEFT JOIN public.pl_day_completions pc
              ON pc.client_id = ANY (_roster)
             AND pc.completed_at >= ((_week - 7 * g.i)::timestamp AT TIME ZONE 'America/Winnipeg')
             AND pc.completed_at < ((_week - 7 * (g.i - 1))::timestamp AT TIME ZONE 'America/Winnipeg')
           GROUP BY g.i) w
$function$;
REVOKE ALL ON FUNCTION public.community_crew_target(date, uuid[]) FROM PUBLIC, anon, authenticated;

-- This week's goal for the viewer: target, done, who's trained (newest first,
-- no counts: nobody's ranked here), the viewer's own sessions, who closed it
-- out, and how last week went.
CREATE OR REPLACE FUNCTION public.community_crew_goal(_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_week date := date_trunc('week', coalesce(_at, now()) AT TIME ZONE tz)::date;
  v_from timestamptz := (v_week::timestamp AT TIME ZONE tz);
  v_to timestamptz := ((v_week + 7)::timestamp AT TIME ZONE tz);
  v_roster uuid[];
  v_target int;
  v_done int;
  v_hit record;
  v_prev_target int;
  v_prev_done int;
  v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  v_roster := public.community_crew_roster();
  v_target := public.community_crew_target(v_week, v_roster);
  SELECT count(*) INTO v_done FROM public.pl_day_completions pc
   WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to;
  -- the session that reached the target
  SELECT pc.completed_at, cl.user_id INTO v_hit
    FROM public.pl_day_completions pc JOIN public.clients cl ON cl.id = pc.client_id
   WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to
   ORDER BY pc.completed_at, pc.id
  OFFSET greatest(v_target - 1, 0) LIMIT 1;
  v_prev_target := public.community_crew_target(v_week - 7, v_roster);
  SELECT count(*) INTO v_prev_done FROM public.pl_day_completions pc
   WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from - interval '7 days' AND pc.completed_at < v_from;

  RETURN jsonb_build_object(
    'week_of', v_week,
    'ends_at', v_to,
    'target', v_target,
    'done', v_done,
    'hit_at', CASE WHEN v_done >= v_target THEN v_hit.completed_at END,
    'hit_by', CASE WHEN v_done >= v_target AND v_hit.user_id IS NOT NULL THEN public.community_author(v_hit.user_id) END,
    'people', (SELECT count(DISTINCT pc.client_id) FROM public.pl_day_completions pc
                WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to),
    'contributors', coalesce((SELECT jsonb_agg(public.community_author(x.user_id) ORDER BY x.last_at DESC)
                                FROM (SELECT cl.user_id, max(pc.completed_at) AS last_at
                                        FROM public.pl_day_completions pc JOIN public.clients cl ON cl.id = pc.client_id
                                       WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to
                                       GROUP BY cl.user_id) x), '[]'::jsonb),
    'mine', (SELECT count(*) FROM public.pl_day_completions pc JOIN public.clients cl ON cl.id = pc.client_id
              WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to
                AND public.community_main_account(cl.user_id) = v_me),
    'last_week', jsonb_build_object('target', v_prev_target, 'done', v_prev_done, 'hit', v_prev_done >= v_prev_target));
END;
$function$;
REVOKE ALL ON FUNCTION public.community_crew_goal(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_crew_goal(timestamptz) TO authenticated;
