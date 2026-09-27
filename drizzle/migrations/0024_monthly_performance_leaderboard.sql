-- Monthly JF Performance Leaderboard.
-- Qualification requires a bodyweight logged during the current calendar month.
-- Monthly score intentionally rewards execution for every client; powerlifting-specific
-- records remain a separate board so lifestyle clients are not structurally excluded.
create or replace function public.get_monthly_athlete_rankings(_limit integer default 15)
returns table (
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
  qualified boolean
)
language sql stable security definer set search_path=public as $$
  with month_bounds as (
    select date_trunc('month', now()) as start_at,
           date_trunc('month', now()) + interval '1 month' as end_at
  ),
  base as (
    select c.id client_id,
      c.user_id,
      coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)) display_name,
      p.avatar_url
    from public.clients c
    left join public.profiles p on p.id=c.user_id
    where coalesce(c.archived,false)=false and c.archived_at is null and coalesce(c.status,'') <> 'Archived'
  ),
  bw as (
    select distinct on (b.user_id) b.user_id, b.weight_value, b.weight_unit, b.logged_date
    from public.progress_bodyweight b, month_bounds m
    where b.logged_date >= m.start_at::date and b.logged_date < m.end_at::date
    order by b.user_id, b.logged_date desc, b.created_at desc
  ),
  scores as (
    select b.client_id,b.user_id,b.display_name,b.avatar_url,
      coalesce(sum(e.xp) filter(where e.occurred_at>=m.start_at and e.occurred_at<m.end_at),0)::bigint raw_xp,
      count(*) filter(where e.event_type='workout_completed' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at)::bigint workouts_completed,
      count(*) filter(where e.event_type='workout_fully_logged' and e.occurred_at>=m.start_at and e.occurred_at<m.end_at)::bigint fully_logged,
      bw.weight_value,bw.weight_unit,bw.logged_date
    from base b cross join month_bounds m
    left join public.athlete_xp_events e on e.client_id=b.client_id
    left join bw on bw.user_id=b.user_id
    group by b.client_id,b.user_id,b.display_name,b.avatar_url,bw.weight_value,bw.weight_unit,bw.logged_date
  ),
  normalized as (
    select s.*,
      case when s.logged_date is null then 0
           else least(1000, least(800, s.raw_xp) + least(150, s.fully_logged*15) + 50) end::bigint monthly_xp,
      (s.logged_date is not null) qualified
    from scores s
  ),
  ranked as (
    select n.*, case when n.qualified then rank() over(partition by n.qualified order by n.monthly_xp desc,n.workouts_completed desc,n.display_name) end rank
    from normalized n
  )
  select r.client_id,r.display_name,r.avatar_url,r.monthly_xp,r.rank,
    (r.user_id=auth.uid()) is_me,r.weight_value,r.weight_unit,r.logged_date,
    r.workouts_completed,r.fully_logged,r.qualified
  from ranked r
  where auth.uid() is not null
    and ((r.qualified and r.rank<=least(greatest(_limit,1),50)) or r.user_id=auth.uid())
  order by r.qualified desc,r.rank nulls last,r.display_name;
$$;
revoke execute on function public.get_monthly_athlete_rankings(integer) from public,anon;
grant execute on function public.get_monthly_athlete_rankings(integer) to authenticated;
