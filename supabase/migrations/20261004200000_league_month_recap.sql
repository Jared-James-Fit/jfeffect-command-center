-- Monthly League Recap: the caller's previous-month story — final rank,
-- points breakdown, training stats, records, month-over-month change,
-- league-wide stats, the podium and their 3 closest rivals (the athletes who
-- finished nearest to them in points). Only data already public on the
-- leaderboard is exposed about other athletes.

create or replace function public.get_league_month_recap(_month date default null)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
with target as (
  select coalesce(_month,
    (date_trunc('month', (now() at time zone public.league_tz())::date) - interval '1 month')::date) m
),
s as (select x.* from target t cross join lateral public.league_month_scores(t.m, now()) x),
me as (select * from s where s.user_id = auth.uid() limit 1),
board as (select * from s where s.qualified),
prev as (
  select p.rank, p.total_points, p.qualified
  from target t cross join lateral public.league_month_scores((t.m - interval '1 month')::date, now()) p
  where p.user_id = auth.uid() limit 1
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
        'is_me', b.user_id = auth.uid(), 'atpr_lifts', b.atpr_lifts) order by b.rank)
      from board b where b.rank <= 3), '[]'::jsonb),
    'rivals', coalesce((select jsonb_agg(jsonb_build_object(
        'display_name', r.display_name, 'avatar_url', r.avatar_url, 'rank', r.rank, 'total_points', r.total_points,
        'gap', r.total_points - (select total_points from me),
        'workouts_completed', r.workouts_completed, 'atpr_lifts', r.atpr_lifts,
        'program_pr_lifts', r.program_pr_lifts, 'improved_exercises', r.improved_exercises) order by r.rn)
      from rivals r where r.rn <= 3), '[]'::jsonb)
  )
end
$$;
revoke all on function public.get_league_month_recap(date) from public, anon;
grant execute on function public.get_league_month_recap(date) to authenticated, service_role;
