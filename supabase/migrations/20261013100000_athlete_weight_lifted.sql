-- Weight lifted (volume load) for the league athlete profile: this league month
-- and lifetime. Clients cannot read each other's set logs (RLS), so this is a
-- security-definer aggregate that returns totals only, never set-level data.
--
-- Same rules as the Weight Lifted analytics card:
--   * per calendar day, sum of normalized_lb * actual_reps from logged sets
--   * a day with no logged load falls back to the quick-log session_weight_total
--   * 0-load sets (bodyweight) add nothing
-- Days and the month window use the league (coaching) timezone so "this month"
-- matches the league standings. Visibility matches get_athlete_public_profile.

create or replace function public.get_athlete_weight_lifted(_client_id uuid)
returns table(
  client_id uuid,
  month_lb numeric,
  lifetime_lb numeric,
  month_sessions integer,
  lifetime_sessions integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with vis as (
    select c.id
    from public.clients c
    where auth.uid() is not null and c.id = _client_id
      and (c.user_id = auth.uid()
           or (coalesce(c.archived,false) = false and c.archived_at is null and coalesce(c.status,'') <> 'Archived'))
  ),
  b as (select * from public.league_month_bounds(null, now())),
  set_days as (
    select (r.completed_at at time zone public.league_tz())::date as d,
           sum(l.lb * r.actual_reps) as lb
    from public.pl_row_results r
    join vis on vis.id = r.client_id
    cross join lateral (
      select coalesce(r.normalized_lb,
               case when r.actual_load_unit = 'kg' then r.actual_load * 2.2046226 else r.actual_load end) as lb
    ) l
    where r.actual_reps > 0 and r.completed_at is not null and l.lb > 0
    group by 1
  ),
  quick_days as (
    select (pc.completed_at at time zone public.league_tz())::date as d,
           sum(case when pc.session_weight_unit = 'kg' then pc.session_weight_total * 2.2046226
                    else pc.session_weight_total end) as lb
    from public.pl_day_completions pc
    join vis on vis.id = pc.client_id
    where pc.completed_at is not null and pc.session_weight_total > 0
    group by 1
  ),
  per_day as (
    select coalesce(s.d, q.d) as d,
           case when coalesce(s.lb, 0) > 0 then s.lb else q.lb end as lb
    from set_days s
    full join quick_days q on q.d = s.d
  )
  select vis.id,
    coalesce(sum(p.lb) filter (where p.d >= b.month_start and p.d <= b.month_end), 0),
    coalesce(sum(p.lb), 0),
    (count(*) filter (where p.lb > 0 and p.d >= b.month_start and p.d <= b.month_end))::integer,
    (count(*) filter (where p.lb > 0))::integer
  from vis
  cross join b
  left join per_day p on true
  group by vis.id;
$$;

revoke all on function public.get_athlete_weight_lifted(uuid) from public, anon;
grant execute on function public.get_athlete_weight_lifted(uuid) to authenticated, service_role;
