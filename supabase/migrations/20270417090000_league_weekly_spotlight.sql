-- The League's week: where everyone stood each Monday (Nov 19 2026).
--
-- The coach asked for Rankings to show movement ("▲2 this week") and for a
-- Monday spotlight in Crew: your rank and how it moved last week, the gap to
-- the next spot, the week's biggest climbers and top performers, your PRs and
-- consistency, all from real data. The League is monthly and scored live by
-- league_month_scores(_month, _now), which already counts points only up to
-- `_now`; running it for every board load at two points in time would cost
-- ~1.6 s each. So the standings are kept once a week, as of Monday 00:00 in
-- the league's own clock (local_to_instant, so Manitoba's fixed UTC-5 holds),
-- by that same function: nothing about how points are earned changes, and a
-- snapshot taken late is still exact for points (they're counted to `_now`).
--
-- league_week_snapshots: one row per athlete per Monday. week_start is that
-- Monday (league local date); month_start is the League month the standings
-- are for (the month of that Monday). Server only: read through the two
-- functions below, which show only what the board already shows (its top 50
-- and you).

CREATE TABLE IF NOT EXISTS public.league_week_snapshots (
  week_start date NOT NULL,
  month_start date NOT NULL,
  client_id uuid NOT NULL,
  user_id uuid,
  display_name text,
  avatar_url text,
  qualified boolean NOT NULL DEFAULT false,
  rank integer,
  total_points integer NOT NULL DEFAULT 0,
  workouts_completed integer NOT NULL DEFAULT 0,
  fully_logged integer NOT NULL DEFAULT 0,
  bodyweight_logs integer NOT NULL DEFAULT 0,
  atpr_lifts integer NOT NULL DEFAULT 0,
  record_lifts integer NOT NULL DEFAULT 0,
  community_posts integer NOT NULL DEFAULT 0,
  taken_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, client_id)
);
ALTER TABLE public.league_week_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_week_snapshots FROM anon, authenticated;

-- The Monday (league local date) of the week `_at` falls in.
CREATE OR REPLACE FUNCTION public.league_week_of(_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT (d - (extract(isodow FROM d)::int - 1))::date
    FROM (SELECT public.instant_to_local(_at, public.league_tz())::date AS d) x
$$;

-- Take a Monday's standings once (a second call is a no-op). Returns rows written.
CREATE OR REPLACE FUNCTION public.league_week_snapshot_take(_week_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _at timestamptz;
  n integer;
BEGIN
  IF _week_start IS NULL OR extract(isodow FROM _week_start) <> 1 THEN
    RAISE EXCEPTION 'week_start must be a Monday';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_week_snapshots WHERE week_start = _week_start) THEN
    RETURN 0;
  END IF;
  _at := public.local_to_instant(_week_start::timestamp, public.league_tz());
  IF _at > now() THEN
    RETURN 0;
  END IF;
  -- one writer at a time (the hourly job and a first reader on Monday)
  PERFORM pg_advisory_xact_lock(hashtext('league_week_snapshot:' || _week_start::text));
  IF EXISTS (SELECT 1 FROM public.league_week_snapshots WHERE week_start = _week_start) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.league_week_snapshots (
    week_start, month_start, client_id, user_id, display_name, avatar_url, qualified, rank,
    total_points, workouts_completed, fully_logged, bodyweight_logs, atpr_lifts, record_lifts, community_posts)
  SELECT _week_start, s.month_start, s.client_id, s.user_id, s.display_name, s.avatar_url, s.qualified,
         CASE WHEN s.qualified THEN s.rank END,
         coalesce(s.total_points, 0), coalesce(s.workouts_completed, 0), coalesce(s.fully_logged, 0),
         coalesce(s.bodyweight_logs, 0), coalesce(s.atpr_lifts, 0),
         coalesce(s.atpr_lifts, 0) + coalesce(s.program_pr_lifts, 0) + coalesce(s.block_pr_lifts, 0),
         coalesce(s.community_posts, 0)
    FROM public.league_month_scores(_week_start, _at) s
  ON CONFLICT (week_start, client_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.league_week_snapshot_take(date) FROM PUBLIC, anon, authenticated;

-- This week's and last week's Mondays, taken if they aren't yet (the hourly job; also a first reader).
CREATE OR REPLACE FUNCTION public.league_week_snapshots_ensure()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  w date := public.league_week_of(now());
BEGIN
  PERFORM public.league_week_snapshot_take(w);
  PERFORM public.league_week_snapshot_take(w - 7);
END;
$$;
REVOKE ALL ON FUNCTION public.league_week_snapshots_ensure() FROM PUBLIC, anon, authenticated;

-- Where each athlete on the board stood at the start of this week, for the
-- board's ▲ / ▼ and "+45 this week". Only while this week's Monday is in the
-- League month being shown (the week a month starts, there's nothing to move
-- from). The same people the board shows: its top 50 and you.
CREATE OR REPLACE FUNCTION public.get_league_week_movement(_as_user uuid DEFAULT NULL)
RETURNS TABLE (client_id uuid, week_start date, month_start date, rank integer, total_points integer, qualified boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v uuid := public.portal_viewer_uid(_as_user);
  w date := public.league_week_of(now());
  m date := date_trunc('month', public.instant_to_local(now(), public.league_tz()))::date;
BEGIN
  IF v IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.client_id, s.week_start, s.month_start, s.rank, s.total_points, s.qualified
      FROM public.league_week_snapshots s
     WHERE s.week_start = w
       AND s.month_start = m
       AND w > m;  -- the Monday a month starts on has nothing to compare with yet
END;
$$;
REVOKE ALL ON FUNCTION public.get_league_week_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_league_week_movement(uuid) TO authenticated;

-- The Monday spotlight: last week (Monday to Sunday) in the League, for you.
-- Null when there's nothing honest to say: you're not in the League, it's the
-- first week of a month (the monthly recap is that week's moment), or last
-- week's Monday hasn't been taken. Everything here is either already on the
-- board (names, ranks, points of its top 50) or yours (your workouts, logs and
-- all-time PRs), so it shows nothing the board doesn't.
CREATE OR REPLACE FUNCTION public.get_league_week_spotlight(_as_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v uuid := public.portal_viewer_uid(_as_user);
  w date;            -- this week's Monday: last week's standings as it began
  prev date;         -- last week's Monday
  m date;
  me public.league_week_snapshots;
  me_prev public.league_week_snapshots;
  w_at timestamptz;
  prev_at timestamptz;
  prs jsonb;
  result jsonb;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  w := public.league_week_of(now());
  prev := w - 7;
  -- the first week of a month: the monthly recap says it (and last week was mostly last month)
  IF extract(day FROM w) <= 7 THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_week_snapshots s WHERE s.week_start = w) THEN
    PERFORM public.league_week_snapshots_ensure();
  END IF;
  SELECT * INTO me FROM public.league_week_snapshots s WHERE s.week_start = w AND s.user_id = v LIMIT 1;
  IF me.client_id IS NULL THEN RETURN NULL; END IF;
  m := me.month_start;
  SELECT * INTO me_prev FROM public.league_week_snapshots s
   WHERE s.week_start = prev AND s.client_id = me.client_id AND s.month_start = m;

  w_at := public.local_to_instant(w::timestamp, public.league_tz());
  prev_at := public.local_to_instant(prev::timestamp, public.league_tz());

  -- your all-time PRs last week (finished workouts, 10 reps or fewer), heaviest first
  SELECT coalesce(jsonb_agg(jsonb_build_object('exercise', r.exercise_name, 'reps', r.reps, 'load_kg', r.load_kg)
                            ORDER BY r.load_kg DESC NULLS LAST), '[]'::jsonb)
    INTO prs
    FROM (
      SELECT DISTINCT ON (x.exercise_key) x.exercise_key, x.exercise_name, x.reps, x.load_kg
        FROM (SELECT * FROM public.client_rep_records(me.client_id)
              UNION ALL
              SELECT * FROM public.client_load_records(me.client_id)) x
       WHERE x.completed AND x.is_atpr AND x.reps BETWEEN 1 AND 10
         AND x.workout_at >= prev_at AND x.workout_at < w_at
       ORDER BY x.exercise_key, x.load_kg DESC NULLS LAST
    ) r;

  WITH now_s AS (
    SELECT s.* FROM public.league_week_snapshots s WHERE s.week_start = w AND s.month_start = m
  ), was AS (
    SELECT s.* FROM public.league_week_snapshots s WHERE s.week_start = prev AND s.month_start = m
  ), wk AS (
    SELECT n.client_id, n.user_id = v AS is_me, n.display_name, n.avatar_url, n.rank, n.qualified,
           o.rank AS prev_rank,
           n.total_points,
           n.total_points - coalesce(o.total_points, 0) AS week_points
      FROM now_s n LEFT JOIN was o ON o.client_id = n.client_id
     WHERE n.qualified AND n.rank <= 50
  )
  SELECT jsonb_build_object(
    'week_start', prev,
    'week_end', w - 1,
    'month_start', m,
    -- the week of the League month it was (1, 2, 3…)
    'week_of_month', ((extract(day FROM prev)::int - 1) / 7) + 1,
    'athletes', (SELECT count(*) FROM wk),
    'me', jsonb_build_object(
      'client_id', me.client_id,
      'qualified', me.qualified,
      'rank', me.rank,
      'prev_rank', CASE WHEN me_prev.qualified THEN me_prev.rank END,
      'total_points', me.total_points,
      'week_points', me.total_points - coalesce(me_prev.total_points, 0),
      'workouts', me.workouts_completed - coalesce(me_prev.workouts_completed, 0),
      'fully_logged', me.fully_logged - coalesce(me_prev.fully_logged, 0),
      'bodyweight_logs', me.bodyweight_logs - coalesce(me_prev.bodyweight_logs, 0),
      'posts', me.community_posts - coalesce(me_prev.community_posts, 0),
      'prs', prs),
    -- who moved up the most spots (both weeks ranked)
    'climbers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('client_id', c.client_id, 'name', c.display_name, 'avatar_url', c.avatar_url,
                                          'rank', c.rank, 'prev_rank', c.prev_rank, 'is_me', c.is_me)
                       ORDER BY c.prev_rank - c.rank DESC, c.rank)
        FROM (SELECT * FROM wk WHERE prev_rank IS NOT NULL AND prev_rank > rank
               ORDER BY prev_rank - rank DESC, rank LIMIT 3) c), '[]'::jsonb),
    -- who earned the most points last week
    'top_week', coalesce((
      SELECT jsonb_agg(jsonb_build_object('client_id', t.client_id, 'name', t.display_name, 'avatar_url', t.avatar_url,
                                          'rank', t.rank, 'week_points', t.week_points, 'is_me', t.is_me)
                       ORDER BY t.week_points DESC, t.rank)
        FROM (SELECT * FROM wk WHERE week_points > 0 ORDER BY week_points DESC, rank LIMIT 3) t), '[]'::jsonb),
    -- the crew's week, in two numbers
    'crew', (SELECT jsonb_build_object(
               'workouts', coalesce(sum(n.workouts_completed - coalesce(o.workouts_completed, 0)), 0),
               'records', coalesce(sum(greatest(0, n.record_lifts - coalesce(o.record_lifts, 0))), 0))
               FROM now_s n LEFT JOIN was o ON o.client_id = n.client_id)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_league_week_spotlight(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_league_week_spotlight(uuid) TO authenticated;

-- Take this week's and last week's Mondays now, so movement and the spotlight work from today.
SELECT public.league_week_snapshots_ensure();

-- Hourly, a cheap check: a Monday not taken yet is taken (normally a few minutes after midnight).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'league-week-snapshots';
  PERFORM cron.schedule('league-week-snapshots', '7 * * * *', $cmd$SELECT public.league_week_snapshots_ensure()$cmd$);
END $$;
