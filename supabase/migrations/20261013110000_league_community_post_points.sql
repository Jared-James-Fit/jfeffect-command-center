-- Community posts earn Performance League points, Logging Level XP and badges.
--
-- League: +15 for sharing a completed workout to the Community feed, 1 a day,
-- up to 2 a week (Mon–Sun, league timezone). Lifetime (Logging Level): +40 XP
-- per posting day, and +5 XP the first time you comment on a teammate's post.
--
-- Anti-spam, all enforced in the database:
--   * a client post is always tied to one workout (community_posts_one_per_completion),
--     so you can't post more than you train;
--   * only posts the community can see count: visibility 'community', not
--     archived, and the workout actually completed (a lock-in post earns when
--     the session is finished; starting sessions to post earns nothing);
--   * the workout must be recent (completed within 7 days of the post), so a
--     backlog of old sessions can't be drip-fed for points;
--   * one ledger event per athlete per day (source_key community_post:<day>),
--     and the league caps scoring posts at 2 a week;
--   * deleting, archiving or hiding the post takes the points back (a coach
--     deleting a spam post removes them too); restoring it re-earns them.
--   * comments: one event per post you comment on, never on your own post, and
--     coaches' comments don't earn (that's coaching, not competing).
--
-- Points live only in athlete_xp_events, written by triggers (AGENTS.md).
-- Additive for the app: league functions gain trailing columns only.

-- ── Ledger sync: posts ────────────────────────────────────────────────────
create or replace function public.community_post_xp_sync(_client uuid, _day date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k text := 'community_post:' || _day::text;
  v_id uuid;
  v_at timestamptz;
begin
  if _client is null or _day is null then return; end if;

  select cp.id, cp.created_at into v_id, v_at
  from public.community_posts cp
  join public.pl_day_completions pc on pc.id = cp.completion_id
  where cp.client_id = _client
    and cp.kind = 'workout'
    and cp.visibility = 'community'
    and cp.archived_at is null
    and pc.completed_at is not null
    and pc.completed_at >= cp.created_at - interval '7 days'
    and (cp.created_at at time zone public.league_tz())::date = _day
  order by cp.created_at, cp.id
  limit 1;

  if not found then
    delete from public.athlete_xp_events where client_id = _client and source_key = k;
    return;
  end if;

  perform public.award_athlete_xp(_client, 'community_post', 'community_posts', v_id, k, 40,
    'Shared a workout to the Community', v_at);
  -- The day's event follows whichever eligible post came first.
  update public.athlete_xp_events set source_id = v_id, occurred_at = v_at
   where client_id = _client and source_key = k and source_id is distinct from v_id;
end;
$$;
revoke all on function public.community_post_xp_sync(uuid, date) from public, anon, authenticated;

create or replace function public.xp_on_community_post()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.client_id is not null then
    perform public.community_post_xp_sync(old.client_id, (old.created_at at time zone public.league_tz())::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.client_id is not null then
    perform public.community_post_xp_sync(new.client_id, (new.created_at at time zone public.league_tz())::date);
  end if;
  return null;
exception when others then
  raise warning 'xp_on_community_post: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists trg_xp_community_post on public.community_posts;
create trigger trg_xp_community_post
after insert or update of visibility, archived_at, kind, client_id or delete on public.community_posts
for each row execute function public.xp_on_community_post();

-- A lock-in post earns once its workout is completed (and loses it if the
-- completion is undone).
create or replace function public.xp_on_completion_community_post()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare p record;
begin
  if new.completed_at is distinct from old.completed_at then
    for p in select cp.client_id, cp.created_at from public.community_posts cp
              where cp.completion_id = new.id and cp.client_id is not null loop
      perform public.community_post_xp_sync(p.client_id, (p.created_at at time zone public.league_tz())::date);
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'xp_on_completion_community_post: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists trg_xp_completion_community_post on public.pl_day_completions;
create trigger trg_xp_completion_community_post
after update of completed_at on public.pl_day_completions
for each row execute function public.xp_on_completion_community_post();

-- ── Ledger sync: comments ─────────────────────────────────────────────────
create or replace function public.community_comment_xp_sync(_user uuid, _post uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_client uuid := public.xp_client_for_user(_user);
  k text := 'community_comment:' || _post::text;
  v_id uuid;
  v_at timestamptz;
begin
  if v_client is null or _post is null then return; end if;

  if not public.community_is_coach(_user) then
    select cc.id, cc.created_at into v_id, v_at
    from public.community_comments cc
    join public.community_posts p on p.id = cc.post_id
    where cc.post_id = _post and cc.author_user_id = _user
      and public.community_main_account(p.author_user_id) <> public.community_main_account(_user)
    order by cc.created_at, cc.id
    limit 1;
  end if;

  if v_id is null then
    delete from public.athlete_xp_events where client_id = v_client and source_key = k;
    return;
  end if;

  perform public.award_athlete_xp(v_client, 'community_comment', 'community_comments', v_id, k, 5,
    'Commented on a teammate''s post', v_at);
  update public.athlete_xp_events set source_id = v_id, occurred_at = v_at
   where client_id = v_client and source_key = k and source_id is distinct from v_id;
end;
$$;
revoke all on function public.community_comment_xp_sync(uuid, uuid) from public, anon, authenticated;

create or replace function public.xp_on_community_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    perform public.community_comment_xp_sync(old.author_user_id, old.post_id);
  else
    perform public.community_comment_xp_sync(new.author_user_id, new.post_id);
  end if;
  return null;
exception when others then
  raise warning 'xp_on_community_comment: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists trg_xp_community_comment on public.community_comments;
create trigger trg_xp_community_comment
after insert or delete on public.community_comments
for each row execute function public.xp_on_community_comment();

-- ── League scoring: community points (+15, 1 a day, 2 a week) ─────────────
-- Return type changes (two trailing columns), so drop and recreate. Callers
-- read columns by name, so they're unaffected.
drop function if exists public.league_month_scores(date, timestamptz);
create function public.league_month_scores(_month date default null, _now timestamptz default now())
returns table(
  client_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  qualified boolean,
  bodyweight_value numeric,
  bodyweight_unit text,
  bodyweight_logged_at date,
  workouts_completed integer,
  fully_logged integer,
  bodyweight_logs integer,
  improved_exercises integer,
  workout_points integer,
  logging_points integer,
  bodyweight_points integer,
  improvement_points integer,
  atpr_lifts integer,
  program_pr_lifts integer,
  block_pr_lifts integer,
  last_record_at timestamptz,
  base_total integer,
  match_points integer,
  total_points integer,
  rank integer,
  eligible_workouts integer,
  completed_eligible integer,
  adherence_pct numeric,
  needed_workouts integer,
  open_workouts integer,
  boost_possible boolean,
  boost_qualified boolean,
  legit_workout_points integer,
  ceiling_points integer,
  coverage numeric,
  match_target integer,
  projected_match integer,
  projected_total integer,
  boost_status text,
  boost_reason text,
  finalized boolean,
  month_start date,
  final_week_start date,
  is_final_week boolean,
  month_closed boolean,
  community_posts integer,
  community_points integer
)
language sql stable security definer set search_path to 'public' as $function$
with bounds as (select * from public.league_month_bounds(_month, _now)),
flags as (
  select b.*,
    (_now >= b.end_at) month_closed,
    (_now >= b.freeze_at and _now < b.end_at) is_final_week,
    exists (select 1 from public.league_month_awards a where a.league_month = b.month_start) finalized
  from bounds b
),
base as (
  select c.id client_id, c.user_id,
    coalesce(nullif(trim(coalesce(c.first_name,'')||' '||left(coalesce(c.last_name,''),1)),''),split_part(coalesce(c.full_name,'Athlete'),' ',1)) display_name,
    p.avatar_url,
    (c.created_at at time zone public.league_tz())::date joined_on
  from public.clients c left join public.profiles p on p.id = c.user_id
  where coalesce(c.archived,false) = false and c.archived_at is null and coalesce(c.status,'') <> 'Archived'
),
bodyweight_sources as (
  select pb.user_id, pb.weight_value, pb.weight_unit, pb.logged_date, pb.created_at
  from public.progress_bodyweight pb where pb.weight_value is not null and pb.weight_value > 0
  union all
  select c.user_id, pm.bodyweight, coalesce(pm.bodyweight_unit,'lb'), pm.entry_date, pm.created_at
  from public.progress_metrics pm join public.clients c on c.id = pm.client_id
  where pm.bodyweight is not null and pm.bodyweight > 0
),
current_bw as (
  select distinct on (bs.user_id) bs.user_id, bs.weight_value, bs.weight_unit, bs.logged_date
  from bodyweight_sources bs order by bs.user_id, bs.logged_date desc, bs.created_at desc
),
-- Points earned this month. A session completed twice (legacy duplicate
-- completion rows) only ever scores once: count distinct sessions.
events as (
  select e.client_id, e.event_type, e.occurred_at, coalesce(dc.day_id, e.source_id) unit_id
  from public.athlete_xp_events e
  left join public.pl_day_completions dc on dc.id = e.source_id and e.event_type in ('workout_completed','workout_fully_logged')
  cross join flags f
  where e.occurred_at >= f.start_at and e.occurred_at < f.end_at and e.occurred_at <= _now
    and e.event_type in ('workout_completed','workout_fully_logged','bodyweight')
),
event_counts as (
  select ev.client_id,
    count(distinct ev.unit_id) filter (where ev.event_type = 'workout_completed')::int workouts_completed,
    count(distinct ev.unit_id) filter (where ev.event_type = 'workout_fully_logged')::int fully_logged,
    count(distinct (ev.occurred_at at time zone public.league_tz())::date) filter (where ev.event_type = 'bodyweight')::int bodyweight_logs
  from events ev group by ev.client_id
),
valid_sets as (
  select r.client_id, er.exercise_id, r.completed_at,
    (coalesce(r.normalized_kg, r.actual_load_kg,
      case when lower(coalesce(r.actual_load_unit, r.entered_unit)) = 'lb'
        then coalesce(r.actual_load, r.entered_value) * 0.45359237
        else coalesce(r.actual_load, r.entered_value) end)
      * 36.0 / (37.0 - r.actual_reps)) e1rm_kg
  from public.pl_row_results r join public.pl_exercise_rows er on er.id = r.row_id
  where er.exercise_id is not null and coalesce(r.is_working_set,true) = true
    and coalesce(r.load_type,'external') = 'external' and r.actual_reps between 1 and 12
    and r.completed_at is not null and r.completed_at <= _now
    and coalesce(r.normalized_kg, r.actual_load_kg, r.actual_load, r.entered_value) > 0
),
improvements as (
  select cur.client_id, count(*)::int improved_exercises
  from (select s.client_id, s.exercise_id, max(s.e1rm_kg) e1rm from valid_sets s, flags f
        where s.completed_at >= f.start_at and s.completed_at < f.end_at group by 1,2) cur
  join (select s.client_id, s.exercise_id, max(s.e1rm_kg) e1rm from valid_sets s, flags f
        where s.completed_at < f.start_at group by 1,2) pri using (client_id, exercise_id)
  where pri.e1rm > 0 and cur.e1rm > pri.e1rm + 0.05
  group by cur.client_id
),
-- Training records (from Oct 2026): best record per lift per month — rep
-- records and weight records both count, but each lift scores once —
-- ATPR +10, PROGRAM PR +5, BLOCK PR +3 — capped at 40 per month. Only
-- completed workouts count, and a record must beat an earlier logged
-- performance, so first exposures and in-progress sets never score.
record_lifts as (
  select c.client_id, r.exercise_key,
    case when bool_or(r.is_atpr) then 3 when bool_or(r.is_program_pr) then 2 when bool_or(r.is_block_pr) then 1 else 0 end tier,
    max(r.workout_at) filter (where r.is_atpr or r.is_program_pr or r.is_block_pr) record_at
  from base c cross join flags f
  cross join lateral (
    select x.exercise_key, x.completed, x.workout_at, x.is_atpr, x.is_program_pr, x.is_block_pr
      from public.client_rep_records(c.client_id) x
    union all
    select y.exercise_key, y.completed, y.workout_at, y.is_atpr, y.is_program_pr, y.is_block_pr
      from public.client_load_records(c.client_id) y
  ) r
  where f.month_start >= public.league_records_start_month()
    and r.completed and r.workout_at >= f.start_at and r.workout_at < f.end_at and r.workout_at <= _now
  group by c.client_id, r.exercise_key
),
records as (
  select rl.client_id,
    count(*) filter (where rl.tier = 3)::int atpr_lifts,
    count(*) filter (where rl.tier = 2)::int program_pr_lifts,
    count(*) filter (where rl.tier = 1)::int block_pr_lifts,
    least(40, sum(case rl.tier when 3 then 10 when 2 then 5 when 1 then 3 else 0 end))::int record_points,
    count(*) filter (where rl.tier > 0)::int record_lift_count,
    max(rl.record_at) last_record_at
  from record_lifts rl group by rl.client_id
),
-- Community: sharing a completed workout to the Community feed. The ledger
-- already holds at most one community_post event per athlete per day (DB
-- trigger, source_key per day); points count up to 2 a week (Mon–Sun, league
-- timezone), +15 each.
community as (
  select w.client_id, sum(least(2, w.n))::int community_posts
  from (
    select e.client_id, date_trunc('week', e.occurred_at at time zone public.league_tz()) wk, count(*) n
    from public.athlete_xp_events e cross join flags f
    where e.event_type = 'community_post'
      and e.occurred_at >= f.start_at and e.occurred_at < f.end_at and e.occurred_at <= _now
    group by 1, 2
  ) w
  group by w.client_id
),
-- Adherence ledger for the month.
ledger as (
  select s.client_id, s.day_id,
    (s.excused_at is not null) excused,
    (s.removed_at is not null) removed,
    exists (
      select 1 from public.pl_day_completions dc
      where dc.day_id = s.day_id and dc.client_id = s.client_id
        and dc.completed_at is not null and dc.completed_at < f.end_at and dc.completed_at <= _now
    ) done,
    exists (
      select 1 from public.pl_day_completions dc
      where dc.day_id = s.day_id and dc.client_id = s.client_id
        and dc.completed_at >= f.start_at and dc.completed_at < f.end_at and dc.completed_at <= _now
    ) done_in_month
  from public.league_prescription_snapshots s cross join flags f
  where s.league_month = f.month_start
    and s.first_seen_at < f.freeze_at
    and (s.removed_at is null or (s.locked_at is not null and s.locked_at <= s.removed_at))
),
adherence as (
  select l.client_id,
    count(*) filter (where not l.excused or l.done)::int eligible_workouts,
    count(*) filter (where l.done)::int completed_eligible,
    count(*) filter (where l.done_in_month)::int legit_completed,
    -- Still completable this month: not done, not excused, still on the program.
    count(*) filter (where not l.done and not l.excused and not l.removed)::int open_workouts
  from ledger l group by l.client_id
),
assembled as (
  select b.client_id, b.user_id, b.display_name, b.avatar_url, b.joined_on,
    (cb.logged_date is not null) qualified,
    cb.weight_value, cb.weight_unit, cb.logged_date,
    coalesce(ec.workouts_completed,0) workouts_completed,
    coalesce(ec.fully_logged,0) fully_logged,
    coalesce(ec.bodyweight_logs,0) bodyweight_logs,
    case when f.month_start >= public.league_records_start_month()
      then coalesce(rec.record_lift_count,0) else coalesce(i.improved_exercises,0) end improved_exercises,
    case when f.month_start >= public.league_records_start_month()
      then coalesce(rec.record_points,0) else coalesce(i.improved_exercises,0) * 5 end record_or_improvement_points,
    coalesce(rec.atpr_lifts,0) atpr_lifts,
    coalesce(rec.program_pr_lifts,0) program_pr_lifts,
    coalesce(rec.block_pr_lifts,0) block_pr_lifts,
    rec.last_record_at,
    coalesce(a.eligible_workouts,0) eligible_workouts,
    coalesce(a.completed_eligible,0) completed_eligible,
    coalesce(a.legit_completed,0) legit_completed,
    coalesce(a.open_workouts,0) open_workouts,
    coalesce(cm.community_posts,0) community_posts
  from base b
  left join current_bw cb on cb.user_id = b.user_id
  left join event_counts ec on ec.client_id = b.client_id
  left join improvements i on i.client_id = b.client_id
  left join records rec on rec.client_id = b.client_id
  left join adherence a on a.client_id = b.client_id
  left join community cm on cm.client_id = b.client_id
  cross join flags f
),
pointed as (
  select x.*,
    x.workouts_completed * 10 workout_points,
    x.fully_logged * 5 logging_points,
    x.bodyweight_logs * 5 bodyweight_points,
    x.record_or_improvement_points improvement_points,
    x.community_posts * 15 community_points,
    least(x.workouts_completed, x.legit_completed) * 10 legit_workout_points,
    -- 90% target, integer math: ceil(eligible * 0.9)
    greatest(0, (x.eligible_workouts * 9 + 9) / 10 - x.completed_eligible) needed_workouts
  from assembled x
),
ceiling as (
  -- Highest legitimate workout total among athletes on the board.
  select coalesce(max(p.legit_workout_points) filter (where p.qualified), 0) ceiling_points from pointed p
),
boosted as (
  select p.*, c.ceiling_points, f.*,
    case when p.joined_on > f.month_start
      then round(greatest(0, f.month_end - p.joined_on + 1)::numeric / f.days_in_month, 4)
      else 1::numeric end coverage,
    greatest(1, ceil(public.league_min_prescribed() *
      case when p.joined_on > f.month_start
        then greatest(0, f.month_end - p.joined_on + 1)::numeric / f.days_in_month else 1 end))::int min_prescribed
  from pointed p cross join ceiling c cross join flags f
),
eligibility as (
  select bo.*,
    (bo.eligible_workouts >= bo.min_prescribed and bo.needed_workouts = 0) boost_qualified,
    (bo.eligible_workouts >= bo.min_prescribed and bo.needed_workouts = 0)
      or (bo.eligible_workouts >= bo.min_prescribed and not bo.month_closed and bo.needed_workouts <= bo.open_workouts) boost_possible
  from boosted bo
),
targeted as (
  select bo.*,
    -- Mid-month joiners match a prorated ceiling (whole multiple of 5).
    (floor(bo.ceiling_points * bo.coverage / 5) * 5)::int match_target,
    bo.workout_points + bo.logging_points + bo.bodyweight_points + bo.improvement_points + bo.community_points base_total
  from eligibility bo
),
finalized_awards as (
  select a.client_id, a.match_points from public.league_month_awards a, flags f where a.league_month = f.month_start
),
final as (
  select t.*,
    coalesce(fa.match_points, 0) awarded_match,
    case when t.boost_possible
      then greatest(0, t.match_target - (t.workout_points + 10 * t.needed_workouts)) else 0 end projected_match
  from targeted t left join finalized_awards fa on fa.client_id = t.client_id
),
scored as (
  select fi.*,
    fi.base_total + fi.awarded_match total_points,
    case when fi.boost_possible
      then fi.base_total + 10 * fi.needed_workouts + fi.projected_match end projected_total,
    case
      when fi.eligible_workouts < fi.min_prescribed then 'none'
      when fi.boost_qualified then 'ready'
      when not fi.boost_possible then 'out'
      else 'chasing' end boost_status,
    case
      when fi.eligible_workouts = 0 then 'No prescribed workouts recorded for this month'
      when fi.eligible_workouts < fi.min_prescribed then 'Fewer than ' || fi.min_prescribed || ' prescribed workouts this month'
      when fi.boost_qualified and fi.workout_points >= fi.match_target then 'Qualified — already at or above the highest workout points'
      when fi.boost_qualified then 'Qualified — 90%+ of prescribed workouts completed'
      when not fi.boost_possible and fi.month_closed then 'Finished below 90% of prescribed workouts'
      when not fi.boost_possible then 'Can no longer reach 90% this month'
      else 'Needs ' || fi.needed_workouts || ' more prescribed workout' || case when fi.needed_workouts = 1 then '' else 's' end end boost_reason
  from final fi
)
select s.client_id, s.user_id, s.display_name, s.avatar_url, s.qualified,
  s.weight_value, s.weight_unit, s.logged_date,
  s.workouts_completed, s.fully_logged, s.bodyweight_logs, s.improved_exercises,
  s.workout_points, s.logging_points, s.bodyweight_points, s.improvement_points,
  s.atpr_lifts, s.program_pr_lifts, s.block_pr_lifts, s.last_record_at,
  s.base_total, s.awarded_match, s.total_points,
  (case when s.qualified then row_number() over (
      partition by s.qualified
      order by s.total_points desc, s.improvement_points desc, s.workout_points desc,
               s.logging_points desc, s.bodyweight_points desc, s.display_name, s.client_id) end)::int,
  s.eligible_workouts, s.completed_eligible,
  case when s.eligible_workouts > 0 then round(100.0 * s.completed_eligible / s.eligible_workouts, 1) else 0 end,
  s.needed_workouts, s.open_workouts, s.boost_possible, s.boost_qualified,
  s.legit_workout_points, s.ceiling_points, s.coverage, s.match_target,
  s.projected_match, s.projected_total, s.boost_status, s.boost_reason,
  s.finalized, s.month_start, s.final_week_start, s.is_final_week, s.month_closed,
  s.community_posts, s.community_points
from scored s
$function$;
revoke all on function public.league_month_scores(date, timestamptz) from public, anon, authenticated;
grant execute on function public.league_month_scores(date, timestamptz) to service_role;

-- Performance League screen: + community_posts, community_points (trailing).
drop function if exists public.get_performance_league(date, uuid);
create or replace function public.get_performance_league(_month date default null, _as_user uuid default null)
returns table(client_id uuid, display_name text, avatar_url text, rank integer, is_me boolean, qualified boolean, bodyweight_value numeric, bodyweight_unit text, total_points integer, workout_points integer, logging_points integer, bodyweight_points integer, improvement_points integer, match_points integer, workouts_completed integer, fully_logged integer, boost_status text, needed_workouts integer, projected_total integer, eligible_workouts integer, completed_eligible integer, adherence_pct numeric, open_workouts integer, match_target integer, projected_match integer, month_start date, final_week_start date, is_final_week boolean, month_closed boolean, finalized boolean, atpr_lifts integer, program_pr_lifts integer, block_pr_lifts integer, last_record_at timestamp with time zone, is_coach boolean, community_posts integer, community_points integer)
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
    public.community_is_coach(s.user_id),
    s.community_posts, s.community_points
  from public.league_month_scores(_month, now()) s, viewer v
  where v.uid is not null
    and ((s.qualified and s.rank <= 50) or s.user_id = v.uid)
  order by s.qualified desc, s.rank nulls last, s.display_name
$function$;

revoke all on function public.get_performance_league(date, uuid) from public, anon;
grant execute on function public.get_performance_league(date, uuid) to authenticated, service_role;

-- ── Share screen: "will this post earn?" ──────────────────────────────────
-- Today's posting points already banked, and scoring posts this week (within
-- the current league month, matching how the league counts them).
create or replace function public.community_post_points_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (select public.xp_client_for_user(auth.uid()) client_id),
  b as (select * from public.league_month_bounds(null, now())),
  t as (select (now() at time zone public.league_tz())::date today)
  select case when me.client_id is null then null else jsonb_build_object(
    'points', 15,
    'week_cap', 2,
    'today_earned', exists (
      select 1 from public.athlete_xp_events e
       where e.client_id = me.client_id and e.source_key = 'community_post:' || t.today::text),
    'week_count', (
      select count(*) from public.athlete_xp_events e
       where e.client_id = me.client_id and e.event_type = 'community_post'
         and e.occurred_at >= b.start_at and e.occurred_at < b.end_at
         and date_trunc('week', e.occurred_at at time zone public.league_tz()) = date_trunc('week', t.today::timestamp))
  ) end
  from me, b, t
$$;
revoke all on function public.community_post_points_status() from public, anon;
grant execute on function public.community_post_points_status() to authenticated, service_role;

-- ── Badges ────────────────────────────────────────────────────────────────
insert into public.athlete_badge_catalog
  (badge_key, name, category, icon_key, rarity, description, requirement, metric, event_type, threshold, is_public, is_active, sort_order)
values
  ('first_post','Posted Up','community','users','common','You shared your first workout with the crew.','Share a workout to the Community','event_count','community_post',1,true,true,230),
  ('posts_10','Crew Regular','community','users','rare','Ten days of showing your work.','Share workouts on 10 different days','event_count','community_post',10,true,true,231),
  ('posts_30','Feed Fixture','community','megaphone','epic','Thirty days of sharing your training.','Share workouts on 30 different days','event_count','community_post',30,true,true,232),
  ('posts_100','Community Icon','community','crown','legendary','One hundred days of sharing the work.','Share workouts on 100 different days','event_count','community_post',100,true,true,233),
  ('first_comment','Hype Squad','community','message','common','You backed a teammate in the comments.','Comment on a teammate''s post','event_count','community_comment',1,true,true,235),
  ('comments_25','Team Player','community','message','rare','Comments on 25 teammates'' posts.','Comment on 25 different posts','event_count','community_comment',25,true,true,236),
  ('comments_100','Community Pillar','community','megaphone','epic','Comments on 100 teammates'' posts.','Comment on 100 different posts','event_count','community_comment',100,true,true,237)
on conflict (badge_key) do update set
  name = excluded.name, category = excluded.category, icon_key = excluded.icon_key, rarity = excluded.rarity,
  description = excluded.description, requirement = excluded.requirement, metric = excluded.metric,
  event_type = excluded.event_type, threshold = excluded.threshold, is_public = excluded.is_public,
  is_active = excluded.is_active, sort_order = excluded.sort_order;

-- ── Backfill existing posts and comments (idempotent) ─────────────────────
do $$
declare r record;
begin
  for r in select distinct cp.client_id, (cp.created_at at time zone public.league_tz())::date d
             from public.community_posts cp where cp.client_id is not null and cp.kind = 'workout' loop
    perform public.community_post_xp_sync(r.client_id, r.d);
  end loop;
  for r in select distinct cc.author_user_id, cc.post_id from public.community_comments cc loop
    perform public.community_comment_xp_sync(r.author_user_id, r.post_id);
  end loop;
  for r in select distinct e.client_id from public.athlete_xp_events e
            where e.event_type in ('community_post', 'community_comment') loop
    perform public.sync_athlete_achievements(r.client_id);
  end loop;
end $$;
