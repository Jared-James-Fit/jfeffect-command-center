-- Coach / admin "View as client" (client POV): features that resolve "me"
-- from auth.uid() showed the COACH's (empty) data, so things like the
-- monthly League Recap vanished in POV. These functions now take an optional
-- _as_user; it is honoured only for admins and the client's assigned coach.
-- Everyone else (and a null _as_user) keeps auth.uid() exactly as before.

create or replace function public.portal_viewer_uid(_as_user uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when _as_user is null or _as_user = auth.uid() then auth.uid()
    when public.has_role(auth.uid(), 'admin'::public.app_role) then _as_user
    when exists (
      select 1 from public.clients c
       where c.user_id = _as_user and public.is_assigned_coach(c.id)
    ) then _as_user
    else auth.uid()
  end
$$;

revoke all on function public.portal_viewer_uid(uuid) from public, anon;
grant execute on function public.portal_viewer_uid(uuid) to authenticated, service_role;

-- League recap -------------------------------------------------------------
drop function if exists public.get_league_month_recap(date);
create or replace function public.get_league_month_recap(_month date default null, _as_user uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with viewer as (select public.portal_viewer_uid(_as_user) uid),
target as (
  select coalesce(_month,
    (date_trunc('month', (now() at time zone public.league_tz())::date) - interval '1 month')::date) m
),
s as (select x.* from target t cross join lateral public.league_month_scores(t.m, now()) x),
me as (select s.* from s, viewer v where s.user_id = v.uid limit 1),
board as (select * from s where s.qualified),
prev as (
  select p.rank, p.total_points, p.qualified
  from target t cross join lateral public.league_month_scores((t.m - interval '1 month')::date, now()) p, viewer v
  where p.user_id = v.uid limit 1
),
rivals as (
  select b.*, row_number() over (order by abs(b.total_points - me.total_points), abs(coalesce(b.rank, 999) - coalesce(me.rank, 999)), b.rank) rn
  from board b cross join me
  where b.client_id <> me.client_id
),
stats as (
  select count(*)::int athletes,
    round(avg(total_points))::int avg_points,
    max(total_points)::int top_points,
    sum(workouts_completed)::int total_workouts,
    sum(atpr_lifts)::int total_atprs
  from board
)
select case
  when not exists (select 1 from me) then null
  when (select not qualified and base_total = 0 and total_points = 0 from me) then null
  else jsonb_build_object(
    'month_start', (select m from target),
    'me', (select jsonb_build_object(
      'display_name', me.display_name, 'avatar_url', me.avatar_url,
      'qualified', me.qualified, 'rank', me.rank, 'total_points', me.total_points,
      'workout_points', me.workout_points, 'logging_points', me.logging_points,
      'bodyweight_points', me.bodyweight_points, 'improvement_points', me.improvement_points,
      'match_points', me.match_points,
      'workouts_completed', me.workouts_completed, 'fully_logged', me.fully_logged,
      'bodyweight_logs', me.bodyweight_logs, 'improved_exercises', me.improved_exercises,
      'atpr_lifts', me.atpr_lifts, 'program_pr_lifts', me.program_pr_lifts, 'block_pr_lifts', me.block_pr_lifts,
      'adherence_pct', me.adherence_pct, 'boost_qualified', me.boost_qualified,
      'beat_pct', case when (select athletes from stats) > 1 and me.rank is not null
        then round(100.0 * ((select athletes from stats) - me.rank) / ((select athletes from stats) - 1))::int end
    ) from me),
    'previous', (select jsonb_build_object('rank', prev.rank, 'total_points', prev.total_points, 'qualified', prev.qualified) from prev),
    'league', (select to_jsonb(stats) from stats),
    'podium', coalesce((select jsonb_agg(jsonb_build_object(
        'display_name', b.display_name, 'avatar_url', b.avatar_url, 'rank', b.rank, 'total_points', b.total_points,
        'is_me', b.user_id = (select uid from viewer), 'atpr_lifts', b.atpr_lifts) order by b.rank)
      from board b where b.rank <= 3), '[]'::jsonb),
    'rivals', coalesce((select jsonb_agg(jsonb_build_object(
        'display_name', r.display_name, 'avatar_url', r.avatar_url, 'rank', r.rank, 'total_points', r.total_points,
        'gap', r.total_points - (select total_points from me),
        'workouts_completed', r.workouts_completed, 'atpr_lifts', r.atpr_lifts,
        'program_pr_lifts', r.program_pr_lifts, 'improved_exercises', r.improved_exercises) order by r.rn)
      from rivals r where r.rn <= 3), '[]'::jsonb)
  )
end
$function$;

revoke all on function public.get_league_month_recap(date, uuid) from public, anon;
grant execute on function public.get_league_month_recap(date, uuid) to authenticated, service_role;

-- Performance league (leaderboard + "your status"/boost details) -------------
drop function if exists public.get_performance_league(date);
create or replace function public.get_performance_league(_month date default null, _as_user uuid default null)
returns table(client_id uuid, display_name text, avatar_url text, rank integer, is_me boolean, qualified boolean, bodyweight_value numeric, bodyweight_unit text, total_points integer, workout_points integer, logging_points integer, bodyweight_points integer, improvement_points integer, match_points integer, workouts_completed integer, fully_logged integer, boost_status text, needed_workouts integer, projected_total integer, eligible_workouts integer, completed_eligible integer, adherence_pct numeric, open_workouts integer, match_target integer, projected_match integer, month_start date, final_week_start date, is_final_week boolean, month_closed boolean, finalized boolean, atpr_lifts integer, program_pr_lifts integer, block_pr_lifts integer, last_record_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid)
  select s.client_id, s.display_name, s.avatar_url, s.rank, (s.user_id = v.uid), s.qualified,
    s.bodyweight_value, s.bodyweight_unit,
    s.total_points, s.workout_points, s.logging_points, s.bodyweight_points, s.improvement_points, s.match_points,
    s.workouts_completed, s.fully_logged,
    s.boost_status, s.needed_workouts, s.projected_total,
    case when s.user_id = v.uid then s.eligible_workouts end,
    case when s.user_id = v.uid then s.completed_eligible end,
    case when s.user_id = v.uid then s.adherence_pct end,
    case when s.user_id = v.uid then s.open_workouts end,
    case when s.user_id = v.uid then s.match_target end,
    case when s.user_id = v.uid then s.projected_match end,
    s.month_start, s.final_week_start, s.is_final_week, s.month_closed, s.finalized,
    s.atpr_lifts, s.program_pr_lifts, s.block_pr_lifts, s.last_record_at
  from public.league_month_scores(_month, now()) s, viewer v
  where v.uid is not null
    and ((s.qualified and s.rank <= 50) or s.user_id = v.uid)
  order by s.qualified desc, s.rank nulls last, s.display_name
$function$;

revoke all on function public.get_performance_league(date, uuid) from public, anon;
grant execute on function public.get_performance_league(date, uuid) to authenticated, service_role;

-- Legacy monthly rankings (home league card) --------------------------------
drop function if exists public.get_monthly_athlete_rankings(integer);
create or replace function public.get_monthly_athlete_rankings(_limit integer default 15, _as_user uuid default null)
returns table(client_id uuid, display_name text, avatar_url text, monthly_xp bigint, rank bigint, is_me boolean, bodyweight_value numeric, bodyweight_unit text, bodyweight_logged_at date, workouts_completed bigint, fully_logged bigint, strength_score bigint, qualified boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid)
  select s.client_id, s.display_name, s.avatar_url, (s.total_points * 1000)::bigint, s.rank::bigint,
    (s.user_id = v.uid), s.bodyweight_value, s.bodyweight_unit, s.bodyweight_logged_at,
    s.workouts_completed::bigint, s.fully_logged::bigint, (s.improvement_points * 1000)::bigint, s.qualified
  from public.league_month_scores(null, now()) s, viewer v
  where v.uid is not null
    and ((s.qualified and s.rank <= least(greatest(_limit,1),50)) or s.user_id = v.uid)
  order by s.qualified desc, s.rank nulls last, s.display_name
$function$;

revoke all on function public.get_monthly_athlete_rankings(integer, uuid) from public, anon;
grant execute on function public.get_monthly_athlete_rankings(integer, uuid) to authenticated, service_role;
