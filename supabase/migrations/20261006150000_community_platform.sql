-- Community platform, v2 (builds on 20261006090000_community_sharing).
--
--   * Full workout breakdown for a shared post (Strava-style activity page):
--     every exercise with sets done, best set and the record it earned, read
--     live from the same record functions the recap uses.
--   * "Session N this month" on cards: counted from completions, in the
--     athlete's own timezone.
--   * Lightweight profiles: a short optional bio. No followers, no counts of
--     reactions, no ranking.
--   * "New posts" badge: the last time a person opened the community, stored
--     server-side so it is the same on every device.
-- Everything is additive; nothing existing is altered except the read-only
-- feed / stats functions, which are replaced in place.

-- ── Stats: + sessions this month / this week ───────────────────────────────
CREATE OR REPLACE FUNCTION public.community_workout_stats(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pc record;
  k text;
  tz text;
  v_title text;
  v_working int := 0;
  v_tonnage numeric := 0;
  v_top jsonb;
  v_prs jsonb := '[]'::jsonb;
  v_pr_count int := 0;
  v_month int := 0;
  v_week int := 0;
BEGIN
  SELECT * INTO pc FROM public.pl_day_completions WHERE id = _completion_id AND completed_at IS NOT NULL;
  IF pc.id IS NULL THEN RETURN NULL; END IF;
  k := CASE WHEN pc.scheduled_workout_id IS NOT NULL THEN 'sw:' || pc.scheduled_workout_id ELSE 'day:' || pc.day_id END;
  SELECT coalesce(nullif(btrim(c.timezone), ''), 'America/Winnipeg') INTO tz FROM public.clients c WHERE c.id = pc.client_id;
  tz := coalesce(tz, 'America/Winnipeg');

  SELECT coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout')
    INTO v_title FROM public.pl_days d WHERE d.id = pc.day_id;

  SELECT count(*)::int INTO v_working
    FROM public.pl_row_results r
    JOIN public.pl_exercise_rows e ON e.id = r.row_id
   WHERE r.client_id = pc.client_id
     AND r.completed_at IS NOT NULL
     AND coalesce(r.is_working_set, true)
     AND ((pc.scheduled_workout_id IS NOT NULL AND r.scheduled_workout_id = pc.scheduled_workout_id)
       OR (pc.scheduled_workout_id IS NULL AND r.scheduled_workout_id IS NULL AND e.day_id = pc.day_id));

  SELECT coalesce(round(sum(s.load_kg * s.reps), 1), 0) INTO v_tonnage
    FROM public.client_qualifying_sets(pc.client_id) s WHERE s.workout_key = k;

  -- Primary lift = the first programmed exercise with a qualifying set; its
  -- best set across ALL of its rows (a ramp/top-set row before the work sets
  -- must not become the headline).
  WITH qs AS (
    SELECT s.exercise_key, s.exercise_name, s.reps, s.load_kg, e.sort_order
      FROM public.client_qualifying_sets(pc.client_id) s
      JOIN public.pl_row_results r ON r.id = s.set_id
      JOIN public.pl_exercise_rows e ON e.id = r.row_id
     WHERE s.workout_key = k
  ),
  primary_lift AS (SELECT qs.exercise_key FROM qs ORDER BY qs.sort_order ASC LIMIT 1)
  SELECT jsonb_build_object('exercise_name', t.exercise_name, 'reps', t.reps, 'load_kg', t.load_kg)
    INTO v_top
    FROM (
      SELECT qs.exercise_name, qs.reps, qs.load_kg
        FROM qs JOIN primary_lift pl ON pl.exercise_key = qs.exercise_key
       ORDER BY (qs.load_kg * (1 + qs.reps / 30.0)) DESC, qs.load_kg DESC
       LIMIT 1) t;

  WITH rec AS (
    SELECT x.exercise_key, x.exercise_name, x.reps, x.load_kg,
           CASE WHEN x.is_atpr THEN 3 WHEN x.is_program_pr THEN 2 WHEN x.is_block_pr THEN 1 ELSE 0 END AS tier
      FROM public.client_rep_records(pc.client_id) x
     WHERE x.workout_key = k AND (x.is_atpr OR x.is_program_pr OR x.is_block_pr)
    UNION ALL
    SELECT y.exercise_key, y.exercise_name, y.reps, y.load_kg,
           CASE WHEN y.is_atpr THEN 3 WHEN y.is_program_pr THEN 2 WHEN y.is_block_pr THEN 1 ELSE 0 END
      FROM public.client_load_records(pc.client_id) y
     WHERE y.workout_key = k AND (y.is_atpr OR y.is_program_pr OR y.is_block_pr)
  ),
  per_lift AS (
    SELECT DISTINCT ON (exercise_key) exercise_key, exercise_name, reps, load_kg, tier
      FROM rec ORDER BY exercise_key, tier DESC, load_kg DESC, reps DESC
  )
  SELECT (SELECT count(*) FROM per_lift)::int,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                     'exercise_name', q.exercise_name, 'reps', q.reps, 'load_kg', q.load_kg,
                     'scope', CASE q.tier WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' ELSE 'block_pr' END)
                   ORDER BY q.tier DESC, q.load_kg DESC)
                     FROM (SELECT * FROM per_lift ORDER BY tier DESC, load_kg DESC LIMIT 3) q), '[]'::jsonb)
    INTO v_pr_count, v_prs;

  -- Completed sessions in the same local month / ISO week, up to and including this one.
  SELECT count(*) FILTER (WHERE date_trunc('month', c2.completed_at AT TIME ZONE tz) = date_trunc('month', pc.completed_at AT TIME ZONE tz))::int,
         count(*) FILTER (WHERE date_trunc('week', c2.completed_at AT TIME ZONE tz) = date_trunc('week', pc.completed_at AT TIME ZONE tz))::int
    INTO v_month, v_week
    FROM public.pl_day_completions c2
   WHERE c2.client_id = pc.client_id
     AND c2.completed_at IS NOT NULL
     AND c2.completed_at <= pc.completed_at
     AND c2.completed_at >= pc.completed_at - interval '32 days';

  RETURN jsonb_build_object(
    'workout_title', v_title,
    'completed_at', pc.completed_at,
    'duration_min', nullif(pc.actual_duration_min, 0),
    'working_sets', v_working,
    'tonnage_kg', v_tonnage,
    'top_lift', v_top,
    'pr_count', v_pr_count,
    'prs', v_prs,
    'month_sessions', v_month,
    'week_sessions', v_week);
END;
$$;
REVOKE ALL ON FUNCTION public.community_workout_stats(uuid) FROM PUBLIC, anon, authenticated;

-- ── Exercise breakdown (the "activity page") ───────────────────────────────
-- One line per exercise (rows of the same lift are merged), in programmed
-- order: working sets done, best set (highest estimated 1RM among external-load
-- sets), best reps / longest hold otherwise, and the top record it earned.
CREATE OR REPLACE FUNCTION public.community_workout_exercises(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pc record;
  k text;
  v_out jsonb;
BEGIN
  SELECT * INTO pc FROM public.pl_day_completions WHERE id = _completion_id AND completed_at IS NOT NULL;
  IF pc.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  k := CASE WHEN pc.scheduled_workout_id IS NOT NULL THEN 'sw:' || pc.scheduled_workout_id ELSE 'day:' || pc.day_id END;

  WITH sets AS (
    SELECT r.id AS set_id, e.sort_order,
           coalesce(x.name, nullif(btrim(e.exercise_name_override), ''), 'Exercise') AS name,
           CASE WHEN e.exercise_id IS NOT NULL THEN 'id:' || e.exercise_id
                ELSE 'name:' || public.pl_norm_exercise_name(e.exercise_name_override) END AS ekey,
           r.actual_reps, r.completed_duration_seconds
      FROM public.pl_row_results r
      JOIN public.pl_exercise_rows e ON e.id = r.row_id
      LEFT JOIN public.exercises x ON x.id = e.exercise_id
     WHERE r.client_id = pc.client_id
       AND r.completed_at IS NOT NULL
       AND coalesce(r.is_working_set, true)
       AND ((pc.scheduled_workout_id IS NOT NULL AND r.scheduled_workout_id = pc.scheduled_workout_id)
         OR (pc.scheduled_workout_id IS NULL AND r.scheduled_workout_id IS NULL AND e.day_id = pc.day_id))
  ),
  q AS (SELECT s.set_id, s.load_kg, s.reps FROM public.client_qualifying_sets(pc.client_id) s WHERE s.workout_key = k),
  rec AS (
    SELECT z.exercise_key, max(z.tier) AS tier FROM (
      SELECT x.exercise_key, CASE WHEN x.is_atpr THEN 3 WHEN x.is_program_pr THEN 2 WHEN x.is_block_pr THEN 1 ELSE 0 END AS tier
        FROM public.client_rep_records(pc.client_id) x WHERE x.workout_key = k
      UNION ALL
      SELECT y.exercise_key, CASE WHEN y.is_atpr THEN 3 WHEN y.is_program_pr THEN 2 WHEN y.is_block_pr THEN 1 ELSE 0 END
        FROM public.client_load_records(pc.client_id) y WHERE y.workout_key = k
    ) z GROUP BY z.exercise_key
  ),
  per AS (
    SELECT ekey, min(sort_order) AS so, min(name) AS name, count(*)::int AS n,
           max(actual_reps) AS max_reps, max(completed_duration_seconds) AS max_secs
      FROM sets GROUP BY ekey
  ),
  best AS (
    SELECT DISTINCT ON (sets.ekey) sets.ekey, q.load_kg, q.reps
      FROM sets JOIN q ON q.set_id = sets.set_id
     ORDER BY sets.ekey, (q.load_kg * (1 + q.reps / 30.0)) DESC, q.load_kg DESC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', per.name,
           'sets', per.n,
           'best_load_kg', best.load_kg,
           'best_reps', best.reps,
           'max_reps', per.max_reps,
           'max_seconds', per.max_secs,
           'pr', CASE coalesce(rec.tier, 0) WHEN 3 THEN 'atpr' WHEN 2 THEN 'program_pr' WHEN 1 THEN 'block_pr' END)
         ORDER BY per.so, per.name), '[]'::jsonb)
    INTO v_out
    FROM per
    LEFT JOIN best ON best.ekey = per.ekey
    LEFT JOIN rec ON rec.exercise_key = per.ekey;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_workout_exercises(uuid) FROM PUBLIC, anon, authenticated;

-- Composer preview: stats + exercises (the "Stats" card lists the top lifts).
CREATE OR REPLACE FUNCTION public.community_completion_preview(_completion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
     WHERE pc.id = _completion_id AND c.user_id = auth.uid() AND pc.completed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN public.community_workout_stats(_completion_id)
         || jsonb_build_object('exercises', public.community_workout_exercises(_completion_id));
END;
$$;
REVOKE ALL ON FUNCTION public.community_completion_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_completion_preview(uuid) TO authenticated;

-- ── One post, shaped for the client (shared by feed + detail) ─────────────
CREATE OR REPLACE FUNCTION public.community_post_json(_post_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', n.id,
    'created_at', n.created_at,
    'visibility', n.visibility,
    'caption', n.caption,
    'media_path', n.media_path,
    'media_thumb_path', n.media_thumb_path,
    'media_type', n.media_type,
    'media_width', n.media_width,
    'media_height', n.media_height,
    'completion_id', n.completion_id,
    'is_mine', n.author_user_id = _viewer,
    'author', public.community_author(n.author_user_id),
    'stats', public.community_workout_stats(n.completion_id),
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                    ORDER BY r.created_at)
                                   FROM public.community_reactions r
                                  WHERE r.post_id = n.id
                                    AND (public.has_role(r.user_id, 'admin') OR public.has_role(r.user_id, 'coach'))), '[]'::jsonb),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND (public.has_role(c.author_user_id, 'admin') OR public.has_role(c.author_user_id, 'coach'))))
  FROM public.community_posts n WHERE n.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_post_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_feed(
  _limit int DEFAULT 10,
  _before_at timestamptz DEFAULT NULL,
  _before_id uuid DEFAULT NULL,
  _author_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(_limit, 10), 1), 30);
  result jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH page AS (
    SELECT p.id, p.created_at FROM public.community_posts p
     WHERE (p.visibility = 'community' OR (p.author_user_id = uid AND _author_user_id = uid))
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id)
       AND (_before_at IS NULL OR (p.created_at, p.id) < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT lim + 1
  ),
  numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.created_at DESC, page.id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((SELECT jsonb_agg(public.community_post_json(n.id, uid) ORDER BY n.rn) FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.community_feed(int, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_feed(int, timestamptz, uuid, uuid) TO authenticated;

-- Detail: the post + the full exercise breakdown.
CREATE OR REPLACE FUNCTION public.community_post(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_completion uuid;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.completion_id INTO v_completion FROM public.community_posts p
   WHERE p.id = _post_id AND (p.visibility = 'community' OR p.author_user_id = uid);
  IF v_completion IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN public.community_post_json(_post_id, uid)
         || jsonb_build_object('exercises', public.community_workout_exercises(v_completion));
END;
$$;
REVOKE ALL ON FUNCTION public.community_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post(uuid) TO authenticated;

-- ── Profiles ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bio text CHECK (bio IS NULL OR char_length(bio) <= 150),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_profiles FROM anon, authenticated;
GRANT ALL ON public.community_profiles TO service_role;

-- What anyone in the community may see about a person: name, photo, bio, how
-- many workouts they chose to share (yours include private ones), and since
-- when they've trained here. No reaction totals, no rankings.
CREATE OR REPLACE FUNCTION public.community_profile(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'author', public.community_author(_user_id),
    'bio', (SELECT cp.bio FROM public.community_profiles cp WHERE cp.user_id = _user_id),
    'is_me', _user_id = uid,
    'posts', (SELECT count(*) FROM public.community_posts p
               WHERE p.author_user_id = _user_id AND (p.visibility = 'community' OR _user_id = uid)),
    'training_since', (SELECT min(pc.completed_at) FROM public.pl_day_completions pc
                         JOIN public.clients c ON c.id = pc.client_id
                        WHERE c.user_id = _user_id AND pc.completed_at IS NOT NULL));
END;
$$;
REVOKE ALL ON FUNCTION public.community_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_set_bio(_bio text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_bio text := nullif(btrim(coalesce(_bio, '')), '');
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_bio IS NOT NULL AND char_length(v_bio) > 150 THEN RAISE EXCEPTION 'Keep your bio under 150 characters'; END IF;
  INSERT INTO public.community_profiles (user_id, bio, updated_at) VALUES (uid, v_bio, now())
  ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.community_set_bio(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_set_bio(text) TO authenticated;

-- ── "New posts" badge (seen state is server-side, never localStorage) ──────
CREATE TABLE IF NOT EXISTS public.community_seen (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_seen FROM anon, authenticated;
GRANT ALL ON public.community_seen TO service_role;

-- New shared posts by other people since you last opened the community
-- (first visit: the last 7 days). Capped at 99.
CREATE OR REPLACE FUNCTION public.community_activity()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_seen timestamptz;
BEGIN
  IF NOT public.can_view_community() THEN RETURN jsonb_build_object('unseen', 0, 'seen_at', null, 'enabled', false); END IF;
  SELECT s.seen_at INTO v_seen FROM public.community_seen s WHERE s.user_id = uid;
  RETURN jsonb_build_object(
    'enabled', true,
    'seen_at', v_seen,
    'unseen', (SELECT count(*) FROM (
                 SELECT 1 FROM public.community_posts p
                  WHERE p.visibility = 'community' AND p.author_user_id <> uid
                    AND p.created_at > coalesce(v_seen, now() - interval '7 days')
                  LIMIT 99) x));
END;
$$;
REVOKE ALL ON FUNCTION public.community_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_activity() TO authenticated;

CREATE OR REPLACE FUNCTION public.community_mark_seen()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.community_seen (user_id, seen_at) VALUES (uid, now())
  ON CONFLICT (user_id) DO UPDATE SET seen_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.community_mark_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_mark_seen() TO authenticated;
