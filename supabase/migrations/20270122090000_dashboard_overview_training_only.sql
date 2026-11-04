-- The coach's dashboard shows only today's training from this function now.
-- This week's records (Wins) live in Crew (props, Wednesday Wins), and the money,
-- leads and roster numbers were never shown; the Wins part alone walked every
-- coaching client's whole rep history (client_rep_records per client, ~600ms)
-- on every 60-second refresh while the dashboard was open.
CREATE OR REPLACE FUNCTION public.admin_dashboard_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
  v_tz text := public.league_tz();
  v_today date := (now() at time zone public.league_tz())::date;
  v_day_start timestamptz;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not (v_admin or public.has_role(v_uid, 'coach'::public.app_role)) then
    raise exception 'not allowed';
  end if;
  v_day_start := (v_today::timestamp at time zone v_tz);

  with roster as (
    select c.id, c.full_name, c.profile_picture_url
    from public.clients c
    where c.archived = false
      and c.service_tier = 'coaching'
      and coalesce(c.status, '') not in ('Archived', 'Deactivated')
      and (v_admin or public.is_assigned_coach(c.id))
  ),
  sched as (
    select sw.id, sw.client_id, sw.scheduled_time, coalesce(d.title, 'Workout') as title,
           dc.completed_at,
           case when dc.completed_at is null
                 and greatest(dc.in_progress_at, dc.started_at, dc.training_started_at) >= v_day_start
                then true else false end as in_progress
    from public.pl_scheduled_workouts sw
    join roster r on r.id = sw.client_id
    left join public.pl_days d on d.id = sw.source_day_id
    left join lateral (
      select x.completed_at, x.in_progress_at, x.started_at, x.training_started_at
      from public.pl_day_completions x
      where x.client_id = sw.client_id
        and (x.scheduled_workout_id = sw.id or (x.scheduled_workout_id is null and x.day_id = sw.source_day_id))
      order by x.completed_at desc nulls last
      limit 1
    ) dc on true
    where sw.scheduled_date = v_today
  ),
  extra as (
    select distinct on (x.client_id) x.client_id, x.completed_at, coalesce(d.title, 'Workout') as title
    from public.pl_day_completions x
    join roster r on r.id = x.client_id
    left join public.pl_days d on d.id = x.day_id
    where x.completed_at >= v_day_start
      and not exists (select 1 from sched s where s.client_id = x.client_id)
    order by x.client_id, x.completed_at desc
  )
  select jsonb_build_object(
    'today', v_today,
    'is_admin', v_admin,
    'training', jsonb_build_object(
      'scheduled', coalesce((
        select jsonb_agg(jsonb_build_object(
          'client_id', s.client_id, 'name', r.full_name, 'avatar', r.profile_picture_url,
          'title', s.title, 'time', s.scheduled_time,
          'status', case when s.completed_at is not null then 'done' when s.in_progress then 'training' else 'pending' end,
          'completed_at', s.completed_at)
          order by (s.completed_at is not null), s.scheduled_time nulls last, r.full_name)
        from sched s join roster r on r.id = s.client_id), '[]'::jsonb),
      'unscheduled', coalesce((
        select jsonb_agg(jsonb_build_object(
          'client_id', e.client_id, 'name', r.full_name, 'avatar', r.profile_picture_url,
          'title', e.title, 'completed_at', e.completed_at) order by e.completed_at desc)
        from extra e join roster r on r.id = e.client_id), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end
$function$;

REVOKE ALL ON FUNCTION public.admin_dashboard_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_overview() TO authenticated, service_role;
