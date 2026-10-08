-- Hall of Strength: JF Effect meet history.
--
-- A second set of boards next to the training boards: the best judged squat,
-- bench, deadlift and total from every JF Effect athlete's meets, past and
-- present. Same qualifying rule as get_powerlifting_rankings(): only meets
-- inside the athlete's JF coaching period(s) and country filter.
--
-- Same boards as training: pound for pound (x meet bodyweight, everyone),
-- absolute (All, plus Men / Women). Each board uses the athlete's best meet
-- for that board: heaviest for absolute, most x bodyweight for pound for
-- pound, so one athlete can return two rows per lift (abs_rank set on one,
-- p4p_rank on the other) when those came from different meets.
-- A total only counts from a full-power meet (all three lifts made).
-- Athletes linked to a client show that client's current name and photo;
-- competed_as is the name on that meet's result when the surname differs
-- (e.g. a married name).
-- Everyone is returned (meet history is the point); the app shows the top 10
-- and the rest on request.

create or replace function public.get_strength_board_meets(_as_user uuid default null)
returns table(
  athlete_id uuid,
  client_id uuid,
  display_name text,
  competed_as text,
  avatar_url text,
  is_me boolean,
  is_coach boolean,
  is_alumni boolean,
  sex text,
  lift text,
  kg numeric,
  meet_date date,
  meet_name text,
  federation text,
  weight_class text,
  bw_kg numeric,
  bw_multiple numeric,
  gl_points numeric,
  abs_rank integer,
  p4p_rank integer,
  all_rank integer,
  abs_count integer,
  p4p_count integer,
  all_count integer,
  athlete_meets integer,
  first_meet date
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  meets as materialized (
    select r.id, r.athlete_id, nullif(trim(r.athlete_name), '') entered_name, r.meet_date, coalesce(nullif(trim(r.meet_name), ''), nullif(trim(r.meet_location), ''), 'Meet') meet_name,
      r.federation, r.weight_class_kg, r.bodyweight_kg, r.squat_kg, r.bench_kg, r.deadlift_kg, r.total_kg, r.gl_points
    from public.athlete_powerlifting_results r
    join public.powerlifting_athletes a on a.id = r.athlete_id
    where exists (
        select 1 from public.powerlifting_coaching_periods p
        where p.athlete_id = r.athlete_id
          and (p.start_date is null or r.meet_date >= p.start_date)
          and (p.end_date is null or r.meet_date <= p.end_date))
      and (a.country_filter is null or r.meet_location ilike a.country_filter || '%')
  ),
  lifts as materialized (
    select m.id, m.athlete_id, m.entered_name, m.meet_date, m.meet_name, m.federation, m.weight_class_kg,
      case when m.bodyweight_kg between 30 and 250 then m.bodyweight_kg end bw_kg,
      x.lift, x.kg, case when x.lift = 'total' then m.gl_points end gl_points
    from meets m
    cross join lateral (values
      ('squat', m.squat_kg),
      ('bench', m.bench_kg),
      ('deadlift', m.deadlift_kg),
      ('total', case when m.squat_kg > 0 and m.bench_kg > 0 and m.deadlift_kg > 0
        then coalesce(nullif(m.total_kg, 0), m.squat_kg + m.bench_kg + m.deadlift_kg) end)
    ) x(lift, kg)
    where x.kg > 0
  ),
  athletes as materialized (
    select a.id athlete_id, c.id client_id, c.user_id,
      coalesce(nullif(regexp_replace(trim(coalesce(c.full_name, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')))), '\s+', ' ', 'g'), ''),
        a.athlete_name) display_name,
      a.athlete_name,
      pr.avatar_url,
      lower(coalesce(a.status, 'active')) = 'retired' is_alumni,
      case
        when lower(coalesce(a.sex, c.sex, '')) like 'f%' then 'female'
        when lower(coalesce(a.sex, c.sex, '')) like 'm%' then 'male'
      end sex,
      (select count(*) from meets m where m.athlete_id = a.id)::int athlete_meets,
      (select min(m.meet_date) from meets m where m.athlete_id = a.id) first_meet
    from public.powerlifting_athletes a
    left join public.clients c on c.id = a.client_id
    left join public.profiles pr on pr.id = c.user_id
  ),
  abs_best as (
    select distinct on (l.athlete_id, l.lift) l.athlete_id, l.lift, l.id
    from lifts l
    order by l.athlete_id, l.lift, l.kg desc, l.meet_date
  ),
  p4p_best as (
    select distinct on (l.athlete_id, l.lift) l.athlete_id, l.lift, l.id, l.kg / l.bw_kg ratio
    from lifts l
    where l.bw_kg is not null
    order by l.athlete_id, l.lift, l.kg / l.bw_kg desc, l.kg desc, l.meet_date
  ),
  abs_ranked as (
    select b.athlete_id, b.lift, b.id,
      (row_number() over (partition by b.lift order by l.kg desc, l.meet_date))::int all_rank,
      (count(*) over (partition by b.lift))::int all_count,
      case when a.sex is not null then (row_number() over (
        partition by b.lift, a.sex is not null, a.sex order by l.kg desc, l.meet_date))::int end abs_rank,
      case when a.sex is not null then (count(*) over (partition by b.lift, a.sex is not null, a.sex))::int end abs_count
    from abs_best b
    join lifts l on l.id = b.id and l.lift = b.lift
    join athletes a on a.athlete_id = b.athlete_id
  ),
  p4p_ranked as (
    select b.athlete_id, b.lift, b.id,
      (row_number() over (partition by b.lift order by b.ratio desc, l.kg desc, l.meet_date))::int p4p_rank,
      (count(*) over (partition by b.lift))::int p4p_count
    from p4p_best b
    join lifts l on l.id = b.id and l.lift = b.lift
  ),
  picked as (
    select coalesce(ar.athlete_id, pr.athlete_id) athlete_id, coalesce(ar.lift, pr.lift) lift, coalesce(ar.id, pr.id) id,
      ar.abs_rank, pr.p4p_rank, ar.all_rank, ar.abs_count, pr.p4p_count, ar.all_count
    from abs_ranked ar
    full join p4p_ranked pr on pr.athlete_id = ar.athlete_id and pr.lift = ar.lift and pr.id = ar.id
  )
  select a.athlete_id, a.client_id, a.display_name,
    case when lower(regexp_replace(coalesce(l.entered_name, a.athlete_name), '^.*\s', '')) <> lower(regexp_replace(a.display_name, '^.*\s', ''))
      then coalesce(l.entered_name, a.athlete_name) end competed_as,
    a.avatar_url, coalesce(a.user_id = v.uid, false), coalesce(public.community_is_coach(a.user_id), false), a.is_alumni,
    a.sex, p.lift, round(l.kg, 1), l.meet_date, l.meet_name, l.federation, l.weight_class_kg,
    round(l.bw_kg, 1), round(l.kg / l.bw_kg, 2), round(l.gl_points, 2),
    p.abs_rank, p.p4p_rank, p.all_rank,
    max(p.abs_count) over (partition by p.lift, a.sex), max(p.p4p_count) over (partition by p.lift), max(p.all_count) over (partition by p.lift),
    a.athlete_meets, a.first_meet
  from picked p
  join lifts l on l.id = p.id and l.lift = p.lift
  join athletes a on a.athlete_id = p.athlete_id
  cross join viewer v
  where v.uid is not null
  order by p.lift, p.all_rank nulls last, p.p4p_rank
$$;
revoke all on function public.get_strength_board_meets(uuid) from public, anon;
grant execute on function public.get_strength_board_meets(uuid) to authenticated, service_role;
