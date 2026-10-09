-- Hall of Strength, two clear boards:
--   * All-time: everyone JF Effect has ever coached (current and former
--     clients, plus meet-only athletes), each person's best lift from
--     training logged in the app OR a meet (get_strength_board_all).
--   * Competition: sanctioned meet results only (get_strength_board_meets,
--     unchanged output, now on a shared strength_board_meet_lifts()).
-- Former (archived) clients' training lifts now count, so the typo review
-- covers them too; the coach's "can't rank yet" list stays current clients.

-- ── Training sets: no longer skip archived clients ────────────────────────
create or replace function public.strength_board_sets()
returns table(
  result_id uuid,
  client_id uuid,
  lift text,
  load_kg numeric,
  reps integer,
  lifted_at timestamptz,
  lift_day date,
  bw_kg numeric,
  e1rm_kg numeric,
  flag text,
  review text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with board_exercises as materialized (
    select e.id, public.strength_board_lift(e.name, e.competition_lift_type) lift
    from public.exercises e
    where public.strength_board_lift(e.name, e.competition_lift_type) is not null
  ),
  sets as materialized (
    select r.id result_id, r.client_id, c.user_id, bx.lift,
      coalesce(r.normalized_kg, r.actual_load_kg,
        case when lower(coalesce(r.actual_load_unit, r.entered_unit)) = 'lb'
          then coalesce(r.actual_load, r.entered_value) * 0.45359237
          else coalesce(r.actual_load, r.entered_value) end) load_kg,
      r.actual_reps::int reps,
      r.completed_at lifted_at,
      (r.completed_at at time zone public.league_tz())::date lift_day
    from public.pl_row_results r
    join public.pl_exercise_rows er on er.id = r.row_id
    join board_exercises bx on bx.id = er.exercise_id
    join public.clients c on c.id = r.client_id
    where r.completed_at is not null
      and r.actual_reps >= 1
      and coalesce(r.load_type, 'external') = 'external'
      and coalesce(r.is_bodyweight, false) = false
      and coalesce(r.is_working_set, true)
  ),
  lift_days as materialized (
    select distinct s.client_id, s.user_id, s.lift_day from sets s
  ),
  bodyweights as materialized (
    -- Both bodyweight sources, in kg, for athletes with lifts only.
    select a.client_id, x.d, x.kg, x.entered_at
    from (select distinct l.client_id, l.user_id from lift_days l) a
    cross join lateral (
      select pb.logged_date d,
        pb.weight_value * case when lower(coalesce(pb.weight_unit, 'lb')) = 'kg' then 1 else 0.45359237 end kg,
        pb.created_at entered_at
      from public.progress_bodyweight pb
      where pb.user_id = a.user_id and pb.weight_value > 0
      union all
      select pm.entry_date,
        pm.bodyweight * case when lower(coalesce(pm.bodyweight_unit, 'lb')) = 'kg' then 1 else 0.45359237 end,
        pm.created_at
      from public.progress_metrics pm
      where pm.client_id = a.client_id and pm.bodyweight > 0
    ) x
    where x.kg between 30 and 250
  ),
  day_bw as materialized (
    -- The bodyweight log closest to the lift day, whenever it was (earlier wins
    -- a tie; two logs on one day: the newest entry). near = within 30 days.
    select z.client_id, z.lift_day, z.kg bw_kg, z.gap <= 30 near
    from (
      select d.client_id, d.lift_day, b.kg, abs(b.d - d.lift_day) gap,
        row_number() over (partition by d.client_id, d.lift_day
          order by abs(b.d - d.lift_day), b.d <= d.lift_day desc, b.entered_at desc, b.kg desc) rn
      from lift_days d
      join bodyweights b on b.client_id = d.client_id
    ) z
    where z.rn = 1
  ),
  hard as materialized (
    select s.result_id, s.client_id, s.lift, s.load_kg, s.reps, s.lifted_at, s.lift_day, b.bw_kg,
      s.load_kg * 36.0 / (37 - least(s.reps, 12)) e1rm_kg,
      rv.status review,
      case
        when s.load_kg * 36.0 / (37 - least(s.reps, 12)) > case s.lift when 'squat' then 500 when 'bench' then 360 else 470 end
          then 'Heavier than the world record'
        when b.near
          and s.load_kg * 36.0 / (37 - least(s.reps, 12)) / b.bw_kg > case s.lift when 'squat' then 4.0 when 'bench' then 3.0 else 4.5 end
          then 'Too many times bodyweight to be real'
      end hard_flag
    from sets s
    left join day_bw b on b.client_id = s.client_id and b.lift_day = s.lift_day
    left join public.strength_board_reviews rv on rv.result_id = s.result_id
    where s.load_kg > 0
  ),
  day_best as materialized (
    select h.client_id, h.lift, h.lift_day, max(h.e1rm_kg) best
    from hard h
    where h.hard_flag is null and coalesce(h.review, '') <> 'excluded'
    group by 1, 2, 3
  ),
  top_days as materialized (
    select t.client_id, t.lift,
      max(t.best) filter (where t.rn = 1) best1,
      max(t.lift_day) filter (where t.rn = 1) best1_day,
      max(t.best) filter (where t.rn = 2) best2
    from (
      select db.*, row_number() over (partition by db.client_id, db.lift order by db.best desc, db.lift_day) rn
      from day_best db
    ) t
    where t.rn <= 2
    group by 1, 2
  )
  select h.result_id, h.client_id, h.lift, round(h.load_kg, 2), h.reps, h.lifted_at, h.lift_day,
    round(h.bw_kg, 1), round(h.e1rm_kg, 1),
    coalesce(h.hard_flag,
      case when h.e1rm_kg > 1.35 * (case when h.lift_day = td.best1_day then td.best2 else td.best1 end)
        then 'Big jump over every other session' end),
    h.review
  from hard h
  left join top_days td on td.client_id = h.client_id and td.lift = h.lift
$$;
revoke all on function public.strength_board_sets() from public, anon, authenticated;

-- ── Coach list: current clients only ──────────────────────────────────────
create or replace function public.get_strength_board_unranked()
returns table(client_id uuid, display_name text, missing text, lifts integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  return query
  with valid as (
    select s.client_id, s.lift, s.bw_kg from public.strength_board_sets() s
    where coalesce(s.review, '') <> 'excluded' and (s.flag is null or s.review = 'approved')
  ),
  per as (
    select v.client_id, count(distinct v.lift)::int lifts, bool_or(v.bw_kg is not null) any_bw
    from valid v group by v.client_id
  )
  select c.id,
    coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || left(coalesce(c.last_name, ''), 1)), ''),
      split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)),
    m.missing,
    p.lifts
  from per p
  join public.clients c on c.id = p.client_id
    and coalesce(c.archived, false) = false and c.archived_at is null and coalesce(c.status, '') <> 'Archived'
  left join lateral (
    select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1
  ) pa on true
  cross join lateral (
    select 'bodyweight'::text missing where not p.any_bw
    union all
    select 'division' where coalesce(c.sex, pa.sex, '') !~* '^(m|f)'
  ) m
  order by 3, 2;
end;
$$;
revoke all on function public.get_strength_board_unranked() from public, anon;
grant execute on function public.get_strength_board_unranked() to authenticated, service_role;

-- ── Every qualifying meet lift (shared by the Competition and All-time boards) ─
-- Meets inside the athlete's JF coaching period(s) and country filter, one
-- row per lift made; a total only from a full-power meet.
create or replace function public.strength_board_meet_lifts()
returns table(
  result_id uuid,
  athlete_id uuid,
  entered_name text,
  lift text,
  kg numeric,
  bw_kg numeric,
  meet_date date,
  meet_name text,
  federation text,
  weight_class text,
  gl_points numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.id, m.athlete_id, nullif(trim(m.athlete_name), ''), x.lift, x.kg,
    case when m.bodyweight_kg between 30 and 250 then m.bodyweight_kg end,
    m.meet_date,
    coalesce(nullif(trim(m.meet_name), ''), nullif(trim(m.meet_location), ''), 'Meet'),
    m.federation, m.weight_class_kg,
    case when x.lift = 'total' then m.gl_points end
  from public.athlete_powerlifting_results m
  join public.powerlifting_athletes a on a.id = m.athlete_id
  cross join lateral (values
    ('squat', m.squat_kg),
    ('bench', m.bench_kg),
    ('deadlift', m.deadlift_kg),
    ('total', case when m.squat_kg > 0 and m.bench_kg > 0 and m.deadlift_kg > 0
      then coalesce(nullif(m.total_kg, 0), m.squat_kg + m.bench_kg + m.deadlift_kg) end)
  ) x(lift, kg)
  where x.kg > 0
    and exists (
      select 1 from public.powerlifting_coaching_periods p
      where p.athlete_id = m.athlete_id
        and (p.start_date is null or m.meet_date >= p.start_date)
        and (p.end_date is null or m.meet_date <= p.end_date))
    and (a.country_filter is null or m.meet_location ilike a.country_filter || '%')
$$;
revoke all on function public.strength_board_meet_lifts() from public, anon, authenticated;

-- ── Competition board: same output as before, now on the shared helper ────
create or replace function public.get_strength_board_meets(_as_user uuid default null)
returns table(
  athlete_id uuid, client_id uuid, display_name text, competed_as text, avatar_url text, is_me boolean, is_coach boolean, is_alumni boolean,
  sex text, lift text, kg numeric, meet_date date, meet_name text, federation text, weight_class text, bw_kg numeric, bw_multiple numeric, gl_points numeric,
  abs_rank integer, p4p_rank integer, all_rank integer, abs_count integer, p4p_count integer, all_count integer, athlete_meets integer, first_meet date
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  lifts as materialized (
    select l.result_id id, l.* from public.strength_board_meet_lifts() l
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
      (select count(distinct l.id) from lifts l where l.athlete_id = a.id)::int athlete_meets,
      (select min(l.meet_date) from lifts l where l.athlete_id = a.id) first_meet
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
    a.sex, p.lift, round(l.kg, 1), l.meet_date, l.meet_name, l.federation, l.weight_class,
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

-- ── All-time board: everyone JF Effect has coached, training + meets ───────
-- One spot per person per board. A person is their client (app account) or,
-- for meet-only athletes, their meet-athlete record; a linked athlete's app
-- lifts and meet results are one person. Each board takes the person's best
-- from either source: heaviest for absolute, most x bodyweight for pound for
-- pound. A training total is best squat + bench + deadlift; a meet total is
-- that meet's total (never mixed). Ties go to the meet (judged), then the
-- earlier date.
create or replace function public.get_strength_board_all(_as_user uuid default null)
returns table(
  person text,
  client_id uuid,
  athlete_id uuid,
  display_name text,
  avatar_url text,
  is_me boolean,
  is_coach boolean,
  is_alumni boolean,
  sex text,
  lift text,
  kg numeric,
  reps integer,
  source text,
  lifted_on date,
  meet_name text,
  federation text,
  bw_kg numeric,
  bw_multiple numeric,
  abs_rank integer,
  p4p_rank integer,
  all_rank integer,
  abs_count integer,
  p4p_count integer,
  all_count integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  valid as (
    select s.* from public.strength_board_sets() s
    where coalesce(s.review, '') <> 'excluded' and (s.flag is null or s.review = 'approved')
  ),
  best as (
    select distinct on (v.client_id, v.lift) v.client_id, v.lift, v.load_kg kg, v.reps, v.lift_day, v.bw_kg
    from valid v
    order by v.client_id, v.lift, v.load_kg desc, v.reps desc, v.lifted_at
  ),
  training as (
    select 'c:' || b.client_id person, b.lift, b.kg, b.reps, b.lift_day d, b.bw_kg, 'training'::text source,
      null::text meet_name, null::text federation, b.client_id::text || b.lift cand
    from best b
    union all
    select 'c:' || b.client_id, 'total', sum(b.kg), null::int, max(b.lift_day),
      case when count(b.bw_kg) = 3 then max(b.bw_kg) end, 'training', null, null, b.client_id::text || 'total'
    from best b
    group by b.client_id
    having count(*) = 3
  ),
  meet_athletes as materialized (
    select a.id, a.client_id, a.athlete_name, a.sex, lower(coalesce(a.status, 'active')) = 'retired' retired,
      case when a.client_id is not null then 'c:' || a.client_id else 'a:' || a.id end person
    from public.powerlifting_athletes a
  ),
  meets as (
    select ma.person, l.lift, l.kg, null::int reps, l.meet_date d, l.bw_kg, 'meet'::text source,
      l.meet_name, l.federation, l.result_id::text || l.lift cand
    from public.strength_board_meet_lifts() l
    join meet_athletes ma on ma.id = l.athlete_id
  ),
  cands as materialized (
    select * from training
    union all
    select * from meets
  ),
  people as materialized (
    select p.person, c.id client_id, ma.id athlete_id, c.user_id,
      case when c.id is not null then
        coalesce(nullif(trim(trim(coalesce(c.first_name, '')) || ' ' || left(trim(coalesce(c.last_name, '')), 1)), ''),
          split_part(coalesce(c.full_name, 'Athlete'), ' ', 1))
      else
        trim(split_part(trim(ma.athlete_name), ' ', 1) || ' ' || left(regexp_replace(trim(ma.athlete_name), '^.*\s', ''), 1))
      end display_name,
      pr.avatar_url,
      case when c.id is not null
        then coalesce(c.archived, false) or c.archived_at is not null or coalesce(c.status, '') = 'Archived'
        else coalesce(ma.retired, false) end is_alumni,
      case
        when lower(coalesce(c.sex, ma.sex, pa.sex, '')) like 'f%' then 'female'
        when lower(coalesce(c.sex, ma.sex, pa.sex, '')) like 'm%' then 'male'
      end sex
    from (select distinct person from cands) p
    left join public.clients c on c.id = case when p.person like 'c:%' then substr(p.person, 3)::uuid end
    left join lateral (
      select m.* from meet_athletes m where m.person = p.person order by (m.client_id is not null) desc limit 1
    ) ma on true
    left join lateral (
      select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1
    ) pa on true
    left join public.profiles pr on pr.id = c.user_id
  ),
  abs_best as (
    select distinct on (x.person, x.lift) x.person, x.lift, x.cand
    from cands x
    order by x.person, x.lift, x.kg desc, (x.source = 'meet') desc, x.d
  ),
  p4p_best as (
    select distinct on (x.person, x.lift) x.person, x.lift, x.cand, x.kg / x.bw_kg ratio
    from cands x
    where x.bw_kg is not null
    order by x.person, x.lift, x.kg / x.bw_kg desc, x.kg desc, (x.source = 'meet') desc, x.d
  ),
  abs_ranked as (
    select b.person, b.lift, b.cand,
      (row_number() over (partition by b.lift order by x.kg desc, (x.source = 'meet') desc, x.d))::int all_rank,
      (count(*) over (partition by b.lift))::int all_count,
      case when pe.sex is not null then (row_number() over (
        partition by b.lift, pe.sex is not null, pe.sex order by x.kg desc, (x.source = 'meet') desc, x.d))::int end abs_rank,
      case when pe.sex is not null then (count(*) over (partition by b.lift, pe.sex is not null, pe.sex))::int end abs_count
    from abs_best b
    join cands x on x.cand = b.cand
    join people pe on pe.person = b.person
  ),
  p4p_ranked as (
    select b.person, b.lift, b.cand,
      (row_number() over (partition by b.lift order by b.ratio desc, x.kg desc, (x.source = 'meet') desc, x.d))::int p4p_rank,
      (count(*) over (partition by b.lift))::int p4p_count
    from p4p_best b
    join cands x on x.cand = b.cand
  ),
  picked as (
    select coalesce(ar.person, pr.person) person, coalesce(ar.lift, pr.lift) lift, coalesce(ar.cand, pr.cand) cand,
      ar.abs_rank, pr.p4p_rank, ar.all_rank, ar.abs_count, pr.p4p_count, ar.all_count
    from abs_ranked ar
    full join p4p_ranked pr on pr.person = ar.person and pr.lift = ar.lift and pr.cand = ar.cand
  )
  select pe.person, pe.client_id, pe.athlete_id, pe.display_name, pe.avatar_url,
    coalesce(pe.user_id = v.uid, false), coalesce(public.community_is_coach(pe.user_id), false), pe.is_alumni,
    pe.sex, p.lift, round(x.kg, 1), x.reps, x.source, x.d, x.meet_name, x.federation,
    round(x.bw_kg, 1), round(x.kg / x.bw_kg, 2),
    p.abs_rank, p.p4p_rank, p.all_rank,
    max(p.abs_count) over (partition by p.lift, pe.sex), max(p.p4p_count) over (partition by p.lift), max(p.all_count) over (partition by p.lift)
  from picked p
  join cands x on x.cand = p.cand
  join people pe on pe.person = p.person
  cross join viewer v
  where v.uid is not null
  order by p.lift, p.all_rank nulls last, p.p4p_rank
$$;
revoke all on function public.get_strength_board_all(uuid) from public, anon;
grant execute on function public.get_strength_board_all(uuid) to authenticated, service_role;
