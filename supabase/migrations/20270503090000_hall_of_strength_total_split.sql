-- Hall of Strength: what each total is made of.
--
-- Both boards now say, on every total row, the squat, bench and deadlift that
-- add up to it, so the app can show the split (squat / bench / deadlift as a
-- share of the total) and compare two lifters from exactly the numbers on the
-- board:
--   * a training total is the athlete's best squat + best bench + best
--     deadlift from training (the three `best` rows, with their reps: a ×5
--     counts as lifted, like the board);
--   * a meet total is that day's squat, bench and deadlift
--     (athlete_powerlifting_results), all singles.
-- get_strength_board_all() also returns the meet's official GL points on a
-- meet total (strength_board_meet_lifts already reads them), so a meet total
-- is never shown with a points figure worked out in the app.
--
-- Only columns are added (at the end); every existing column, rank and row is
-- unchanged, so older apps read the boards exactly as before. Return types
-- change, so each function is dropped and created again (nothing depends on
-- them) with the same grants. The bodies are the production definitions as of
-- Nov 22 2026 (community photos, 20270108090000) plus the new columns.

begin;

set local lock_timeout = '5s';

drop function if exists public.get_strength_board_all(uuid);

create function public.get_strength_board_all(_as_user uuid default null)
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
  all_count integer,
  squat_kg numeric,
  bench_kg numeric,
  deadlift_kg numeric,
  squat_reps integer,
  bench_reps integer,
  deadlift_reps integer,
  gl_points numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
      null::text meet_name, null::text federation, b.client_id::text || b.lift cand,
      null::numeric squat_kg, null::numeric bench_kg, null::numeric deadlift_kg,
      null::int squat_reps, null::int bench_reps, null::int deadlift_reps, null::numeric gl_points
    from best b
    union all
    select 'c:' || b.client_id, 'total', sum(b.kg), null::int, max(b.lift_day),
      case when count(b.bw_kg) = 3 then max(b.bw_kg) end, 'training', null, null, b.client_id::text || 'total',
      max(b.kg) filter (where b.lift = 'squat'), max(b.kg) filter (where b.lift = 'bench'), max(b.kg) filter (where b.lift = 'deadlift'),
      max(b.reps) filter (where b.lift = 'squat'), max(b.reps) filter (where b.lift = 'bench'), max(b.reps) filter (where b.lift = 'deadlift'),
      null::numeric
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
      l.meet_name, l.federation, l.result_id::text || l.lift cand,
      r.squat_kg, r.bench_kg, r.deadlift_kg, null::int, null::int, null::int,
      case when l.lift = 'total' then l.gl_points end
    from public.strength_board_meet_lifts() l
    join meet_athletes ma on ma.id = l.athlete_id
    left join public.athlete_powerlifting_results r on r.id = l.result_id and l.lift = 'total'
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
      public.community_avatar(pr.id) AS avatar_url,
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
    max(p.abs_count) over (partition by p.lift, pe.sex), max(p.p4p_count) over (partition by p.lift), max(p.all_count) over (partition by p.lift),
    round(x.squat_kg, 1), round(x.bench_kg, 1), round(x.deadlift_kg, 1),
    x.squat_reps, x.bench_reps, x.deadlift_reps, round(x.gl_points, 2)
  from picked p
  join cands x on x.cand = p.cand
  join people pe on pe.person = p.person
  cross join viewer v
  where v.uid is not null
  order by p.lift, p.all_rank nulls last, p.p4p_rank
$function$;

revoke all on function public.get_strength_board_all(uuid) from public, anon;
grant execute on function public.get_strength_board_all(uuid) to authenticated, service_role;

drop function if exists public.get_strength_board_meets(uuid);

create function public.get_strength_board_meets(_as_user uuid default null)
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
  first_meet date,
  squat_kg numeric,
  bench_kg numeric,
  deadlift_kg numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  lifts as materialized (
    select l.result_id id, l.* from public.strength_board_meet_lifts() l
  ),
  athletes as materialized (
    select a.id athlete_id, c.id client_id, c.user_id,
      coalesce(nullif(regexp_replace(trim(coalesce(c.full_name, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')))), '\s+', ' ', 'g'), ''),
        a.athlete_name) display_name,
      a.athlete_name,
      public.community_avatar(pr.id) AS avatar_url,
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
    a.athlete_meets, a.first_meet,
    round(r.squat_kg, 1), round(r.bench_kg, 1), round(r.deadlift_kg, 1)
  from picked p
  join lifts l on l.id = p.id and l.lift = p.lift
  join athletes a on a.athlete_id = p.athlete_id
  left join public.athlete_powerlifting_results r on r.id = l.id and p.lift = 'total'
  cross join viewer v
  where v.uid is not null
  order by p.lift, p.all_rank nulls last, p.p4p_rank
$function$;

revoke all on function public.get_strength_board_meets(uuid) from public, anon;
grant execute on function public.get_strength_board_meets(uuid) to authenticated, service_role;

commit;
