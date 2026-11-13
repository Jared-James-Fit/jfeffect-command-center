-- Crew loads fast: a post is no longer rebuilt from scratch on every read.
--
-- Nov 14 2026: the coach asked for posts to load very fast, for a smooth
-- watch and scroll. Measured on production as a client: every workout post
-- cost the database 140-320 ms to build (community_post_json), so a page of
-- five took ~870 ms and the story rail's community_feed(10) 2.1 s. Half of
-- each post was its workout stats (community_workout_stats walks the
-- athlete's whole history for PRs, ~108 ms), and most of the rest was people
-- lookups: community_author ran the "is this a coach?" role check on every
-- profile in the table (the planner pushed has_role into the union's scan),
-- ~7 ms a call, and community_is_coach built a whole person card (photo,
-- client and coach rows) to answer yes or no, twice for every reaction.
--
-- 1. community_author / community_avatar: `accounts AS MATERIALIZED`, so the
--    role check runs on the person's own one or two accounts only (identical
--    answers for every person on file, 2.7x faster).
-- 2. community_is_coach: the same rule as community_author's is_coach,
--    without building the card (identical answers, 20x faster).
-- 3. Workout stats are stored per finished workout
--    (community_workout_stats_cache) and read back while still true
--    (community_workout_stats_cached): a stored copy counts only while its
--    athlete's version (community_workout_stats_versions) hasn't moved since
--    it was made, and for a day at most. A workout's stats depend only on its
--    own sets and the athlete's earlier training (PRs compare with earlier
--    workouts only, the month / week counts with earlier ones), its day and
--    block names and the athlete's time zone, so the version moves
--    (community_stats_bump) when a logged set changes at or before a finished
--    workout, a workout is finished or changed, a finished day or its
--    exercises are renamed or reordered, the athlete's blocks or weeks change,
--    their time zone changes, or an exercise is renamed; sets logged in a
--    workout still going never move it (nothing finished comes after them).
--    The version is read before the stats are worked out, so a change that
--    lands meanwhile leaves the copy stale, never wrong. Anything not stored
--    yet is worked out as before.
-- 4. pg_cron community-workout-stats (every minute) stores what's missing or
--    stale for every workout post, newest first, 40 a run.
-- 5. community_post_json reads the stored stats; nothing else about a post
--    changes.

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'community_post_json' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '700a0638604917c285ba29918f38bf68' THEN
    RAISE EXCEPTION 'community_post_json changed since this migration was written';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'community_author' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '2f6b239008e8e2cd5653078ef46cbe3a' THEN
    RAISE EXCEPTION 'community_author changed since this migration was written';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'community_avatar' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM '29c540de683f98403f134a3040897137' THEN
    RAISE EXCEPTION 'community_avatar changed since this migration was written';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'community_is_coach' AND pronamespace = 'public'::regnamespace)
       IS DISTINCT FROM 'ffd785e309fa7a92290ce32c9c05005e' THEN
    RAISE EXCEPTION 'community_is_coach changed since this migration was written';
  END IF;
END $$;

-- 1. People lookups: the role check on the person's own accounts only.
CREATE OR REPLACE FUNCTION public.community_avatar(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT coalesce((SELECT cp0.same_person_as FROM public.community_profiles cp0 WHERE cp0.user_id = _user_id), _user_id) AS uid
  ),
  -- materialized: has_role runs on these one or two accounts, never on every profile
  accounts AS MATERIALIZED (
    SELECT me.uid AS user_id FROM me
    UNION
    SELECT cpl.user_id FROM public.community_profiles cpl JOIN me ON cpl.same_person_as = me.uid
  )
  SELECT coalesce(
    (SELECT cp.avatar_path FROM public.community_profiles cp JOIN me ON cp.user_id = me.uid),
    (SELECT c3.profile_picture_url
       FROM public.coaches c3 JOIN accounts a ON a.user_id = c3.user_id
      WHERE nullif(btrim(c3.profile_picture_url), '') IS NOT NULL
        AND (EXISTS (SELECT 1 FROM public.community_profiles t JOIN me ON t.user_id = me.uid WHERE t.title IS NOT NULL)
             OR EXISTS (SELECT 1 FROM accounts a2
                         WHERE public.has_role(a2.user_id, 'admin') OR public.has_role(a2.user_id, 'coach')))
      LIMIT 1))
  WHERE _user_id IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.community_author(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT coalesce((SELECT cp0.same_person_as FROM public.community_profiles cp0 WHERE cp0.user_id = _user_id), _user_id) AS uid
  ),
  -- materialized: has_role runs on these one or two accounts, never on every profile
  accounts AS MATERIALIZED (
    SELECT me.uid AS user_id FROM me
    UNION
    SELECT cpl.user_id FROM public.community_profiles cpl JOIN me ON cpl.same_person_as = me.uid
  )
  SELECT jsonb_build_object(
    'user_id', me.uid,
    'is_coach', (staff.yes OR cp.title IS NOT NULL),
    'title', CASE WHEN staff.yes OR cp.title IS NOT NULL THEN coalesce(cp.title, 'Coach · JF Effect') END,
    'name', CASE
      WHEN cp.title IS NOT NULL THEN coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(co.full_name), ''), nullif(btrim(p.full_name), ''), 'Coach')
      WHEN staff.yes THEN coalesce(nullif(btrim(co.first_name), ''), nullif(split_part(btrim(coalesce(co.full_name, p.full_name, '')), ' ', 1), ''), 'Coach')
      ELSE coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''),
                    nullif(split_part(btrim(coalesce(c.full_name, p.full_name, '')), ' ', 1), ''), 'Athlete') END,
    'avatar_url', public.community_avatar(me.uid),
    'username', cp.username)
  FROM me
  LEFT JOIN public.community_profiles cp ON cp.user_id = me.uid
  LEFT JOIN public.profiles p ON p.id = me.uid
  LEFT JOIN LATERAL (SELECT * FROM public.clients c1 WHERE c1.user_id = me.uid LIMIT 1) c ON true
  LEFT JOIN LATERAL (SELECT * FROM public.coaches c2 WHERE c2.user_id = me.uid LIMIT 1) co ON true
  LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM accounts a WHERE public.has_role(a.user_id, 'admin') OR public.has_role(a.user_id, 'coach')) AS yes) staff ON true
$function$;

-- 2. "Is this a coach?": community_author's own rule, without building the card.
CREATE OR REPLACE FUNCTION public.community_is_coach(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT coalesce((SELECT cp0.same_person_as FROM public.community_profiles cp0 WHERE cp0.user_id = _user_id), _user_id) AS uid
  ),
  accounts AS MATERIALIZED (
    SELECT me.uid AS user_id FROM me
    UNION
    SELECT cpl.user_id FROM public.community_profiles cpl JOIN me ON cpl.same_person_as = me.uid
  )
  SELECT EXISTS (SELECT 1 FROM public.community_profiles cp JOIN me ON cp.user_id = me.uid WHERE cp.title IS NOT NULL)
      OR EXISTS (SELECT 1 FROM accounts a WHERE public.has_role(a.user_id, 'admin') OR public.has_role(a.user_id, 'coach'))
$function$;

-- 3. Stored workout stats.
CREATE TABLE IF NOT EXISTS public.community_workout_stats_versions (
  client_id  uuid PRIMARY KEY,
  version    bigint NOT NULL DEFAULT 1,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.community_workout_stats_cache (
  completion_id uuid PRIMARY KEY REFERENCES public.pl_day_completions(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL,
  version       bigint NOT NULL,
  completed_at  timestamptz,
  stats         jsonb NOT NULL,
  computed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_workout_stats_cache_client_idx ON public.community_workout_stats_cache (client_id);
-- a finished day's workouts, found from the day (renames, reorders)
CREATE INDEX IF NOT EXISTS pl_day_completions_day_done_idx ON public.pl_day_completions (day_id) WHERE completed_at IS NOT NULL;

-- read and written only inside the database's own functions
ALTER TABLE public.community_workout_stats_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_workout_stats_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_workout_stats_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.community_workout_stats_cache FROM PUBLIC, anon, authenticated;

-- Moves an athlete's version, so every stored copy of theirs is worked out again.
-- `_from`: when the change takes effect in their training; it only matters when a
-- finished workout comes at or after it (null: always).
CREATE OR REPLACE FUNCTION public.community_stats_bump(_client_id uuid, _from timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _client_id IS NULL THEN RETURN; END IF;
  IF _from IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.pl_day_completions pc
        WHERE pc.client_id = _client_id AND pc.completed_at IS NOT NULL AND pc.completed_at >= _from) THEN
    RETURN;
  END IF;
  INSERT INTO public.community_workout_stats_versions AS v (client_id, version, changed_at)
  VALUES (_client_id, 1, now())
  ON CONFLICT (client_id) DO UPDATE SET version = v.version + 1, changed_at = now();
END
$function$;

-- A logged set: from its own time, or its workout's finish when that's earlier.
CREATE OR REPLACE FUNCTION public.community_stats_bump_set(_client_id uuid, _row_id uuid, _sw uuid, _at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz;
BEGIN
  SELECT min(pc.completed_at) INTO v_from
    FROM public.pl_day_completions pc
   WHERE pc.client_id = _client_id AND pc.completed_at IS NOT NULL
     AND (pc.day_id = (SELECT e.day_id FROM public.pl_exercise_rows e WHERE e.id = _row_id)
          OR (_sw IS NOT NULL AND pc.scheduled_workout_id = _sw));
  PERFORM public.community_stats_bump(_client_id, least(_at, v_from));
END
$function$;

CREATE OR REPLACE FUNCTION public.tg_community_stats_sets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - ARRAY['updated_at', 'notes', 'video_url']) = (to_jsonb(NEW) - ARRAY['updated_at', 'notes', 'video_url']) THEN
      RETURN NULL;
    END IF;
  END IF;
  -- a set nobody finished is in no workout's stats
  IF TG_OP <> 'INSERT' THEN
    IF OLD.completed_at IS NOT NULL THEN
      PERFORM public.community_stats_bump_set(OLD.client_id, OLD.row_id, OLD.scheduled_workout_id, OLD.completed_at);
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.completed_at IS NOT NULL THEN
      PERFORM public.community_stats_bump_set(NEW.client_id, NEW.row_id, NEW.scheduled_workout_id, NEW.completed_at);
    END IF;
  END IF;
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_sets ON public.pl_row_results;
CREATE TRIGGER community_stats_sets
  AFTER INSERT OR UPDATE OR DELETE ON public.pl_row_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_stats_sets();

-- A workout finished, changed or unfinished: from when it was finished.
CREATE OR REPLACE FUNCTION public.tg_community_stats_completions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
      RETURN NULL;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    -- its own copy goes either way (an unfinished workout has no stats)
    DELETE FROM public.community_workout_stats_cache WHERE completion_id = OLD.id;
    v_from := OLD.completed_at;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_from := least(v_from, NEW.completed_at);
  END IF;
  IF v_from IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.community_stats_bump(OLD.client_id, v_from);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.community_stats_bump(NEW.client_id, v_from);
  END IF;
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_completions ON public.pl_day_completions;
CREATE TRIGGER community_stats_completions
  AFTER INSERT OR UPDATE OR DELETE ON public.pl_day_completions
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_stats_completions();

-- A finished day renamed or moved, or its exercises renamed, swapped or reordered.
CREATE OR REPLACE FUNCTION public.community_stats_bump_day(_day_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF _day_id IS NULL THEN RETURN; END IF;
  FOR r IN SELECT pc.client_id, min(pc.completed_at) AS at
             FROM public.pl_day_completions pc
            WHERE pc.day_id = _day_id AND pc.completed_at IS NOT NULL
            GROUP BY pc.client_id LOOP
    PERFORM public.community_stats_bump(r.client_id, r.at);
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.tg_community_stats_days()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.community_stats_bump_day(NEW.id);
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_days ON public.pl_days;
CREATE TRIGGER community_stats_days
  AFTER UPDATE OF title, subtitle, week_id ON public.pl_days
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_stats_days();

CREATE OR REPLACE FUNCTION public.tg_community_stats_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.community_stats_bump_day(OLD.day_id);
  IF NEW.day_id IS DISTINCT FROM OLD.day_id THEN
    PERFORM public.community_stats_bump_day(NEW.day_id);
  END IF;
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_rows ON public.pl_exercise_rows;
CREATE TRIGGER community_stats_rows
  AFTER UPDATE OF exercise_id, exercise_name_override, sort_order, day_id ON public.pl_exercise_rows
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_stats_rows();

-- Blocks and weeks name every workout of the athlete's ("Block 2 · Week 3").
CREATE OR REPLACE FUNCTION public.tg_community_stats_blocks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.community_stats_bump(OLD.client_id);
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.community_stats_bump(NEW.client_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      PERFORM public.community_stats_bump(NEW.client_id);
    END IF;
  END IF;
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_blocks ON public.pl_blocks;
CREATE TRIGGER community_stats_blocks
  AFTER INSERT OR DELETE OR UPDATE OF archived, prep_id, start_date, client_id, training_focus ON public.pl_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_stats_blocks();

CREATE OR REPLACE FUNCTION public.tg_community_stats_weeks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.community_stats_bump(b.client_id)
     FROM public.pl_blocks b WHERE b.id IN (OLD.block_id, NEW.block_id);
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_weeks ON public.pl_weeks;
CREATE TRIGGER community_stats_weeks
  AFTER UPDATE OF week_index, block_id ON public.pl_weeks
  FOR EACH ROW EXECUTE FUNCTION public.tg_community_stats_weeks();

CREATE OR REPLACE FUNCTION public.tg_community_stats_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.community_stats_bump(NEW.id);
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_timezone ON public.clients;
CREATE TRIGGER community_stats_timezone
  AFTER UPDATE OF timezone ON public.clients
  FOR EACH ROW WHEN (OLD.timezone IS DISTINCT FROM NEW.timezone)
  EXECUTE FUNCTION public.tg_community_stats_timezone();

-- An exercise renamed: every stored copy (they name exercises).
CREATE OR REPLACE FUNCTION public.tg_community_stats_exercises()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.community_workout_stats_versions AS v (client_id, version, changed_at)
  SELECT DISTINCT c.client_id, 1, now() FROM public.community_workout_stats_cache c
  ON CONFLICT (client_id) DO UPDATE SET version = v.version + 1, changed_at = now();
  RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS community_stats_exercises ON public.exercises;
CREATE TRIGGER community_stats_exercises
  AFTER UPDATE OF name ON public.exercises
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_community_stats_exercises();

REVOKE ALL ON FUNCTION public.community_stats_bump(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_stats_bump_set(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_stats_bump_day(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_sets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_completions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_days() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_blocks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_weeks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_timezone() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_community_stats_exercises() FROM PUBLIC, anon, authenticated;

-- The stored stats while they're still true, else worked out as before.
CREATE OR REPLACE FUNCTION public.community_workout_stats_cached(_completion_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT s.stats FROM public.community_workout_stats_cache s
      WHERE s.completion_id = _completion_id
        AND s.version = coalesce((SELECT v.version FROM public.community_workout_stats_versions v WHERE v.client_id = s.client_id), 0)
        AND s.computed_at > now() - interval '1 day'),
    public.community_workout_stats(_completion_id))
$function$;
REVOKE ALL ON FUNCTION public.community_workout_stats_cached(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Stores what's missing or stale for every workout post, newest first.
CREATE OR REPLACE FUNCTION public.community_workout_stats_refresh(_limit integer DEFAULT 40)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v bigint;
  s jsonb;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT pc.id, pc.client_id, pc.completed_at
      FROM public.pl_day_completions pc
     WHERE pc.completed_at IS NOT NULL
       AND pc.id IN (SELECT p.completion_id FROM public.community_posts p
                      WHERE p.completion_id IS NOT NULL AND p.archived_at IS NULL)
       AND NOT EXISTS (
             SELECT 1 FROM public.community_workout_stats_cache c
              WHERE c.completion_id = pc.id
                AND c.version = coalesce((SELECT v2.version FROM public.community_workout_stats_versions v2 WHERE v2.client_id = pc.client_id), 0)
                AND c.computed_at > now() - interval '20 hours')
     ORDER BY pc.completed_at DESC
     LIMIT greatest(1, least(coalesce(_limit, 40), 500))
  LOOP
    -- the version first, then the stats: a change that lands in between leaves the copy stale, never wrong
    v := coalesce((SELECT v2.version FROM public.community_workout_stats_versions v2 WHERE v2.client_id = r.client_id), 0);
    s := public.community_workout_stats(r.id);
    IF s IS NOT NULL THEN
      INSERT INTO public.community_workout_stats_cache (completion_id, client_id, version, completed_at, stats, computed_at)
      VALUES (r.id, r.client_id, v, r.completed_at, s, now())
      ON CONFLICT (completion_id) DO UPDATE
        SET client_id = EXCLUDED.client_id, version = EXCLUDED.version, completed_at = EXCLUDED.completed_at,
            stats = EXCLUDED.stats, computed_at = EXCLUDED.computed_at;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.community_workout_stats_refresh(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_workout_stats_refresh(integer) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'community-workout-stats';
  PERFORM cron.schedule('community-workout-stats', '* * * * *', $cmd$SELECT public.community_workout_stats_refresh(40)$cmd$);
END $$;

-- 5. A post reads its workout's stored stats.
DO $$
DECLARE
  d text;
  was text := 'public.community_workout_stats(n.completion_id)';
  now_ text := 'public.community_workout_stats_cached(n.completion_id)';
BEGIN
  d := pg_get_functiondef('public.community_post_json(uuid,uuid)'::regprocedure);
  IF (length(d) - length(replace(d, was, ''))) / length(was) <> 2 THEN
    RAISE EXCEPTION 'community_post_json: expected its two stats calls';
  END IF;
  EXECUTE replace(d, was, now_);
END $$;
