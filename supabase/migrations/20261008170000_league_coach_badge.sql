-- Coach badge on the league and athlete profiles.
--
-- The coach also trains as a client (their own athlete account, ranked in the Performance League like
-- everyone else). Clients should be able to tell which athlete is the coach, the same way the community
-- already does: community_is_coach(user_id) is the single source of truth (a staff role on any of the
-- person's accounts, or the "Coach" title on their community profile). Nothing about the athlete account
-- changes: same scores, same data, same history. The league and profile functions just also say who the
-- coach is, so the app can show the badge.
--
-- Additive: each function returns one extra trailing column / key, so a browser tab still running the
-- previous app version keeps working (it ignores the new field).

-- Home league card (top 3) --------------------------------------------------
drop function if exists public.get_monthly_athlete_rankings(integer, uuid);
create or replace function public.get_monthly_athlete_rankings(_limit integer default 15, _as_user uuid default null)
returns table(client_id uuid, display_name text, avatar_url text, monthly_xp bigint, rank bigint, is_me boolean, bodyweight_value numeric, bodyweight_unit text, bodyweight_logged_at date, workouts_completed bigint, fully_logged bigint, strength_score bigint, qualified boolean, is_coach boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid)
  select s.client_id, s.display_name, s.avatar_url, (s.total_points * 1000)::bigint, s.rank::bigint,
    (s.user_id = v.uid), s.bodyweight_value, s.bodyweight_unit, s.bodyweight_logged_at,
    s.workouts_completed::bigint, s.fully_logged::bigint, (s.improvement_points * 1000)::bigint, s.qualified,
    public.community_is_coach(s.user_id)
  from public.league_month_scores(null, now()) s, viewer v
  where v.uid is not null
    and ((s.qualified and s.rank <= least(greatest(_limit,1),50)) or s.user_id = v.uid)
  order by s.qualified desc, s.rank nulls last, s.display_name
$function$;

revoke all on function public.get_monthly_athlete_rankings(integer, uuid) from public, anon;
grant execute on function public.get_monthly_athlete_rankings(integer, uuid) to authenticated, service_role;

-- Performance League screen -------------------------------------------------
drop function if exists public.get_performance_league(date, uuid);
create or replace function public.get_performance_league(_month date default null, _as_user uuid default null)
returns table(client_id uuid, display_name text, avatar_url text, rank integer, is_me boolean, qualified boolean, bodyweight_value numeric, bodyweight_unit text, total_points integer, workout_points integer, logging_points integer, bodyweight_points integer, improvement_points integer, match_points integer, workouts_completed integer, fully_logged integer, boost_status text, needed_workouts integer, projected_total integer, eligible_workouts integer, completed_eligible integer, adherence_pct numeric, open_workouts integer, match_target integer, projected_match integer, month_start date, final_week_start date, is_final_week boolean, month_closed boolean, finalized boolean, atpr_lifts integer, program_pr_lifts integer, block_pr_lifts integer, last_record_at timestamp with time zone, is_coach boolean)
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
    s.atpr_lifts, s.program_pr_lifts, s.block_pr_lifts, s.last_record_at,
    public.community_is_coach(s.user_id)
  from public.league_month_scores(_month, now()) s, viewer v
  where v.uid is not null
    and ((s.qualified and s.rank <= 50) or s.user_id = v.uid)
  order by s.qualified desc, s.rank nulls last, s.display_name
$function$;

revoke all on function public.get_performance_league(date, uuid) from public, anon;
grant execute on function public.get_performance_league(date, uuid) to authenticated, service_role;

-- Athlete profile sheet -----------------------------------------------------
drop function if exists public.get_athlete_public_profile(uuid);
create or replace function public.get_athlete_public_profile(_client_id uuid)
returns table(client_id uuid, display_name text, avatar_url text, xp bigint, workouts_completed bigint, workouts_fully_logged bigint, first_workout_at timestamp with time zone, is_me boolean, month_workouts_completed bigint, month_workouts_fully_logged bigint, last_workout_at timestamp with time zone, is_coach boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id,
    coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)),
    p.avatar_url,
    coalesce(sum(e.xp),0)::bigint,
    count(*) filter (where e.event_type = 'workout_completed'),
    count(*) filter (where e.event_type = 'workout_fully_logged'),
    min(e.occurred_at) filter (where e.event_type = 'workout_completed'),
    (c.user_id = auth.uid()),
    (select ms.workouts_completed from public.league_month_scores(null, now()) ms where ms.client_id = c.id)::bigint,
    (select ms.fully_logged from public.league_month_scores(null, now()) ms where ms.client_id = c.id)::bigint,
    max(e.occurred_at) filter (where e.event_type = 'workout_completed'),
    public.community_is_coach(c.user_id)
  from public.clients c
  left join public.profiles p on p.id = c.user_id
  left join public.athlete_xp_events e on e.client_id = c.id
  where auth.uid() is not null and c.id = _client_id
    and (c.user_id = auth.uid() or (coalesce(c.archived,false) = false and c.archived_at is null and coalesce(c.status,'') <> 'Archived'))
  group by c.id, p.avatar_url;
$function$;

revoke all on function public.get_athlete_public_profile(uuid) from public, anon;
grant execute on function public.get_athlete_public_profile(uuid) to authenticated, service_role;

-- Month recap (podium and closest rivals) -----------------------------------
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
        'is_me', b.user_id = (select uid from viewer), 'atpr_lifts', b.atpr_lifts,
        'is_coach', public.community_is_coach(b.user_id)) order by b.rank)
      from board b where b.rank <= 3), '[]'::jsonb),
    'rivals', coalesce((select jsonb_agg(jsonb_build_object(
        'display_name', r.display_name, 'avatar_url', r.avatar_url, 'rank', r.rank, 'total_points', r.total_points,
        'gap', r.total_points - (select total_points from me),
        'workouts_completed', r.workouts_completed, 'atpr_lifts', r.atpr_lifts,
        'program_pr_lifts', r.program_pr_lifts, 'improved_exercises', r.improved_exercises,
        'is_coach', public.community_is_coach(r.user_id)) order by r.rn)
      from rivals r where r.rn <= 3), '[]'::jsonb)
  )
end
$function$;

revoke all on function public.get_league_month_recap(date, uuid) from public, anon;
grant execute on function public.get_league_month_recap(date, uuid) to authenticated, service_role;
