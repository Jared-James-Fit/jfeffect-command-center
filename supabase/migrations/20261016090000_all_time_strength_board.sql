-- All-Time Strength Board: the strongest lifters in JF Effect since launch,
-- from lifts logged in the app (never meet results or coach-entered maxes).
--
-- What counts
--   * Exercises tagged in the library as competition lifts
--     (exercises.is_competition_lift + competition_lift_type squat/bench/deadlift).
--     Tag another exercise (e.g. a conventional deadlift) to make it count.
--   * Completed working sets with external load, at least 1 rep.
--   * The value is the heaviest weight actually lifted. No estimated maxes.
--   * Total = best squat + best bench + best deadlift.
--
-- Two boards
--   * Absolute: heaviest weight, Men and Women divisions.
--   * Pound for pound: one board for everyone, ranked by DOTS (the score
--     powerlifting uses to compare lifters of any bodyweight and sex), shown
--     as "x bodyweight". Bodyweight is the log closest to the lift (within
--     30 days), so cutting after a PR can't inflate it. For a total, the
--     heaviest of the three lifts' bodyweights is used (conservative).
--
-- Typo shield: a set is held back (not deleted) when it is heavier than the
-- raw world record, too many times bodyweight to be real, or a big jump
-- (>35% e1RM) over every other session of that lift. A coach can approve a
-- held-back lift or remove any lift; the athlete's next best takes its place.
--
-- Only the top 10 of each board plus the viewer's own entries are returned.

-- ── Coach decisions on individual sets ────────────────────────────────────
create table if not exists public.strength_board_reviews (
  result_id uuid primary key references public.pl_row_results(id) on delete cascade,
  status text not null check (status in ('approved', 'excluded')),
  reviewed_by uuid,
  reviewed_at timestamptz not null default now()
);
alter table public.strength_board_reviews enable row level security;
revoke all on public.strength_board_reviews from anon, authenticated;
grant all on public.strength_board_reviews to service_role;

-- ── Every competition-lift set, with bodyweight and the typo check ────────
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
  with sets as (
    select r.id result_id, r.client_id, e.competition_lift_type lift,
      coalesce(r.normalized_kg, r.actual_load_kg,
        case when lower(coalesce(r.actual_load_unit, r.entered_unit)) = 'lb'
          then coalesce(r.actual_load, r.entered_value) * 0.45359237
          else coalesce(r.actual_load, r.entered_value) end) load_kg,
      r.actual_reps::int reps,
      r.completed_at lifted_at,
      (r.completed_at at time zone public.league_tz())::date lift_day
    from public.pl_row_results r
    join public.pl_exercise_rows er on er.id = r.row_id
    join public.exercises e on e.id = er.exercise_id
    join public.clients c on c.id = r.client_id
    where e.is_competition_lift
      and e.competition_lift_type in ('squat', 'bench', 'deadlift')
      and r.completed_at is not null
      and r.actual_reps >= 1
      and coalesce(r.load_type, 'external') = 'external'
      and coalesce(r.is_bodyweight, false) = false
      and coalesce(r.is_working_set, true)
      and coalesce(c.archived, false) = false and c.archived_at is null and coalesce(c.status, '') <> 'Archived'
  ),
  bodyweights as (
    -- Both bodyweight sources, in kg, ignoring impossible entries.
    select c.id client_id, x.d, x.kg
    from public.clients c
    cross join lateral (
      select pb.logged_date d,
        pb.weight_value * case when lower(coalesce(pb.weight_unit, 'lb')) = 'kg' then 1 else 0.45359237 end kg
      from public.progress_bodyweight pb
      where pb.user_id = c.user_id and pb.weight_value > 0
      union all
      select pm.entry_date,
        pm.bodyweight * case when lower(coalesce(pm.bodyweight_unit, 'lb')) = 'kg' then 1 else 0.45359237 end
      from public.progress_metrics pm
      where pm.client_id = c.id and pm.bodyweight > 0
    ) x
    where x.kg between 30 and 250
  ),
  checked as (
    select s.*, b.kg bw_kg,
      s.load_kg * 36.0 / (37 - least(s.reps, 12)) e1rm_kg
    from sets s
    left join lateral (
      select bw.kg from bodyweights bw
      where bw.client_id = s.client_id and abs(bw.d - s.lift_day) <= 30
      order by abs(bw.d - s.lift_day), bw.d <= s.lift_day desc
      limit 1
    ) b on true
    where s.load_kg > 0
  ),
  hard as (
    select c.*, rv.status review,
      case
        when c.e1rm_kg > case c.lift when 'squat' then 500 when 'bench' then 360 else 470 end
          then 'Heavier than the world record'
        when c.bw_kg is not null
          and c.e1rm_kg / c.bw_kg > case c.lift when 'squat' then 4.0 when 'bench' then 3.0 else 4.5 end
          then 'Too many times bodyweight to be real'
      end hard_flag
    from checked c
    left join public.strength_board_reviews rv on rv.result_id = c.result_id
  )
  select h.result_id, h.client_id, h.lift, round(h.load_kg, 2), h.reps, h.lifted_at, h.lift_day,
    round(h.bw_kg, 1), round(h.e1rm_kg, 1),
    coalesce(h.hard_flag,
      case when h.e1rm_kg > 1.35 * (
        select max(o.e1rm_kg) from hard o
        where o.client_id = h.client_id and o.lift = h.lift and o.lift_day <> h.lift_day
          and o.hard_flag is null and coalesce(o.review, '') <> 'excluded')
      then 'Big jump over every other session' end),
    h.review
  from hard h
$$;
revoke all on function public.strength_board_sets() from public, anon, authenticated;

-- ── The board ─────────────────────────────────────────────────────────────
create or replace function public.get_strength_board(_as_user uuid default null)
returns table(
  client_id uuid,
  display_name text,
  avatar_url text,
  is_me boolean,
  is_coach boolean,
  sex text,
  lift text,
  kg numeric,
  reps integer,
  lifted_at timestamptz,
  bw_kg numeric,
  bw_multiple numeric,
  dots numeric,
  abs_rank integer,
  p4p_rank integer,
  abs_count integer,
  p4p_count integer
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
    -- Heaviest weight per athlete per lift; more reps, then the earlier date, break ties.
    select distinct on (v.client_id, v.lift) v.client_id, v.lift, v.load_kg kg, v.reps, v.lifted_at, v.bw_kg
    from valid v
    order by v.client_id, v.lift, v.load_kg desc, v.reps desc, v.lifted_at
  ),
  totals as (
    select b.client_id, 'total'::text lift, sum(b.kg) kg, null::integer reps, max(b.lifted_at) lifted_at,
      case when count(b.bw_kg) = 3 then max(b.bw_kg) end bw_kg
    from best b
    group by b.client_id
    having count(*) = 3
  ),
  entries as (
    select * from best
    union all
    select * from totals
  ),
  athletes as (
    select c.id client_id, c.user_id,
      coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || left(coalesce(c.last_name, ''), 1)), ''),
        split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)) display_name,
      p.avatar_url,
      -- The athlete's own answer wins ("prefer not to say" stays unranked);
      -- otherwise the curated powerlifting profile.
      case
        when lower(coalesce(c.sex, pa.sex, '')) like 'f%' then 'female'
        when lower(coalesce(c.sex, pa.sex, '')) like 'm%' then 'male'
      end sex
    from public.clients c
    left join public.profiles p on p.id = c.user_id
    left join lateral (
      select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1
    ) pa on true
  ),
  scored as (
    select e.*, a.user_id, a.display_name, a.avatar_url, a.sex,
      round(e.kg / nullif(e.bw_kg, 0), 2) bw_multiple,
      case when a.sex is not null then public.dots_points(a.sex, e.bw_kg, e.kg) end dots
    from entries e
    join athletes a on a.client_id = e.client_id
  ),
  ranked as (
    select s.*,
      case when s.sex is not null then (row_number() over (
        partition by s.lift, s.sex is not null, s.sex
        order by s.kg desc, s.reps desc nulls last, s.lifted_at))::integer end abs_rank,
      case when s.dots is not null then (row_number() over (
        partition by s.lift, s.dots is not null
        order by s.dots desc, s.lifted_at))::integer end p4p_rank,
      case when s.sex is not null then (count(*) over (partition by s.lift, s.sex is not null, s.sex))::integer end abs_count,
      case when s.dots is not null then (count(*) over (partition by s.lift, s.dots is not null))::integer end p4p_count
    from scored s
  )
  select r.client_id, r.display_name, r.avatar_url, (r.user_id = v.uid), public.community_is_coach(r.user_id),
    r.sex, r.lift, round(r.kg, 1), r.reps, r.lifted_at, r.bw_kg, r.bw_multiple, r.dots,
    r.abs_rank, r.p4p_rank, r.abs_count, r.p4p_count
  from ranked r, viewer v
  where v.uid is not null
    and (r.abs_rank <= 10 or r.p4p_rank <= 10 or r.user_id = v.uid)
  order by r.lift, r.p4p_rank nulls last, r.abs_rank nulls last
$$;
revoke all on function public.get_strength_board(uuid) from public, anon;
grant execute on function public.get_strength_board(uuid) to authenticated, service_role;

-- ── Coach review ──────────────────────────────────────────────────────────
-- Lifts the typo shield held back, plus anything a coach already decided on.
-- One line per athlete / lift / day / weight (a typo is usually copied across
-- every set), and only when it's heavier than that athlete's counted best.
create or replace function public.get_strength_board_review()
returns table(
  result_id uuid,
  client_id uuid,
  display_name text,
  lift text,
  load_kg numeric,
  reps integer,
  sets integer,
  lift_day date,
  bw_kg numeric,
  flag text,
  review text,
  counted_best_kg numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  return query
  with s as (select * from public.strength_board_sets()),
  counted as (
    select x.client_id, x.lift, max(x.load_kg) best
    from s x
    where coalesce(x.review, '') <> 'excluded' and (x.flag is null or x.review = 'approved')
    group by 1, 2
  ),
  grouped as (
    select x.client_id, x.lift, x.lift_day, x.load_kg,
      (array_agg(x.result_id order by x.lifted_at))[1] result_id,
      max(x.reps) reps, count(*)::int sets, max(x.bw_kg) bw_kg,
      max(x.flag) flag, max(x.review) review
    from s x
    where x.flag is not null or x.review is not null
    group by 1, 2, 3, 4
  )
  select g.result_id, g.client_id,
    coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || left(coalesce(c.last_name, ''), 1)), ''),
      split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)),
    g.lift, g.load_kg, g.reps, g.sets, g.lift_day, g.bw_kg, g.flag, g.review, ct.best
  from grouped g
  join public.clients c on c.id = g.client_id
  left join counted ct on ct.client_id = g.client_id and ct.lift = g.lift
  where g.review is not null or ct.best is null or g.load_kg > ct.best
  order by (g.review is null) desc, g.load_kg desc;
end;
$$;
revoke all on function public.get_strength_board_review() from public, anon;
grant execute on function public.get_strength_board_review() to authenticated, service_role;

-- Approve ('approved'), remove ('excluded') or undo ('clear') a lift. Applies to
-- every set of that lift by that athlete on that day at that weight.
create or replace function public.strength_board_review(_result_id uuid, _status text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  n integer;
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  if _status not in ('approved', 'excluded', 'clear') then raise exception 'Invalid status'; end if;

  select x.client_id, x.lift, x.lift_day, x.load_kg into t
  from public.strength_board_sets() x where x.result_id = _result_id;
  if t.client_id is null then raise exception 'Lift not found'; end if;

  if _status = 'clear' then
    delete from public.strength_board_reviews rv
    using public.strength_board_sets() x
    where rv.result_id = x.result_id
      and x.client_id = t.client_id and x.lift = t.lift and x.lift_day = t.lift_day and x.load_kg = t.load_kg;
    get diagnostics n = row_count;
  else
    insert into public.strength_board_reviews (result_id, status, reviewed_by, reviewed_at)
    select x.result_id, _status, auth.uid(), now()
    from public.strength_board_sets() x
    where x.client_id = t.client_id and x.lift = t.lift and x.lift_day = t.lift_day and x.load_kg = t.load_kg
    on conflict (result_id) do update set status = excluded.status, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;
revoke all on function public.strength_board_review(uuid, text) from public, anon;
grant execute on function public.strength_board_review(uuid, text) to authenticated, service_role;

-- Athletes with counted lifts who can't rank yet, so a coach can fix it:
-- 'division' = sex not set (no board at all), 'bodyweight' = no bodyweight
-- near their lifts (absolute only, no pound for pound).
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
    case
      when coalesce(c.sex, pa.sex, '') !~* '^(m|f)' then 'division'
      else 'bodyweight'
    end,
    p.lifts
  from per p
  join public.clients c on c.id = p.client_id
  left join lateral (
    select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1
  ) pa on true
  where coalesce(c.sex, pa.sex, '') !~* '^(m|f)' or not p.any_bw
  order by 3, 2;
end;
$$;
revoke all on function public.get_strength_board_unranked() from public, anon;
grant execute on function public.get_strength_board_unranked() to authenticated, service_role;

-- Each athlete's counted best set per lift, so a coach can remove one that
-- passed the typo check but is wrong.
create or replace function public.get_strength_board_tops()
returns table(result_id uuid, client_id uuid, display_name text, lift text, load_kg numeric, reps integer, lift_day date)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  return query
  select b.result_id, b.client_id,
    coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || left(coalesce(c.last_name, ''), 1)), ''),
      split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)),
    b.lift, b.load_kg, b.reps, b.lift_day
  from (
    select distinct on (s.client_id, s.lift) s.*
    from public.strength_board_sets() s
    where coalesce(s.review, '') <> 'excluded' and (s.flag is null or s.review = 'approved')
    order by s.client_id, s.lift, s.load_kg desc, s.reps desc, s.lifted_at
  ) b
  join public.clients c on c.id = b.client_id
  order by b.lift, b.load_kg desc;
end;
$$;
revoke all on function public.get_strength_board_tops() from public, anon;
grant execute on function public.get_strength_board_tops() to authenticated, service_role;
