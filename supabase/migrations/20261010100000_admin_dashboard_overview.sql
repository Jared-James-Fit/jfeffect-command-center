-- Admin dashboard overview: the things the Clients and Messages pages don't show.
--   today   : who is scheduled to train today and whether they've done it (plus anyone
--             who trained without a scheduled session)
--   wins    : records set in the last 7 days (all-time / program / block PRs)
--   money   : paid revenue this month vs the same point last month (admins only)
--   leads   : new coaching applications (admins only)
--   roster  : active clients, new this month
-- Read-only. Coaches only see their assigned clients and never see money or leads.

create or replace function public.admin_dashboard_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
  v_tz text := public.league_tz();
  v_today date := (now() at time zone public.league_tz())::date;
  v_day_start timestamptz;
  v_month_start date;
  v_prev_month_start date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not (v_admin or public.has_role(v_uid, 'coach'::public.app_role)) then
    raise exception 'not allowed';
  end if;
  v_day_start := (v_today::timestamp at time zone v_tz);
  v_month_start := date_trunc('month', v_today)::date;
  v_prev_month_start := (date_trunc('month', v_today) - interval '1 month')::date;

  with roster as (
    select c.id, c.full_name, c.profile_picture_url, c.created_at,
           coalesce(c.preferred_weight_unit, 'lb') as unit
    from public.clients c
    where c.archived = false
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
  ),
  rec as (
    select r.id as client_id, rr.exercise_name, rr.reps, rr.load_kg, rr.workout_at,
           case when rr.is_atpr then 'atpr' when rr.is_program_pr then 'program' else 'block' end as tier,
           case when rr.is_atpr then 3 when rr.is_program_pr then 2 else 1 end as tier_rank
    from roster r
    cross join lateral public.client_rep_records(r.id) rr
    where rr.completed
      and rr.workout_at >= now() - interval '7 days'
      and (rr.is_atpr or rr.is_program_pr or rr.is_block_pr)
  ),
  wins as (
    select distinct on (client_id, exercise_name) *
    from rec
    order by client_id, exercise_name, tier_rank desc, load_kg desc nulls last, workout_at desc
  ),
  money as (
    select t.currency,
      coalesce(sum(t.amount) filter (where t.occurred_on >= v_month_start), 0) as this_month,
      coalesce(sum(t.amount) filter (where t.occurred_on >= v_prev_month_start and t.occurred_on < v_month_start
                                       and extract(day from t.occurred_on) <= extract(day from v_today)), 0) as last_month_to_date,
      coalesce(sum(t.amount) filter (where t.occurred_on >= v_prev_month_start and t.occurred_on < v_month_start), 0) as last_month,
      count(*) filter (where t.occurred_on >= v_month_start) as payments
    from public.admin_transactions_v1 t
    where v_admin
      and t.txn_type = 'payment' and t.status = 'Paid'
      and not coalesce(t.voided, false)
      and coalesce(t.stripe_mode, 'live') = 'live'
      and t.occurred_on >= v_prev_month_start
    group by t.currency
  ),
  apps as (
    select a.id, a.full_name, a.submitted_at, a.lead_temperature, a.application_status
    from public.coaching_applications a
    where v_admin and not coalesce(a.is_test, false) and a.submitted_at >= now() - interval '30 days'
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
    ),
    'wins', coalesce((
      select jsonb_agg(w order by (w->>'at') desc)
      from (
        select jsonb_build_object(
          'client_id', wi.client_id, 'name', r.full_name, 'avatar', r.profile_picture_url,
          'exercise', wi.exercise_name, 'reps', wi.reps, 'load_kg', wi.load_kg, 'unit', r.unit,
          'tier', wi.tier, 'at', wi.workout_at) as w
        from wins wi join roster r on r.id = wi.client_id
        order by wi.workout_at desc
        limit 12
      ) x), '[]'::jsonb),
    'money', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', m.currency, 'this_month', m.this_month, 'last_month_to_date', m.last_month_to_date,
        'last_month', m.last_month, 'payments', m.payments) order by m.this_month desc)
      from money m), '[]'::jsonb) else null end,
    'leads', case when v_admin then jsonb_build_object(
      'new_7d', (select count(*) from apps where submitted_at >= now() - interval '7 days'),
      'new_30d', (select count(*) from apps),
      'latest', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'name', a.full_name, 'submitted_at', a.submitted_at,
          'temperature', a.lead_temperature, 'status', a.application_status) order by a.submitted_at desc)
        from (select * from apps order by submitted_at desc limit 3) a), '[]'::jsonb)
    ) else null end,
    'roster', jsonb_build_object(
      'active', (select count(*) from roster),
      'new_this_month', (select count(*) from roster where created_at >= v_month_start)
    )
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.admin_dashboard_overview() from public, anon;
grant execute on function public.admin_dashboard_overview() to authenticated, service_role;
