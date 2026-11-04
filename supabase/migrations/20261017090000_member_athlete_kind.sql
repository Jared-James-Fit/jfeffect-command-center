-- Member athletes, step 1: mark which clients rows are coaching clients.
--
-- Member-built workouts (Stage 4) run on the pl_* engine, which keys every
-- athlete on clients.id. A member who builds a workout gets a clients row of
-- athlete_kind = 'member' (created in the next PR). This migration adds the
-- column -- every existing row is 'coaching' -- and makes every function that
-- lists the coaching population skip member athletes, so members never show
-- up in the admin client list, dashboard counts, check-in seeding, the
-- Performance League, Wednesday Wins or the community before community is
-- opened to them on purpose.
--
-- With no member rows yet, this changes nothing on merge.
--
-- Each function below is its latest definition copied verbatim, plus one
-- athlete_kind predicate. src/test/member-athlete-exclusions.test.ts fails if
-- a later migration redefines one of them without it.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS athlete_kind text NOT NULL DEFAULT 'coaching';
DO $$ BEGIN
  ALTER TABLE public.clients ADD CONSTRAINT clients_athlete_kind_check CHECK (athlete_kind IN ('coaching', 'member'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- can_view_community: from from 20261006090000_community_sharing.sql
CREATE OR REPLACE FUNCTION public.can_view_community()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_community_staff()
    OR EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.user_id = auth.uid()
         AND coalesce(c.archived, false) = false
         AND c.archived_at IS NULL
         AND coalesce(c.status, '') <> 'Archived'
         AND coalesce(c.portal_access_disabled, false) = false
         AND c.athlete_kind = 'coaching'))
$$;

-- community_members: from from 20261008090000_community_coach_posts.sql
CREATE OR REPLACE FUNCTION public.community_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'author', public.community_author(m.user_id),
             'bio', cp.bio,
             'posts', s.posts,
             'last_post_at', s.last_at,
             'live', s.live)
           ORDER BY (public.community_author(m.user_id)->>'is_coach')::boolean DESC, s.last_at DESC NULLS LAST, lower(coalesce(public.community_author(m.user_id)->>'name', '')))
      FROM (
        SELECT DISTINCT ON (x.user_id) x.user_id, x.is_staff FROM (
          SELECT c.user_id, false AS is_staff FROM public.clients c
           WHERE c.user_id IS NOT NULL
             AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
             AND coalesce(c.status, '') <> 'Archived'
             AND c.athlete_kind = 'coaching'
             AND coalesce(c.portal_access_disabled, false) = false
          UNION ALL
          SELECT ur.user_id, true FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach')
        ) x ORDER BY x.user_id, x.is_staff DESC
      ) m
      LEFT JOIN public.community_profiles cp ON cp.user_id = m.user_id
      CROSS JOIN LATERAL (
        SELECT count(*) AS posts, max(p.created_at) AS last_at,
               coalesce(bool_or(p.locked_in_at > now() - interval '3 hours' AND pc.completed_at IS NULL), false) AS live
          FROM public.community_posts p
          LEFT JOIN public.pl_day_completions pc ON pc.id = p.completion_id
         WHERE p.author_user_id = m.user_id
           AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
      ) s
     WHERE m.user_id <> uid
       -- a linked second account (same person) isn't listed twice
       AND NOT EXISTS (SELECT 1 FROM public.community_profiles l WHERE l.user_id = m.user_id AND l.same_person_as IS NOT NULL)
       AND m.user_id <> coalesce((SELECT l2.same_person_as FROM public.community_profiles l2 WHERE l2.user_id = uid), uid)
  ), '[]'::jsonb);
END;
$$;

-- community_week_stats: from from 20261008180000_community_wins_card_v2.sql
CREATE OR REPLACE FUNCTION public.community_week_stats(_week_start date, _exclude_user uuid, _wins jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_from timestamptz := (_week_start::timestamp AT TIME ZONE tz);
  v_to timestamptz := ((_week_start + 7)::timestamp AT TIME ZONE tz);
  v_roster uuid[];
  v_weeks jsonb;
BEGIN
  SELECT array_agg(cl.id) INTO v_roster FROM public.clients cl
   WHERE cl.user_id IS NOT NULL
     AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
     AND coalesce(cl.status, '') <> 'Archived'
     AND coalesce(cl.portal_access_disabled, false) = false
     AND cl.athlete_kind = 'coaching'
     AND cl.user_id IS DISTINCT FROM _exclude_user;

  -- every week on record up to this one: workouts and total weight lifted
  SELECT coalesce(jsonb_agg(jsonb_build_object('wk', wk, 'sessions', coalesce(n, 0), 'volume_kg', coalesce(vol, 0)) ORDER BY wk), '[]'::jsonb)
    INTO v_weeks
    FROM (
      SELECT coalesce(s.wk, v.wk) AS wk, s.n, v.vol
        FROM (SELECT date_trunc('week', pc.completed_at AT TIME ZONE tz)::date AS wk, count(*) AS n
                FROM public.pl_day_completions pc
               WHERE pc.client_id = ANY (v_roster) AND pc.completed_at IS NOT NULL AND pc.completed_at < v_to
               GROUP BY 1) s
        FULL JOIN (SELECT date_trunc('week', q.workout_at AT TIME ZONE tz)::date AS wk, round(sum(q.reps * q.load_kg)) AS vol
                     FROM unnest(v_roster) r(id) CROSS JOIN LATERAL public.client_qualifying_sets(r.id) q
                    WHERE q.completed AND q.workout_at < v_to
                    GROUP BY 1) v ON v.wk = s.wk
    ) h;

  RETURN jsonb_build_object(
    'week_of', _week_start,
    'roster', coalesce(array_length(v_roster, 1), 0),
    -- opened the app: signed in, or logged anything at all
    'opened', (SELECT count(DISTINCT x.id) FROM (
                 SELECT a.client_id AS id FROM public.client_activity_log a
                  WHERE a.action = 'signed_in' AND a.created_at >= v_from AND a.created_at < v_to AND a.client_id = ANY (v_roster)
                 UNION ALL
                 SELECT e.client_id FROM public.athlete_xp_events e
                  WHERE e.occurred_at >= v_from AND e.occurred_at < v_to AND e.client_id = ANY (v_roster)) x),
    'trained', jsonb_array_length(coalesce(_wins, '[]'::jsonb)),
    'sessions', (SELECT coalesce(sum((w->>'sessions')::int), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'sessions_prev', (SELECT count(*) FROM public.pl_day_completions pc
                       WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from - interval '7 days' AND pc.completed_at < v_from),
    'prs', (SELECT coalesce(sum((w->>'pr_lifts')::int), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'pr_people', (SELECT count(*) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w WHERE (w->>'pr_lifts')::int > 0),
    'volume_kg', (SELECT coalesce(sum((w->>'volume_kg')::numeric), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'volume_prev_kg', (SELECT coalesce((h->>'volume_kg')::numeric, 0) FROM jsonb_array_elements(v_weeks) h WHERE (h->>'wk')::date = _week_start - 7),
    -- 1 = the most weight the crew has lifted in any week on record
    'volume_rank', (SELECT 1 + count(*) FROM jsonb_array_elements(v_weeks) h
                     WHERE (h->>'wk')::date < _week_start
                       AND (h->>'volume_kg')::numeric > coalesce((SELECT (t->>'volume_kg')::numeric FROM jsonb_array_elements(v_weeks) t WHERE (t->>'wk')::date = _week_start), 0)),
    'sessions_rank', (SELECT 1 + count(*) FROM jsonb_array_elements(v_weeks) h
                       WHERE (h->>'wk')::date < _week_start
                         AND (h->>'sessions')::int > coalesce((SELECT (t->>'sessions')::int FROM jsonb_array_elements(v_weeks) t WHERE (t->>'wk')::date = _week_start), 0)),
    'weeks_tracked', (SELECT count(*) FROM jsonb_array_elements(v_weeks) h WHERE (h->>'wk')::date <= _week_start),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('wk', g.wk, 'sessions', coalesce((SELECT (h->>'sessions')::int FROM jsonb_array_elements(v_weeks) h WHERE (h->>'wk')::date = g.wk), 0)) ORDER BY g.wk), '[]'::jsonb)
                  FROM (SELECT (_week_start - 7 * i) AS wk FROM generate_series(0, 7) i) g),
    'reps', (SELECT coalesce(sum((w->>'reps')::int), 0) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w),
    'streaks', (SELECT count(*) FROM jsonb_array_elements(coalesce(_wins, '[]'::jsonb)) w WHERE (w->>'streak')::int >= 4),
    'bodyweight', (SELECT count(DISTINCT e.client_id) FROM public.athlete_xp_events e
                    WHERE e.event_type = 'bodyweight' AND e.occurred_at >= v_from AND e.occurred_at < v_to AND e.client_id = ANY (v_roster)),
    'checkins', (SELECT count(DISTINCT e.client_id) FROM public.athlete_xp_events e
                  WHERE e.event_type = 'weekly_checkin' AND e.occurred_at >= v_from AND e.occurred_at < v_to AND e.client_id = ANY (v_roster)),
    'busiest_day', (SELECT to_char(pc.completed_at AT TIME ZONE tz, 'FMDay') FROM public.pl_day_completions pc
                     WHERE pc.client_id = ANY (v_roster) AND pc.completed_at >= v_from AND pc.completed_at < v_to
                     GROUP BY 1, extract(isodow FROM pc.completed_at AT TIME ZONE tz) ORDER BY count(*) DESC, extract(isodow FROM pc.completed_at AT TIME ZONE tz) LIMIT 1));
END;
$$;

-- community_week_wins: from from 20261008160000_community_wins_voice.sql
CREATE OR REPLACE FUNCTION public.community_week_wins(_week_start date, _exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_from timestamptz := (_week_start::timestamp AT TIME ZONE tz);
  v_to timestamptz := ((_week_start + 7)::timestamp AT TIME ZONE tz);
  c record;
  pr record;
  v_out jsonb := '[]'::jsonb;
  v_name text;
  v_hide boolean;
  v_sessions int;
  v_pr_lifts int;
  v_sched int;
  v_done int;
  v_prev timestamptz;
  v_first_this timestamptz;
  v_gap int;
  v_streak int;
  v_vol numeric;
  v_vol_prev numeric;
  v_reps int;
  v_type text;
  v_score int;
  v_text text;
  v_texts text[];
  v_lift text;
  v_set text;
  v_unit text;
  v_more text;
BEGIN
  FOR c IN
    SELECT cl.id, cl.user_id, coalesce(nullif(cl.preferred_weight_unit, ''), 'lb') AS unit
      FROM public.clients cl
     WHERE cl.user_id IS NOT NULL
       AND coalesce(cl.archived, false) = false AND cl.archived_at IS NULL
       AND coalesce(cl.status, '') <> 'Archived'
       AND coalesce(cl.portal_access_disabled, false) = false
       AND cl.athlete_kind = 'coaching'
       AND cl.user_id IS DISTINCT FROM _exclude_user
  LOOP
    SELECT count(*)::int, min(pc.completed_at) INTO v_sessions, v_first_this FROM public.pl_day_completions pc
     WHERE pc.client_id = c.id AND pc.completed_at >= v_from AND pc.completed_at < v_to;
    CONTINUE WHEN v_sessions = 0;

    v_name := public.community_author(c.user_id)->>'name';
    v_hide := EXISTS (SELECT 1 FROM public.community_posts p WHERE p.author_user_id = c.user_id AND p.hide_loads);

    -- PRs set this week (the same record rules the recap and share cards use)
    SELECT x.exercise_id, x.exercise_name, x.reps, x.load_kg,
           CASE WHEN x.is_atpr THEN 'atpr' WHEN x.is_program_pr THEN 'program_pr' ELSE 'block_pr' END AS scope
      INTO pr
      FROM (SELECT * FROM public.client_load_records(c.id) UNION ALL SELECT * FROM public.client_rep_records(c.id)) x
     WHERE x.completed AND x.workout_at >= v_from AND x.workout_at < v_to AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr)
     ORDER BY x.is_atpr DESC, x.is_program_pr DESC, (x.exercise_name ~* '(squat|bench|deadlift)') DESC, x.load_kg DESC NULLS LAST
     LIMIT 1;
    SELECT count(DISTINCT x.exercise_key)::int INTO v_pr_lifts
      FROM (SELECT * FROM public.client_load_records(c.id) UNION ALL SELECT * FROM public.client_rep_records(c.id)) x
     WHERE x.completed AND x.workout_at >= v_from AND x.workout_at < v_to AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr);

    SELECT count(*)::int, count(pc.id)::int INTO v_sched, v_done
      FROM public.pl_scheduled_workouts s
      LEFT JOIN public.pl_day_completions pc ON pc.scheduled_workout_id = s.id AND pc.completed_at IS NOT NULL
     WHERE s.client_id = c.id AND s.scheduled_date >= _week_start AND s.scheduled_date < _week_start + 7;

    SELECT max(pc.completed_at) INTO v_prev FROM public.pl_day_completions pc
     WHERE pc.client_id = c.id AND pc.completed_at IS NOT NULL AND pc.completed_at < v_from;
    v_gap := CASE WHEN v_prev IS NULL THEN NULL ELSE extract(day FROM (v_first_this - v_prev))::int END;

    v_streak := 0;
    WHILE v_streak < 52 AND EXISTS (
      SELECT 1 FROM public.pl_day_completions pc WHERE pc.client_id = c.id
         AND pc.completed_at >= ((_week_start - 7 * v_streak)::timestamp AT TIME ZONE tz)
         AND pc.completed_at < ((_week_start - 7 * v_streak + 7)::timestamp AT TIME ZONE tz)) LOOP
      v_streak := v_streak + 1;
    END LOOP;

    SELECT coalesce(sum(q.reps * q.load_kg) FILTER (WHERE q.workout_at >= v_from), 0),
           coalesce(sum(q.reps * q.load_kg) FILTER (WHERE q.workout_at < v_from), 0),
           coalesce(sum(q.reps) FILTER (WHERE q.workout_at >= v_from), 0)::int
      INTO v_vol, v_vol_prev, v_reps
      FROM public.client_qualifying_sets(c.id) q
     WHERE q.completed AND q.workout_at >= v_from - interval '7 days' AND q.workout_at < v_to;

    -- Best single win
    IF pr.scope IS NOT NULL THEN
      v_type := pr.scope;
      -- More PRs and a big-3 PR rank higher within the same kind of win.
      v_score := CASE pr.scope WHEN 'atpr' THEN 100 WHEN 'program_pr' THEN 85 ELSE 70 END
                 + least(coalesce(v_pr_lifts, 1), 10) + CASE WHEN pr.exercise_name ~* '(squat|bench|deadlift)' THEN 5 ELSE 0 END;
      v_lift := public.community_fmt_lift_short(pr.exercise_name);
      -- the unit they log this lift in (kg/lb toggle per exercise), else their default
      v_unit := coalesce((SELECT u.unit FROM public.client_exercise_unit_prefs u
                           WHERE u.client_id = c.id AND u.exercise_id = pr.exercise_id AND u.unit IN ('kg', 'lb') LIMIT 1), c.unit);
      v_set := CASE WHEN v_hide THEN NULL ELSE public.community_fmt_set(pr.load_kg, pr.reps, v_unit) END;
      v_more := CASE WHEN v_pr_lifts = 2 THEN ' + 1 more PR'
                     WHEN v_pr_lifts > 2 THEN ' + ' || (v_pr_lifts - 1) || ' more PRs' ELSE '' END;
      -- three ways to say each win (compose rotates them so lines next to
      -- each other never read the same). Written the way Jared texts:
      -- gym shorthand, few commas, not every sentence capitalized.
      v_texts := CASE
        WHEN v_set IS NULL THEN ARRAY[
          v_name || ' just hit a new ' || CASE pr.scope WHEN 'atpr' THEN 'all time' WHEN 'program_pr' THEN 'program' ELSE 'block' END || ' PR on ' || v_lift,
          'new ' || CASE pr.scope WHEN 'atpr' THEN 'all time' WHEN 'program_pr' THEN 'program' ELSE 'block' END || ' PR for ' || v_name || ' on ' || v_lift,
          v_name || ' PRd ' || v_lift || CASE pr.scope WHEN 'atpr' THEN ' best ever' WHEN 'program_pr' THEN ' best of the program' ELSE ' best of the block' END]
        WHEN pr.scope = 'atpr' THEN ARRAY[
          v_name || ' just hit ' || v_set || ' on ' || v_lift || '. all time PR',
          'new all time PR for ' || v_name || ' on ' || v_lift || ' ' || v_set,
          v_name || ' went ' || v_set || ' on ' || v_lift || ' for an all time PR']
        WHEN pr.scope = 'program_pr' THEN ARRAY[
          v_name || ' hit ' || v_set || ' on ' || v_lift || '. program PR',
          'program PR for ' || v_name || ' on ' || v_lift || ' ' || v_set,
          v_name || ' went ' || v_set || ' on ' || v_lift || ' best of the program so far']
        ELSE ARRAY[
          v_name || ' hit ' || v_set || ' on ' || v_lift || '. block PR',
          'block PR for ' || v_name || ' on ' || v_lift || ' ' || v_set,
          v_name || ' went ' || v_set || ' on ' || v_lift || ' best of the block']
      END;
      -- a big PR week gets its own reaction, worded differently per phrasing
      v_texts := CASE WHEN v_pr_lifts >= 5 THEN ARRAY[
                   v_texts[1] || '. ' || v_pr_lifts || ' PRs in 1 week thats insane',
                   v_texts[2] || '. ' || v_pr_lifts || ' PRs in 1 week crazy',
                   v_texts[3] || '. ' || v_pr_lifts || ' PRs on the week lowkey insane']
                 ELSE ARRAY[v_texts[1] || v_more, v_texts[2] || v_more, v_texts[3] || v_more] END;
    ELSIF v_prev IS NULL THEN
      v_type := 'first_week'; v_score := 60;
      v_texts := ARRAY[
        'welcome to the crew ' || v_name || '. ' || CASE WHEN v_sessions = 1 THEN 'first session in the books' ELSE 'first week done ' || v_sessions || ' sessions in' END,
        v_name || ' got their first week in the books. ' || CASE WHEN v_sessions = 1 THEN '1 session down' ELSE v_sessions || ' sessions down' END,
        'first week done for ' || v_name || CASE WHEN v_sessions = 1 THEN '. first one is always the hardest' ELSE ' and already ' || v_sessions || ' sessions in' END];
    ELSIF v_gap >= 14 THEN
      v_type := 'comeback'; v_score := 60;
      v_texts := ARRAY[
        v_name || ' is back after ' || v_gap || ' days off. first one back is the hardest and its done',
        'good to have ' || v_name || ' back in after ' || v_gap || ' days away',
        v_name || ' got back in after ' || v_gap || ' days off. hardest part done'];
    ELSIF v_sched >= 3 AND v_done >= v_sched THEN
      v_type := 'perfect_week'; v_score := 55;
      v_texts := ARRAY[
        v_name || ' went ' || v_done || ' for ' || v_sched || ' didnt miss a single session',
        v_name || ' hit every session on the plan ' || v_done || '/' || v_sched,
        v_done || '/' || v_sched || ' from ' || v_name || '. every session done'];
    ELSIF v_streak >= 4 THEN
      v_type := 'streak'; v_score := 40 + least(v_streak, 20);
      v_texts := ARRAY[
        v_name || ' has trained ' || v_streak || ' weeks straight no misses',
        v_streak || ' weeks in a row for ' || v_name || '. thats how its done',
        v_name || ' hasnt missed a week in ' || v_streak || ' weeks fr'];
    ELSIF v_vol_prev > 0 AND v_vol >= v_vol_prev * 1.15 THEN
      v_type := 'volume'; v_score := 35;
      v_texts := ARRAY[
        v_name || ' moved ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more weight than the week before',
        v_name || ' lifted ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more than last week',
        v_name || ' put up ' || round((v_vol / v_vol_prev - 1) * 100)::int || '% more total volume vs the week before'];
    ELSE
      v_type := 'sessions'; v_score := 10 + v_sessions * 3;
      v_texts := CASE WHEN v_sessions = 1 THEN array_fill(v_name || ' got a session in and that counts', ARRAY[3])
                      ELSE ARRAY[v_name || ' got ' || v_sessions || ' sessions in', v_sessions || ' sessions from ' || v_name, v_name || ' put in ' || v_sessions || ' sessions'] END;
    END IF;
    v_text := v_texts[1];

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'client_id', c.id, 'name', v_name, 'type', v_type, 'score', v_score, 'text', v_text, 'texts', to_jsonb(v_texts),
      'sessions', v_sessions, 'pr_lifts', coalesce(v_pr_lifts, 0), 'streak', v_streak,
      'volume_kg', round(v_vol), 'reps', v_reps));
  END LOOP;
  RETURN v_out;
END;
$$;

-- league_month_scores: from from 20261013110000_league_community_post_points.sql
create or replace function public.league_month_scores(_month date default null, _now timestamptz default now())
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
    and c.athlete_kind = 'coaching'
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

-- league_current_prescriptions: from from 20261003180000_performance_league_final_week_boost.sql
create or replace function public.league_current_prescriptions(_month_start date, _month_end date)
returns table(client_id uuid, day_id uuid, scheduled_date date)
language sql stable security definer set search_path to 'public' as $$
  select b.client_id, d.id, coalesce(s.scheduled_date, d.scheduled_date)
  from public.pl_days d
  join public.pl_weeks w on w.id = d.week_id
  join public.pl_blocks b on b.id = w.block_id
  join public.clients c on c.id = b.client_id
  left join lateral (
    select ps.scheduled_date from public.pl_scheduled_workouts ps
    where ps.source_day_id = d.id order by ps.updated_at desc limit 1
  ) s on true
  where d.deleted_at is null and coalesce(d.archived,false) = false
    and coalesce(d.is_custom,false) = false
    and w.deleted_at is null and coalesce(w.archived,false) = false
    and coalesce(b.archived,false) = false and coalesce(b.client_visible,false) = true
    and coalesce(c.archived,false) = false and c.archived_at is null
    and c.athlete_kind = 'coaching'
    and coalesce(s.scheduled_date, d.scheduled_date) between _month_start and _month_end
$$;

-- admin_dashboard_overview: from from 20261010100000_admin_dashboard_overview.sql
create or replace function public.admin_dashboard_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
  v_tz text := public.league_tz();
  v_today date := (now() at time zone public.league_tz())::date;
  v_day_start timestamptz;
  v_month_start date;
  v_prev_month_start date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not (v_admin or public.has_role(v_uid, 'coach'::public.app_role)) then
    raise exception 'not allowed';
  end if;
  v_day_start := (v_today::timestamp at time zone v_tz);
  v_month_start := date_trunc('month', v_today)::date;
  v_prev_month_start := (date_trunc('month', v_today) - interval '1 month')::date;

  with roster as (
    select c.id, c.full_name, c.profile_picture_url, c.created_at,
           coalesce(c.preferred_weight_unit, 'lb') as unit
    from public.clients c
    where c.archived = false
      and c.athlete_kind = 'coaching'
      and coalesce(c.status, '') not in ('Archived', 'Deactivated')
      and (v_admin or public.is_assigned_coach(c.id))
  ),
  sched as (
    select sw.id, sw.client_id, sw.scheduled_time, coalesce(d.title, 'Workout') as title,
           dc.completed_at,
           case when dc.completed_at is null
                 and greatest(dc.in_progress_at, dc.started_at, dc.training_started_at) >= v_day_start
                then true else false end as in_progress
    from public.pl_scheduled_workouts sw
    join roster r on r.id = sw.client_id
    left join public.pl_days d on d.id = sw.source_day_id
    left join lateral (
      select x.completed_at, x.in_progress_at, x.started_at, x.training_started_at
      from public.pl_day_completions x
      where x.client_id = sw.client_id
        and (x.scheduled_workout_id = sw.id or (x.scheduled_workout_id is null and x.day_id = sw.source_day_id))
      order by x.completed_at desc nulls last
      limit 1
    ) dc on true
    where sw.scheduled_date = v_today
  ),
  extra as (
    select distinct on (x.client_id) x.client_id, x.completed_at, coalesce(d.title, 'Workout') as title
    from public.pl_day_completions x
    join roster r on r.id = x.client_id
    left join public.pl_days d on d.id = x.day_id
    where x.completed_at >= v_day_start
      and not exists (select 1 from sched s where s.client_id = x.client_id)
    order by x.client_id, x.completed_at desc
  ),
  rec as (
    select r.id as client_id, rr.exercise_name, rr.reps, rr.load_kg, rr.workout_at,
           case when rr.is_atpr then 'atpr' when rr.is_program_pr then 'program' else 'block' end as tier,
           case when rr.is_atpr then 3 when rr.is_program_pr then 2 else 1 end as tier_rank
    from roster r
    cross join lateral public.client_rep_records(r.id) rr
    where rr.completed
      and rr.workout_at >= now() - interval '7 days'
      and (rr.is_atpr or rr.is_program_pr or rr.is_block_pr)
  ),
  wins as (
    select distinct on (client_id, exercise_name) *
    from rec
    order by client_id, exercise_name, tier_rank desc, load_kg desc nulls last, workout_at desc
  ),
  money as (
    select t.currency,
      coalesce(sum(t.amount) filter (where t.occurred_on >= v_month_start), 0) as this_month,
      coalesce(sum(t.amount) filter (where t.occurred_on >= v_prev_month_start and t.occurred_on < v_month_start
                                       and extract(day from t.occurred_on) <= extract(day from v_today)), 0) as last_month_to_date,
      coalesce(sum(t.amount) filter (where t.occurred_on >= v_prev_month_start and t.occurred_on < v_month_start), 0) as last_month,
      count(*) filter (where t.occurred_on >= v_month_start) as payments
    from public.admin_transactions_v1 t
    where v_admin
      and t.txn_type = 'payment' and t.status = 'Paid'
      and not coalesce(t.voided, false)
      and coalesce(t.stripe_mode, 'live') = 'live'
      and t.occurred_on >= v_prev_month_start
    group by t.currency
  ),
  apps as (
    select a.id, a.full_name, a.submitted_at, a.lead_temperature, a.application_status
    from public.coaching_applications a
    where v_admin and not coalesce(a.is_test, false) and a.submitted_at >= now() - interval '30 days'
  )
  select jsonb_build_object(
    'today', v_today,
    'is_admin', v_admin,
    'training', jsonb_build_object(
      'scheduled', coalesce((
        select jsonb_agg(jsonb_build_object(
          'client_id', s.client_id, 'name', r.full_name, 'avatar', r.profile_picture_url,
          'title', s.title, 'time', s.scheduled_time,
          'status', case when s.completed_at is not null then 'done' when s.in_progress then 'training' else 'pending' end,
          'completed_at', s.completed_at)
          order by (s.completed_at is not null), s.scheduled_time nulls last, r.full_name)
        from sched s join roster r on r.id = s.client_id), '[]'::jsonb),
      'unscheduled', coalesce((
        select jsonb_agg(jsonb_build_object(
          'client_id', e.client_id, 'name', r.full_name, 'avatar', r.profile_picture_url,
          'title', e.title, 'completed_at', e.completed_at) order by e.completed_at desc)
        from extra e join roster r on r.id = e.client_id), '[]'::jsonb)
    ),
    'wins', coalesce((
      select jsonb_agg(w order by (w->>'at') desc)
      from (
        select jsonb_build_object(
          'client_id', wi.client_id, 'name', r.full_name, 'avatar', r.profile_picture_url,
          'exercise', wi.exercise_name, 'reps', wi.reps, 'load_kg', wi.load_kg, 'unit', r.unit,
          'tier', wi.tier, 'at', wi.workout_at) as w
        from wins wi join roster r on r.id = wi.client_id
        order by wi.workout_at desc
        limit 12
      ) x), '[]'::jsonb),
    'money', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', m.currency, 'this_month', m.this_month, 'last_month_to_date', m.last_month_to_date,
        'last_month', m.last_month, 'payments', m.payments) order by m.this_month desc)
      from money m), '[]'::jsonb) else null end,
    'leads', case when v_admin then jsonb_build_object(
      'new_7d', (select count(*) from apps where submitted_at >= now() - interval '7 days'),
      'new_30d', (select count(*) from apps),
      'latest', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'name', a.full_name, 'submitted_at', a.submitted_at,
          'temperature', a.lead_temperature, 'status', a.application_status) order by a.submitted_at desc)
        from (select * from apps order by submitted_at desc limit 3) a), '[]'::jsonb)
    ) else null end,
    'roster', jsonb_build_object(
      'active', (select count(*) from roster),
      'new_this_month', (select count(*) from roster where created_at >= v_month_start)
    )
  ) into v_result;

  return v_result;
end
$$;

-- seed_messenger_checkin_occurrences: from from 20261003150000_nutrition_review_last_friday.sql
create or replace function public.seed_messenger_checkin_occurrences()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  local_now timestamp;
  local_date date;
  local_clock time;
  due_date date;
  due_at timestamptz;
  target_dow integer;
  delta_days integer;
  month_start date;
  month_end date;
  candidate_15 date;
  candidate_30 date;
  inserted_count integer := 0;
begin
  -- An unsubmitted check-in whose card was already sent and whose due date
  -- has passed must not block the next period forever. Retire it (the card
  -- stays in the chat and can still be submitted) so the next one seeds.
  update public.client_task_occurrences o
  set status = 'skipped',
      updated_at = now(),
      payload_ref = coalesce(o.payload_ref, '{}'::jsonb)
        || jsonb_build_object('skip_reason','superseded_unsubmitted')
  where o.task_type in ('weekly_checkin','nutrition_review')
    and o.status not in ('completed','skipped')
    and o.due_local_date < (now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date
    and exists (select 1 from public.messenger_checkins mc where mc.occurrence_id = o.id);

  for r in
    select
      c.id as client_id,
      d.id as definition_id,
      d.task_type,
      d.title,
      coalesce(o.enabled, d.enabled) as enabled,
      coalesce(o.frequency, d.frequency) as frequency,
      coalesce(o.due_day_of_week, d.due_day_of_week) as due_day_of_week,
      coalesce(o.due_time_local, d.due_time_local, '09:00'::time) as due_time_local,
      case coalesce(o.tz_mode, d.tz_mode, 'client')
        when 'fixed' then coalesce(o.fixed_tz, d.fixed_tz, 'UTC')
        when 'coach' then 'UTC'
        else coalesce(nullif(c.timezone,''), 'UTC')
      end as effective_tz,
      o.id as override_id
    from public.clients c
    cross join public.coach_task_definitions d
    left join public.client_task_overrides o
      on o.client_id = c.id
     and o.task_type = d.task_type
    where coalesce(c.archived,false) = false
      and c.athlete_kind = 'coaching'
      and d.task_type in ('weekly_checkin','nutrition_review')
  loop
    if not coalesce(r.enabled,true) then
      continue;
    end if;
    if r.frequency not in ('weekly','semi_monthly','monthly_last_friday') then
      continue;
    end if;
    if exists (
      select 1
      from public.client_task_occurrences x
      where x.client_id = r.client_id
        and x.task_type = r.task_type
        and x.status not in ('completed','skipped')
    ) then
      continue;
    end if;

    local_now := now() at time zone r.effective_tz;
    local_date := local_now::date;
    local_clock := local_now::time;

    if r.frequency = 'weekly' then
      target_dow := coalesce(r.due_day_of_week,6);
      delta_days := (target_dow - extract(dow from local_date)::integer + 7) % 7;
      due_date := local_date + delta_days;
      if delta_days = 0 and local_clock > r.due_time_local then
        due_date := due_date + 7;
      end if;
    elsif r.frequency = 'monthly_last_friday' then
      due_date := public.fn_next_last_friday(local_date, local_clock <= r.due_time_local);
    else
      month_start := date_trunc('month', local_date)::date;
      month_end := (date_trunc('month', local_date) + interval '1 month - 1 day')::date;
      candidate_15 := month_start + 14;
      candidate_30 := least(month_start + 29, month_end);

      if local_date < candidate_15
         or (local_date = candidate_15 and local_clock <= r.due_time_local) then
        due_date := candidate_15;
      elsif local_date < candidate_30
         or (local_date = candidate_30 and local_clock <= r.due_time_local) then
        due_date := candidate_30;
      else
        month_start := (date_trunc('month', local_date) + interval '1 month')::date;
        due_date := month_start + 14;
      end if;
    end if;

    due_at := (due_date + r.due_time_local) at time zone r.effective_tz;

    insert into public.client_task_occurrences (
      client_id,
      task_type,
      title,
      subtitle,
      due_at_utc,
      due_local_date,
      client_tz,
      status,
      source_definition_id,
      source_override_id,
      priority,
      is_coach_requested,
      metadata
    )
    values (
      r.client_id,
      r.task_type,
      r.title,
      case
        when r.frequency = 'weekly' then 'Weekly · due ' || trim(to_char(due_date,'Day'))
        when r.frequency = 'monthly_last_friday' then 'Last Friday of each month'
        else '15th + 30th of each month'
      end,
      due_at,
      due_date,
      r.effective_tz,
      'upcoming',
      r.definition_id,
      r.override_id,
      100,
      false,
      '{}'::jsonb
    )
    on conflict do nothing;

    if found then
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return inserted_count;
end;
$$;

-- admin_clients_directory: from from 20261007100000_checkin_reviewed_state.sql
create or replace function public.admin_clients_directory(
  p_search text default null,
  p_status text default null,
  p_coaching_type text default null,
  p_coach_id uuid default null,
  p_sort text default 'attention',
  p_limit integer default 15,
  p_offset integer default 0,
  p_lifecycle text default 'active',
  p_flags text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_today date := (now() at time zone 'utc')::date;
  v_lifecycle text := coalesce(nullif(p_lifecycle, ''), 'active');
  -- Every filter the caller asked for; a client must match ALL of them. p_status is the
  -- older single-filter spelling, folded in so a build that predates p_flags keeps working.
  v_flags text[] := coalesce((
    select array_agg(distinct t.f)
    from unnest(coalesce(p_flags, '{}'::text[]) || array[coalesce(p_status, '')]) as t(f)
    where t.f <> '' and t.f <> 'all'
  ), '{}'::text[]);
  v_rows jsonb;
  v_total int;
  v_counts jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  with base as (
    select c.*
    from public.clients c
    where (v_is_admin or public.is_assigned_coach(c.id))
      and c.athlete_kind = 'coaching'
      and (
        (v_lifecycle = 'active'      and c.archived = false and coalesce(c.status,'') not in ('Archived','Deactivated'))
        or (v_lifecycle = 'archived'    and (c.archived = true or c.status = 'Archived'))
        or (v_lifecycle = 'deactivated' and c.status = 'Deactivated')
      )
  ),
  valid_blocks as (
    select b.client_id, b.id, b.name, b.start_date, b.end_date, b.status
    from public.pl_blocks b
    where b.archived = false
      and coalesce(b.status, '') <> 'Archived'
      and b.start_date is not null
      and b.client_id in (select id from base)
  ),
  -- The block running today (prefer the one marked Active, then the latest
  -- start); if none is running, the one that ended within the last 7 days.
  cur_block as (
    select distinct on (vb.client_id)
      vb.client_id, vb.id, vb.name, vb.start_date, vb.end_date, vb.status
    from valid_blocks vb
    where vb.start_date <= v_today and vb.end_date is not null and vb.end_date >= v_today - 7
       or vb.start_date <= v_today and vb.end_date is null
    order by vb.client_id,
      (case when vb.end_date is null or vb.end_date >= v_today then 0 else 1 end),
      (case when vb.status = 'Active' then 0 else 1 end),
      vb.start_date desc
  ),
  next_block as (
    select distinct on (vb.client_id)
      vb.client_id, vb.id, vb.name, vb.start_date, vb.end_date, vb.status
    from valid_blocks vb
    where vb.start_date > v_today
    order by vb.client_id, vb.start_date asc, (case when vb.status = 'Active' then 0 else 1 end)
  ),
  cur_nut as (
    select distinct on (client_id) client_id, start_date, end_date, status
    from public.nutrition_targets
    where client_id in (select id from base)
    order by client_id, coalesce(start_date, '1900-01-01'::date) desc
  ),
  cur_card as (
    select distinct on (client_id) client_id, start_date, end_date, status
    from public.cardio_targets
    where client_id in (select id from base)
    order by client_id, coalesce(start_date, '1900-01-01'::date) desc
  ),
  -- "Review Due" = something the client sent that nobody on staff has dealt with yet:
  -- an in-app check-in, a native form, or (last 30 days only) an external form.
  -- A staff reply in the chat closes the first two automatically (trigger below).
  pending_reviews as (
    select x.client_id, sum(x.n)::bigint as n
    from (
      select mc.client_id, count(*) as n
      from public.messenger_checkins mc
      where mc.client_id in (select id from base)
        and mc.status = 'completed' and mc.superseded_at is null and mc.reviewed_at is null
      group by mc.client_id
      union all
      select s.client_id, count(*)
      from public.nf_submissions s
      where s.client_id in (select id from base)
        and s.submitted_at is not null and s.reviewed_at is null
        and s.status in ('submitted','pending_review')
      group by s.client_id
      union all
      select r.client_id, count(*)
      from public.submission_reviews r
      where r.client_id in (select id from base)
        and r.source_type <> 'native'
        and coalesce(r.review_status,'') in ('pending','needs_review','submitted')
        and r.submitted_at > now() - interval '30 days'
      group by r.client_id
    ) x
    group by x.client_id
  ),
  missed as (
    select sw.client_id, count(*)::int as n
    from public.pl_scheduled_workouts sw
    where sw.client_id in (select id from base)
      and sw.scheduled_date between v_today - 14 and v_today - 1
      and not exists (
        select 1 from public.pl_day_completions dc
        where dc.scheduled_workout_id = sw.id and dc.completed_at is not null
      )
    group by sw.client_id
  ),
  pay as (
    select pr.client_id,
      bool_or(pr.payment_status in ('Overdue','Failed') and coalesce(pr.service_status,'') <> 'Cancelled') as p_bad,
      bool_or(pr.payment_status in ('Active Subscription','Paid','Partially Paid')
              and coalesce(pr.service_status,'') not in ('Cancelled','Expired')) as p_good,
      bool_or(pr.payment_status in ('Pending Payment','Pending','Unpaid','Payment Link Sent')) as p_pending
    from public.purchase_records pr
    where pr.archived_at is null
      and pr.client_id in (select id from base)
    group by pr.client_id
  ),
  enriched as (
    select
      b.id, b.full_name, b.email, b.profile_picture_url, b.coaching_type,
      b.assigned_coach_id, b.status as client_status, b.account_status,
      b.payment_status, b.needs_admin_help, b.created_at, b.updated_at,
      b.next_program_update,
      b.last_active_at,
      b.last_signed_in_at as last_login_at,
      co.full_name as coach_name,
      cb.id as block_id, cb.name as block_name,
      cb.start_date as block_start, cb.end_date as block_end, cb.status as block_status,
      nb.id as next_block_id, nb.name as next_block_name,
      nb.start_date as next_block_start, nb.end_date as next_block_end, nb.status as next_block_status,
      cn.end_date as nut_end,
      cc.end_date as card_end,
      coalesce(pr.n, 0) as pending_reviews,
      ag.status as coaching_agreement_status,
      ag.signed_at as coaching_agreement_signed_at,
      ag.signed_version as coaching_agreement_version,
      ag.resign_requested_at as coaching_agreement_requested_at,
      ag.exempt_kind as coaching_agreement_exempt_kind,
      ag.last_reminded_at as coaching_agreement_reminded_at,
      coalesce(ag.status not in ('signed', 'exempt'), false) as f_no_contract,
      (
        (
          not (b.account_status in ('Account Created','Active') or b.last_signed_in_at is not null)
          and (
            b.account_status in ('Invite Not Sent','Invite Sent','Invite Expired','Password Reset Sent')
            or (b.agreement_status is not null and b.agreement_status in ('Not Sent','Sent','Pending'))
          )
        )
        or coalesce(array_length(b.preferred_training_days, 1), 0) = 0
      ) as f_needs_setup,
      (coalesce(pr.n,0) > 0) as f_needs_review,
      (cb.end_date is not null and cb.end_date between v_today and v_today + 14 and nb.id is null) as f_program_ending,
      ((cb.id is null or (cb.end_date is not null and cb.end_date < v_today)) and nb.id is null) as f_missing_program,
      ((lower(coalesce(b.payment_status,'')) in ('overdue','failed','past_due','past due'))
        or b.status = 'Payment Overdue'
        or coalesce(py.p_bad, false)) as f_payment_issue,
      (b.created_at > now() - interval '7 days'
        and b.account_status not in ('Active')) as f_new_client,
      (cn.client_id is null or (cn.end_date is not null and cn.end_date < v_today)) as f_missing_nutrition,
      (cc.client_id is null or (cc.end_date is not null and cc.end_date < v_today)) as f_missing_cardio,
      (cb.id is not null and (cb.end_date is null or cb.end_date >= v_today)) as f_has_active_program,
      (b.account_status in ('Account Created','Active') or b.last_signed_in_at is not null) as f_account_activated,
      coalesce(ms.n, 0) as missed_workouts_count,
      (coalesce(ms.n, 0) >= 2) as f_missed_workouts,
      (v_today - coalesce(b.last_active_at, b.last_signed_in_at)::date) as days_inactive,
      (cb.id is not null and (cb.end_date is null or cb.end_date >= v_today)
        and coalesce(b.last_active_at, b.last_signed_in_at) is not null
        and (v_today - coalesce(b.last_active_at, b.last_signed_in_at)::date) >= 7) as f_inactive,
      case
        when lower(coalesce(b.payment_status,'')) in ('complimentary','exempt') then 'exempt'
        when coalesce(py.p_bad, false) then 'past_due'
        when coalesce(py.p_good, false) then 'ok'
        when coalesce(py.p_pending, false) then 'pending'
        else 'not_set_up'
      end as payment_state
    from base b
    left join public.coaches co on co.id = b.assigned_coach_id
    left join cur_block cb on cb.client_id = b.id
    left join next_block nb on nb.client_id = b.id
    left join cur_nut cn on cn.client_id = b.id
    left join cur_card cc on cc.client_id = b.id
    left join pending_reviews pr on pr.client_id = b.id
    left join missed ms on ms.client_id = b.id
    left join pay py on py.client_id = b.id
    left join public.coaching_agreement_client_status ag on ag.client_id = b.id
  ),
  scored as (
    select e.*,
      (e.payment_state = 'not_set_up') as f_no_payment,
      (e.payment_state = 'pending') as f_payment_pending,
      case
        when f_payment_issue then 1
        when f_needs_setup and not f_account_activated then 2
        when f_needs_review then 3
        when payment_state = 'not_set_up' then 4
        when f_no_contract then 5
        when f_missing_program then 6
        when f_program_ending then 7
        when f_missing_nutrition or f_missing_cardio then 8
        when f_needs_setup then 9
        else 10
      end as priority,
      case
        when f_payment_issue then jsonb_build_object('kind','payment','label','Resolve Payment')
        when f_needs_setup and not f_account_activated then jsonb_build_object('kind','setup','label','Open Client')
        when f_needs_review then jsonb_build_object('kind','review','label','Review Check-In')
        when payment_state = 'not_set_up' then jsonb_build_object('kind','payment','label','Set Up Payment')
        when f_missing_program and f_has_active_program = false then jsonb_build_object('kind','assign','label','Assign Program')
        when f_missing_program then jsonb_build_object('kind','assign','label','Assign Next Program')
        when f_program_ending then jsonb_build_object('kind','next_phase','label','Build Next Phase')
        when f_missing_nutrition then jsonb_build_object('kind','nutrition','label','Update Nutrition')
        when f_missing_cardio then jsonb_build_object('kind','cardio','label','Update Cardio')
        else jsonb_build_object('kind','open','label','Open Client')
      end as next_action,
      -- The filters a client matches. Each filter is defined once, here; the list filter
      -- and the per-filter counts below both read it. Keep the keys in step with
      -- src/components/clients/clients-status.ts (a test compares them).
      array_remove(array[
        -- flags:begin
        case when f_needs_setup and not f_account_activated then 'needs_setup' end,
        case when f_needs_review then 'needs_review' end,
        case when f_program_ending then 'program_ending' end,
        case when f_payment_issue then 'payment_issues' end,
        case when payment_state = 'not_set_up' then 'no_payment' end,
        case when payment_state = 'pending' then 'payment_pending' end,
        case when f_new_client then 'new_clients' end,
        case when f_missed_workouts then 'missed_workouts' end,
        case when f_inactive then 'inactive' end,
        case when f_no_contract then 'no_contract' end,
        case when f_missing_program then 'no_program' end,
        case when f_missing_nutrition then 'no_nutrition' end,
        case when f_missing_cardio then 'no_cardio' end
        -- flags:end
      ], null) as flags
    from enriched e
  ),
  count_source as (
    select s.*
    from scored s
    where (p_search is null or p_search = '' or
           s.full_name ilike '%' || p_search || '%' or
           s.email ilike '%' || p_search || '%')
      and (p_coaching_type is null or p_coaching_type = '' or p_coaching_type = 'all'
           or s.coaching_type = p_coaching_type)
      and (p_coach_id is null or s.assigned_coach_id = p_coach_id)
  ),
  filtered as (
    select cs.*
    from count_source cs
    where cs.flags @> v_flags
  ),
  ordered as (
    select *,
      row_number() over (
        order by
          case when p_sort = 'attention' then priority end asc,
          case when p_sort = 'recent' then created_at end desc,
          case when p_sort = 'name' then full_name end asc,
          case when p_sort = 'ending' then block_end end asc nulls last,
          case when p_sort = 'activity' then coalesce(last_active_at, last_login_at, updated_at) end desc nulls last,
          full_name asc
      ) as rn
    from filtered
  )
  select
    coalesce((select jsonb_agg(to_jsonb(o.*) - 'rn' - 'f_account_activated' - 'f_has_active_program' - 'flags' order by o.rn) from ordered o where o.rn > p_offset and o.rn <= p_offset + p_limit), '[]'::jsonb),
    coalesce((select count(*) from filtered), 0),
    coalesce((
      select jsonb_build_object(
        'all', count(*),
        'needs_setup', count(*) filter (where 'needs_setup' = any(flags)),
        'needs_review', count(*) filter (where 'needs_review' = any(flags)),
        'program_ending', count(*) filter (where 'program_ending' = any(flags)),
        'payment_issues', count(*) filter (where 'payment_issues' = any(flags)),
        'no_payment', count(*) filter (where 'no_payment' = any(flags)),
        'payment_pending', count(*) filter (where 'payment_pending' = any(flags)),
        'new_clients', count(*) filter (where 'new_clients' = any(flags)),
        'missed_workouts', count(*) filter (where 'missed_workouts' = any(flags)),
        'inactive', count(*) filter (where 'inactive' = any(flags)),
        'no_contract', count(*) filter (where 'no_contract' = any(flags)),
        'no_program', count(*) filter (where 'no_program' = any(flags)),
        'no_nutrition', count(*) filter (where 'no_nutrition' = any(flags)),
        'no_cardio', count(*) filter (where 'no_cardio' = any(flags))
      )
      from count_source
    ), jsonb_build_object('all', 0, 'needs_setup', 0, 'needs_review', 0, 'program_ending', 0, 'payment_issues', 0, 'no_payment', 0, 'payment_pending', 0, 'new_clients', 0, 'missed_workouts', 0, 'inactive', 0, 'no_contract', 0, 'no_program', 0, 'no_nutrition', 0, 'no_cardio', 0))
  into v_rows, v_total, v_counts;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'counts', v_counts
  );
end;
$function$;

-- get_athlete_rankings (Logging Level rankings): from drizzle/migrations/0009_athlete_xp.sql
CREATE OR REPLACE FUNCTION public.get_athlete_rankings(_limit integer DEFAULT 10)
RETURNS TABLE (client_id uuid, display_name text, avatar_url text, xp bigint, rank bigint, is_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH totals AS (
    SELECT c.id AS client_id,
      COALESCE(NULLIF(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)) AS display_name,
      p.avatar_url,
      COALESCE((SELECT sum(e.xp) FROM public.athlete_xp_events e WHERE e.client_id = c.id), 0)::bigint AS xp,
      (c.user_id = auth.uid()) AS is_me
    FROM public.clients c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE COALESCE(c.archived, false) = false AND c.archived_at IS NULL AND COALESCE(c.status,'') <> 'Archived'
      AND c.athlete_kind = 'coaching'
  ), ranked AS (
    SELECT t.*, rank() OVER (ORDER BY t.xp DESC, t.display_name) AS rank FROM totals t
  )
  SELECT client_id, display_name, avatar_url, xp, rank, COALESCE(is_me,false)
  FROM ranked
  WHERE auth.uid() IS NOT NULL AND (rank <= LEAST(GREATEST(_limit,1),50) OR is_me)
  ORDER BY rank;
$$;
