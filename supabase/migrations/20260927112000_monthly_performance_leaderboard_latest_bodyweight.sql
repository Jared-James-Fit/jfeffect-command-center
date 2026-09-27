-- Monthly JF Performance Leaderboard.
-- Qualification requires any bodyweight log; scoring always uses the athlete's most recent bodyweight entry.
-- Monthly score intentionally rewards execution for every client; powerlifting-specific
-- records remain a separate board so lifestyle clients are not structurally excluded.
create or replace function public.get_monthly_athlete_rankings(_limit integer default 15)
returns table (
  client_id uuid, display_name text, avatar_url text, monthly_xp bigint, rank bigint, is_me boolean,
  bodyweight_value numeric, bodyweight_unit text, bodyweight_logged_at date,
  workouts_completed bigint, fully_logged bigint, strength_score bigint, qualified boolean
)
language sql stable security definer set search_path=public as $
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
    from public.progress_bodyweight pb
    where pb.weight_value is not null and pb.weight_value>0
    union all
    select c.user_id,pm.bodyweight,coalesce(pm.bodyweight_unit,'lb'),pm.entry_date,pm.created_at
    from public.progress_metrics pm join public.clients c on c.id=pm.client_id
    where pm.bodyweight is not null and pm.bodyweight>0
  ),
  current_bw as (
    select distinct on (b.user_id) b.user_id,
      case when lower(b.weight_unit)='lb' then b.weight_value*0.45359237 else b.weight_value end weight_kg,
      b.weight_value,b.weight_unit,b.logged_date
    from bodyweight_sources b
    order by b.user_id,b.logged_date desc,b.created_at desc
  ),
  prior_bw as (
    select distinct on (b.user_id) b.user_id,
      case when lower(b.weight_unit)='lb' then b.weight_value*0.45359237 else b.weight_value end weight_kg
    from public.progress_bodyweight b,month_bounds m
    where b.logged_date<m.start_at::date
    order by b.user_id,b.logged_date desc,b.created_at desc
  ),
  valid_sets as (
    select r.client_id,er.exercise_id,r.completed_at,
      (coalesce(r.normalized_kg,r.actual_load_kg,
        case when lower(coalesce(r.actual_load_unit,r.entered_unit))='lb' then coalesce(r.actual_load,r.entered_value)*0.45359237
             else coalesce(r.actual_load,r.entered_value) end)
       * 36.0/(37.0-r.actual_reps)) e1rm_kg
    from public.pl_row_results r
    join public.pl_exercise_rows er on er.id=r.row_id
    where er.exercise_id is not null and coalesce(r.is_working_set,true)=true
      and coalesce(r.load_type,'external')='external'
      and r.actual_reps between 1 and 12 and r.completed_at is not null
      and coalesce(r.normalized_kg,r.actual_load_kg,r.actual_load,r.entered_value)>0
  ),
  current_strength as (
    select s.client_id,s.exercise_id,max(s.e1rm_kg/nullif(cb.weight_kg,0)) ratio
    from valid_sets s join base b on b.client_id=s.client_id join current_bw cb on cb.user_id=b.user_id,month_bounds m
    where s.completed_at>=m.start_at and s.completed_at<m.end_at
    group by s.client_id,s.exercise_id
  ),
  prior_strength as (
    select s.client_id,s.exercise_id,max(s.e1rm_kg/nullif(pb.weight_kg,0)) ratio
    from valid_sets s join base b on b.client_id=s.client_id join prior_bw pb on pb.user_id=b.user_id,month_bounds m
    where s.completed_at<m.start_at
    group by s.client_id,s.exercise_id
  ),
  improvements as (
    select c.client_id,c.exercise_id,
      greatest(0,least(50,round(((c.ratio/p.ratio)-1)*500)))::bigint points
    from current_strength c join prior_strength p using(client_id,exercise_id)
    where p.ratio>0 and c.ratio>p.ratio
  ),
  strength as (
    select client_id,coalesce(sum(points),0)::bigint strength_score
    from (select i.*,row_number() over(partition by client_id order by points desc,exercise_id) rn from improvements i) x
    where rn<=4 group by client_id
  ),
  activity as (
    select b.client_id,b.user_id,b.display_name,b.avatar_url,
      coalesce(sum(e.xp) filter(where e.event_type='workout_completed' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at),0)::bigint workout_xp,
      count(*) filter(where e.event_type='workout_completed' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at)::bigint workouts_completed,
      count(*) filter(where e.event_type='workout_fully_logged' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at)::bigint fully_logged,
      cb.weight_value,cb.weight_unit,cb.logged_date,coalesce(st.strength_score,0)::bigint strength_score
    from base b cross join month_bounds m
    left join public.athlete_xp_events e on e.client_id=b.client_id
    left join current_bw cb on cb.user_id=b.user_id
    left join strength st on st.client_id=b.client_id
    group by b.client_id,b.user_id,b.display_name,b.avatar_url,cb.weight_value,cb.weight_unit,cb.logged_date,st.strength_score
  ),
  normalized as (
    select a.*,
      case when a.logged_date is null then 0 else
        least(1000,least(600,a.workout_xp)+least(150,a.fully_logged*15)+least(200,a.strength_score)+50) end::bigint monthly_xp,
      (a.logged_date is not null) qualified
    from activity a
  ),
  ranked as (
    select n.*,case when n.qualified then rank() over(partition by n.qualified order by n.monthly_xp desc,n.workouts_completed desc,n.display_name) end rank
    from normalized n
  )
  select r.client_id,r.display_name,r.avatar_url,r.monthly_xp,r.rank,(r.user_id=auth.uid()) is_me,
    r.weight_value,r.weight_unit,r.logged_date,r.workouts_completed,r.fully_logged,r.strength_score,r.qualified
  from ranked r
  where auth.uid() is not null and ((r.qualified and r.rank<=least(greatest(_limit,1),50)) or r.user_id=auth.uid())
  order by r.qualified desc,r.rank nulls last,r.display_name;
$;
revoke execute on function public.get_monthly_athlete_rankings(integer) from public,anon;
grant execute on function public.get_monthly_athlete_rankings(integer) to authenticated;
