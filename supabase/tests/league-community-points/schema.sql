-- Stand-ins for the community + Logging Level tables used by
-- 20261012110000_league_community_post_points.sql. Load AFTER
-- supabase/tests/league-boost/schema.sql (see README).

-- Ledger columns the real athlete_xp_events has.
alter table athlete_xp_events add column source_table text, add column source_key text, add column label text;
alter table athlete_xp_events add constraint athlete_xp_events_source_key_unique unique (client_id, source_key);

-- Training-record sources (league records): none in these scenarios.
create function client_rep_records(_client_id uuid)
returns table(workout_key text, exercise_key text, exercise_name text, completed boolean, workout_at timestamptz,
              is_atpr boolean, is_program_pr boolean, is_block_pr boolean)
language sql stable as $$ select null::text, null::text, null::text, false, null::timestamptz, false, false, false where false $$;
create function client_load_records(_client_id uuid)
returns table(workout_key text, exercise_key text, exercise_name text, completed boolean, workout_at timestamptz,
              is_atpr boolean, is_program_pr boolean, is_block_pr boolean)
language sql stable as $$ select null::text, null::text, null::text, false, null::timestamptz, false, false, false where false $$;

create function portal_viewer_uid(_as_user uuid) returns uuid language sql stable as $$ select coalesce(_as_user, auth.uid()) $$;

-- Community.
create table community_coaches (user_id uuid primary key);
create function community_is_coach(_user_id uuid) returns boolean language sql stable as $$
  select exists (select 1 from community_coaches where user_id = _user_id) $$;
create function community_main_account(_user_id uuid) returns uuid language sql stable as $$ select _user_id $$;

create table community_posts (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null,
  client_id uuid,
  completion_id uuid unique references pl_day_completions(id) on delete cascade,
  kind text not null default 'workout',
  visibility text not null default 'community',
  archived_at timestamptz,
  archived_from text,
  caption text,
  created_at timestamptz not null default now()
);
create table community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references community_posts(id) on delete cascade,
  author_user_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Logging Level badges.
create table athlete_badge_catalog (
  badge_key text primary key, name text, category text, icon_key text, rarity text, description text, requirement text,
  metric text, event_type text, threshold int, is_public boolean, is_active boolean, sort_order int);
create table athlete_achievements (client_id uuid, badge_key text, earned_at timestamptz, unique (client_id, badge_key));

-- Real helpers, copied from drizzle/migrations/0011_logging_level_expansion.sql.
CREATE OR REPLACE FUNCTION public.xp_client_for_user(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients WHERE user_id = _uid
  ORDER BY COALESCE(archived,false), created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.award_athlete_xp(
  _client uuid, _type text, _src_table text, _src_id uuid, _key text, _xp int, _label text, _at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _client IS NULL OR _key IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client) THEN RETURN; END IF;
  INSERT INTO public.athlete_xp_events (client_id, event_type, source_table, source_id, source_key, xp, label, occurred_at)
  VALUES (_client, _type, _src_table, _src_id, _key, _xp, _label, COALESCE(_at, now()))
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.sync_athlete_achievements(_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.athlete_achievements (client_id, badge_key, earned_at)
  SELECT _client_id, b.badge_key, e.met_at
  FROM public.athlete_badge_catalog b
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN b.metric IN ('workouts_completed','workouts_fully_logged','event_count') THEN (
        SELECT x.occurred_at FROM (
          SELECT occurred_at, row_number() OVER (ORDER BY occurred_at, id) AS rn
          FROM public.athlete_xp_events
          WHERE client_id = _client_id AND event_type = CASE b.metric
            WHEN 'workouts_completed' THEN 'workout_completed'
            WHEN 'workouts_fully_logged' THEN 'workout_fully_logged'
            ELSE b.event_type END
        ) x WHERE x.rn = b.threshold)
      WHEN b.metric = 'xp' THEN (
        SELECT min(x.occurred_at) FROM (
          SELECT occurred_at, sum(xp) OVER (ORDER BY occurred_at, id) AS running
          FROM public.athlete_xp_events WHERE client_id = _client_id
        ) x WHERE x.running >= b.threshold)
      WHEN b.metric = 'days_since_first_workout' THEN (
        SELECT min(occurred_at) + make_interval(days => b.threshold)
        FROM public.athlete_xp_events WHERE client_id = _client_id AND event_type = 'workout_completed')
      WHEN b.metric = 'tracking_weeks' THEN (
        SELECT w.first_at FROM (
          SELECT min(occurred_at) AS first_at, row_number() OVER (ORDER BY min(occurred_at)) AS rn
          FROM public.athlete_xp_events WHERE client_id = _client_id
          GROUP BY date_trunc('week', occurred_at)
        ) w WHERE w.rn = b.threshold)
      WHEN b.metric = 'legacy_og' THEN (
        SELECT c.created_at FROM public.clients c
        WHERE c.id = _client_id AND c.created_at < timestamptz '2026-07-01 00:00:00+00')
      WHEN b.metric = 'legacy_founding' THEN (
        SELECT min(occurred_at) FROM public.athlete_xp_events
        WHERE client_id = _client_id AND event_type = 'workout_completed'
        HAVING min(occurred_at) < timestamptz '2026-07-01 00:00:00+00')
    END AS met_at
  ) e
  WHERE b.is_active AND e.met_at IS NOT NULL AND e.met_at <= now()
  ON CONFLICT (client_id, badge_key) DO NOTHING;
END $$;

-- Scenario helpers.
create function t_done(_client uuid, _at timestamptz) returns uuid language plpgsql as $$
declare comp uuid;
begin
  insert into pl_day_completions(day_id, client_id, completed_at) values (gen_random_uuid(), _client, _at) returning id into comp;
  return comp;
end $$;
create function t_post(_client uuid, _completion uuid, _at timestamptz, _vis text default 'community') returns uuid language plpgsql as $$
declare pid uuid;
begin
  insert into community_posts(author_user_id, client_id, completion_id, visibility, created_at)
  select c.user_id, c.id, _completion, _vis, _at from clients c where c.id = _client returning id into pid;
  return pid;
end $$;
create function t_events(_client uuid, _type text) returns int language sql as $$
  select count(*)::int from athlete_xp_events where client_id = _client and event_type = _type $$;
create function t_uid(_client uuid) returns uuid language sql as $$ select user_id from clients where id = _client $$;
