-- Performance League: simple, whole-number scoring.
--   Completed workout          +10
--   Complete workout logging   +5
--   Bodyweight log             +5   (one per day, enforced by the XP trigger)
--   Performance improvement    +5   per exercise whose best estimated 1RM this
--                                   month beats every earlier month
-- No scaled/partial awards and no bonus multiplier, so totals are always whole
-- numbers. The league is computed live, so replacing this function rescores
-- the current month for everyone from their actual activity.
--
-- Output shape is unchanged: monthly_xp and strength_score stay encoded as
-- points * 1000 so already-loaded app versions keep rendering correctly.

create or replace function public.get_monthly_athlete_rankings(_limit integer default 15)
returns table(
  client_id uuid,
  display_name text,
  avatar_url text,
  monthly_xp bigint,
  rank bigint,
  is_me boolean,
  bodyweight_value numeric,
  bodyweight_unit text,
  bodyweight_logged_at date,
  workouts_completed bigint,
  fully_logged bigint,
  strength_score bigint,
  qualified boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with month_bounds as (
  select date_trunc('month',now()) start_at,date_trunc('month',now())+interval '1 month' end_at
),
base as (
  select c.id client_id,c.user_id,
    coalesce(nullif(trim(coalesce(c.first_name,'')||' '||left(coalesce(c.last_name,''),1)),''),split_part(coalesce(c.full_name,'Athlete'),' ',1)) display_name,
    p.avatar_url
  from public.clients c left join public.profiles p on p.id=c.user_id
  where coalesce(c.archived,false)=false and c.archived_at is null and coalesce(c.status,'')<>'Archived'
),
bodyweight_sources as (
  select pb.user_id,pb.weight_value,pb.weight_unit,pb.logged_date,pb.created_at
  from public.progress_bodyweight pb where pb.weight_value is not null and pb.weight_value>0
  union all
  select c.user_id,pm.bodyweight,coalesce(pm.bodyweight_unit,'lb'),pm.entry_date,pm.created_at
  from public.progress_metrics pm join public.clients c on c.id=pm.client_id
  where pm.bodyweight is not null and pm.bodyweight>0
),
current_bw as (
  select distinct on (b.user_id) b.user_id,b.weight_value,b.weight_unit,b.logged_date
  from bodyweight_sources b order by b.user_id,b.logged_date desc,b.created_at desc
),
valid_sets as (
  select r.client_id,er.exercise_id,r.completed_at,
    (coalesce(r.normalized_kg,r.actual_load_kg,
      case when lower(coalesce(r.actual_load_unit,r.entered_unit))='lb'
        then coalesce(r.actual_load,r.entered_value)*0.45359237
        else coalesce(r.actual_load,r.entered_value) end)
      *36.0/(37.0-r.actual_reps)) e1rm_kg
  from public.pl_row_results r join public.pl_exercise_rows er on er.id=r.row_id
  where er.exercise_id is not null and coalesce(r.is_working_set,true)=true
    and coalesce(r.load_type,'external')='external' and r.actual_reps between 1 and 12
    and r.completed_at is not null
    and coalesce(r.normalized_kg,r.actual_load_kg,r.actual_load,r.entered_value)>0
),
current_perf as (
  select s.client_id,s.exercise_id,max(s.e1rm_kg) e1rm from valid_sets s,month_bounds m
  where s.completed_at>=m.start_at and s.completed_at<m.end_at group by s.client_id,s.exercise_id
),
prior_perf as (
  select s.client_id,s.exercise_id,max(s.e1rm_kg) e1rm from valid_sets s,month_bounds m
  where s.completed_at<m.start_at group by s.client_id,s.exercise_id
),
-- One award per exercise per month: the month's best must beat the all-time
-- prior best (0.05 kg tolerance so unit-conversion noise never counts).
improvements as (
  select c.client_id,count(*)::bigint improved_exercises
  from current_perf c join prior_perf p using(client_id,exercise_id)
  where p.e1rm>0 and c.e1rm>p.e1rm+0.05
  group by c.client_id
),
activity as (
  select b.client_id,b.user_id,b.display_name,b.avatar_url,
    count(distinct e.source_id) filter(where e.event_type='workout_completed' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at)::bigint workouts_completed,
    count(distinct e.source_id) filter(where e.event_type='workout_fully_logged' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at)::bigint fully_logged,
    count(distinct (e.occurred_at at time zone 'UTC')::date) filter(where e.event_type='bodyweight' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at)::bigint bw_logs,
    cb.weight_value,cb.weight_unit,cb.logged_date,
    coalesce(i.improved_exercises,0) improved_exercises
  from base b cross join month_bounds m
  left join public.athlete_xp_events e on e.client_id=b.client_id
  left join current_bw cb on cb.user_id=b.user_id
  left join improvements i on i.client_id=b.client_id
  group by b.client_id,b.user_id,b.display_name,b.avatar_url,cb.weight_value,cb.weight_unit,cb.logged_date,i.improved_exercises
),
scored as (
  select a.*,
    a.workouts_completed*10 workout_points,
    a.fully_logged*5 logging_points,
    a.bw_logs*5 bodyweight_points,
    a.improved_exercises*5 performance_points
  from activity a
),
normalized as (
  select s.*,
    (s.workout_points+s.logging_points+s.bodyweight_points+s.performance_points)*1000 monthly_xp,
    (s.logged_date is not null) qualified
  from scored s
),
ranked as (
  select n.*,case when n.qualified then row_number() over(partition by n.qualified order by n.monthly_xp desc,n.performance_points desc,n.workout_points desc,n.logging_points desc,n.bodyweight_points desc,n.display_name,n.client_id) end rank
  from normalized n
)
select r.client_id,r.display_name,r.avatar_url,r.monthly_xp::bigint,r.rank,(r.user_id=auth.uid()) is_me,
  r.weight_value,r.weight_unit,r.logged_date,r.workouts_completed,r.fully_logged,
  (r.performance_points*1000)::bigint,r.qualified
from ranked r
where auth.uid() is not null and ((r.qualified and r.rank<=least(greatest(_limit,1),50)) or r.user_id=auth.uid())
order by r.qualified desc,r.rank nulls last,r.display_name;
$function$;
