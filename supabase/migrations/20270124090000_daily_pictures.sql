-- Daily pictures (series 'daily_visual', src/lib/daily-visuals.ts): every
-- morning at 7 (Winnipeg) a picture post that speaks without saying much, one
-- theme a day (Mon courage, Tue patience, Wed your circle, Thu self
-- reflection, Fri encouragement, Sat self love, Sun feelings & rest), the
-- picture speaking to women one day and men the next, and Sunday's carrying a
-- Bible verse (the weekly faith post; the verse is from the app's own vetted
-- list, never written by a model).
--
-- One row a day in community_daily_visuals, planned a week ahead. The
-- daily-visuals-tick hook (daily-visuals.server.ts) writes the line and makes
-- the picture in the background, two days ahead, learning from how the last
-- ones did (community_daily_visual_stats); the community-daily-visuals job
-- posts today's at 7 once it's ready. The coach sees the week in Crew → Posts
-- and can change the words, ask for new words or a new picture, skip a day,
-- post today's early or switch them off. Pausing coach posts stops it too.

-- ── the series ─────────────────────────────────────────────────────────────
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_series_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_series_check CHECK (
  series IS NULL OR (kind = 'note' AND series = ANY (ARRAY[
    'monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday', 'finish_strong_friday',
    'saturday_spirit', 'sunday_recap', 'holiday', 'lesson', 'daily_visual'])));

ALTER TABLE public.community_series_settings ADD COLUMN IF NOT EXISTS daily_visuals_on boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.community_daily_visuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL UNIQUE,
  theme text NOT NULL CHECK (theme IN ('courage', 'patience', 'your_circle', 'self_reflection', 'encouragement', 'self_love', 'emotional')),
  audience text NOT NULL CHECK (audience IN ('women', 'men')),
  faith boolean NOT NULL DEFAULT false,
  -- what the learning picked for it (daily-visuals.ts nextChoices)
  style text CHECK (style IN ('photo', 'illustration')),
  max_chars int CHECK (max_chars BETWEEN 20 AND 300),
  ai_line text CHECK (ai_line IS NULL OR char_length(ai_line) <= 300),
  -- the coach's own words, which always win
  coach_line text CHECK (coach_line IS NULL OR char_length(coach_line) <= 300),
  shot text CHECK (shot IS NULL OR char_length(shot) <= 1500),
  verse_ref text,
  verse_text text,
  picture jsonb,
  picture_provider text,
  model text,
  -- what the writer was told (the learnings and why this look and length)
  learned jsonb,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ready', 'posted', 'skipped', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.community_daily_visuals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read daily pictures" ON public.community_daily_visuals;
CREATE POLICY "Staff read daily pictures" ON public.community_daily_visuals
  FOR SELECT TO authenticated USING ((SELECT public.is_community_staff()));
REVOKE INSERT, UPDATE, DELETE ON public.community_daily_visuals FROM anon, authenticated;

-- ── which theme and who a day speaks to (the same as daily-visuals.ts) ─────
CREATE OR REPLACE FUNCTION public.community_daily_theme(_day date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['courage', 'patience', 'your_circle', 'self_reflection', 'encouragement', 'self_love', 'emotional'])[extract(isodow FROM _day)::int]
$$;

CREATE OR REPLACE FUNCTION public.community_daily_audience(_day date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN (((_day - date '2026-01-05') % 2) + 2) % 2 = 0 THEN 'men' ELSE 'women' END
$$;

-- ── a week planned ahead ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visuals_plan(_from date DEFAULT NULL, _days int DEFAULT 7)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from date := coalesce(_from, public.instant_to_local(now(), 'America/Winnipeg')::date);
  v_n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_daily_visuals (day, theme, audience, faith)
  SELECT d::date, public.community_daily_theme(d::date), public.community_daily_audience(d::date), extract(isodow FROM d) = 7
    FROM generate_series(v_from, v_from + greatest(least(coalesce(_days, 7), 14) - 1, 0), interval '1 day') d
  ON CONFLICT (day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_plan(date, int) FROM PUBLIC, anon, authenticated;

-- ── posting a day's picture ────────────────────────────────────────────────
-- His line (the coach's own words win), and on Sunday the verse under it:
-- the same as dailyCaption in daily-visuals.ts. _backdate puts it at 7 am on
-- its own day (filling in a day that was missed).
CREATE OR REPLACE FUNCTION public.community_daily_visual_post(_day date, _backdate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
  v_settings record;
  v_author uuid;
  v_key text := 'daily_visual:' || _day::text;
  v_line text;
  v_caption text;
  v_at timestamptz;
  v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE day = _day FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'none'); END IF;
  IF r.status = 'posted' THEN RETURN jsonb_build_object('status', 'exists', 'post_id', r.post_id); END IF;
  v_line := btrim(coalesce(nullif(btrim(r.coach_line), ''), r.ai_line));
  IF r.status <> 'ready' OR r.picture IS NULL OR coalesce(v_line, '') = '' THEN RETURN jsonb_build_object('status', 'not_ready'); END IF;

  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RETURN jsonb_build_object('status', 'no_author'); END IF;

  INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, 'daily_visual') ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  v_caption := v_line || CASE WHEN r.faith AND coalesce(r.verse_text, '') <> '' AND coalesce(r.verse_ref, '') <> ''
                              THEN E'\n\n' || '“' || btrim(r.verse_text) || '” ' || r.verse_ref ELSE '' END;
  v_at := CASE WHEN coalesce(_backdate, false) THEN public.local_to_instant(_day + time '07:00', 'America/Winnipeg') ELSE now() END;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at, updated_at)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
          v_caption, 'daily_visual', v_key,
          jsonb_strip_nulls(jsonb_build_object('theme', r.theme, 'audience', r.audience, 'faith', r.faith, 'style', r.style, 'verse', r.verse_ref)),
          v_at, v_at)
  ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
  PERFORM public.community_apply_media(v_id, jsonb_build_array(r.picture));
  UPDATE public.community_posts SET updated_at = v_at WHERE id = v_id;
  UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
  UPDATE public.community_daily_visuals SET status = 'posted', post_id = v_id, updated_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_post(date, boolean) FROM PUBLIC, anon, authenticated;

-- ── the background writer, called when there's work ────────────────────────
-- Work = a day from 3 days back to 2 ahead still missing its words or its
-- picture, not tried in the last 30 minutes (the writer gives up after 4 tries).
CREATE OR REPLACE FUNCTION public.community_daily_visuals_kick(_force boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(_force, false) AND NOT EXISTS (
    SELECT 1 FROM public.community_daily_visuals v
     WHERE v.day BETWEEN v_today - 3 AND v_today + 2 AND v.status = 'planned' AND v.attempts < 4
       AND (v.attempts = 0 OR v.updated_at < now() - interval '30 minutes')) THEN
    RETURN false;
  END IF;
  PERFORM net.http_post(
    url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/daily-visuals-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_hook_secret' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_kick(boolean) FROM PUBLIC, anon, authenticated;

-- ── every 15 minutes: plan the week, post today's at 7, wake the writer ───
CREATE OR REPLACE FUNCTION public.community_publish_daily_visual()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_local timestamp := public.instant_to_local(now(), 'America/Winnipeg');
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public.community_daily_visuals_plan(NULL, 7);
  IF NOT coalesce((SELECT daily_visuals_on FROM public.community_series_settings WHERE id), true) THEN
    RETURN jsonb_build_object('status', 'off');
  END IF;
  IF v_local::time < time '07:00' OR v_local::time >= time '21:00' THEN RETURN jsonb_build_object('status', 'outside_window'); END IF;
  RETURN public.community_daily_visual_post(v_local::date, false);
END;
$$;
REVOKE ALL ON FUNCTION public.community_publish_daily_visual() FROM PUBLIC, anon, authenticated;

-- ── how each posted picture did, for the learning (the coaches left out) ──
CREATE OR REPLACE FUNCTION public.community_daily_visual_stats(_days int DEFAULT 120)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH staff AS (SELECT s AS user_id FROM public.community_staff_people() s WHERE s IS NOT NULL)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day', v.day, 'theme', v.theme, 'audience', v.audience, 'style', coalesce(v.style, 'photo'),
           'line', coalesce(nullif(btrim(v.coach_line), ''), v.ai_line, ''), 'shot', v.shot,
           'viewers', (SELECT count(DISTINCT pv.viewer_user_id) FROM public.community_post_views pv
                        WHERE pv.post_id = v.post_id AND pv.viewer_user_id NOT IN (SELECT user_id FROM staff)),
           'likers', (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r
                       WHERE r.post_id = v.post_id AND r.user_id NOT IN (SELECT user_id FROM staff)),
           'commenters', (SELECT count(DISTINCT c.author_user_id) FROM public.community_comments c
                           WHERE c.post_id = v.post_id AND c.hidden_at IS NULL AND c.author_user_id NOT IN (SELECT user_id FROM staff)),
           'savers', (SELECT count(DISTINCT s.user_id) FROM public.community_saves s
                       WHERE s.post_id = v.post_id AND s.user_id NOT IN (SELECT user_id FROM staff)),
           'reached', (SELECT count(*) FROM public.community_post_attention x
                        WHERE x.post_id = v.post_id AND x.viewer_user_id NOT IN (SELECT user_id FROM staff)),
           'stopped', (SELECT count(*) FROM public.community_post_attention x
                        WHERE x.post_id = v.post_id AND x.seen_ms >= 2000 AND x.viewer_user_id NOT IN (SELECT user_id FROM staff)),
           'median_ms', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.seen_ms) FROM public.community_post_attention x
                          WHERE x.post_id = v.post_id AND x.viewer_user_id NOT IN (SELECT user_id FROM staff))
         ) ORDER BY v.day), '[]'::jsonb)
    FROM public.community_daily_visuals v
    JOIN public.community_posts p ON p.id = v.post_id AND p.archived_at IS NULL
   WHERE v.status = 'posted'
     AND v.day > (now() - make_interval(days => least(greatest(coalesce(_days, 120), 7), 365)))::date
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_stats(int) FROM PUBLIC, anon, authenticated;

-- ── the coach's view: last week and the week ahead ─────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visuals_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'on', coalesce((SELECT daily_visuals_on FROM public.community_series_settings WHERE id), true),
    'paused', coalesce((SELECT paused FROM public.community_series_settings WHERE id), false),
    'today', v_today,
    'learned', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_learned'),
    'days', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'day', v.day, 'theme', v.theme, 'audience', v.audience, 'faith', v.faith, 'style', v.style,
               'line', coalesce(nullif(btrim(v.coach_line), ''), v.ai_line), 'own', nullif(btrim(v.coach_line), '') IS NOT NULL,
               'verse_ref', v.verse_ref, 'verse_text', v.verse_text, 'picture', v.picture->>'path',
               'status', v.status, 'error', CASE WHEN v.status IN ('planned', 'failed') THEN v.error END, 'post_id', v.post_id,
               'likes', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r WHERE r.post_id = v.post_id) END,
               'views', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT pv.viewer_user_id) FROM public.community_post_views pv WHERE pv.post_id = v.post_id) END
             ) ORDER BY v.day)
        FROM public.community_daily_visuals v
       WHERE v.day BETWEEN v_today - 6 AND v_today + 6), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_overview() TO authenticated;

-- ── the coach's changes ────────────────────────────────────────────────────
-- words: new words (the picture stays) · picture: a new picture (the words
-- stay) · line: his own words (empty = back to the written ones) · skip /
-- unskip · post: today's, now. A posted day changes like any post (its ⋯).
CREATE OR REPLACE FUNCTION public.community_daily_visual_act(_id uuid, _action text, _line text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_line text := nullif(btrim(coalesce(_line, '')), '');
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That day isn''t planned'; END IF;
  IF r.status = 'posted' THEN RAISE EXCEPTION 'Already posted. Change it on the post itself.'; END IF;
  IF _action = 'post' THEN
    IF r.day <> v_today THEN RAISE EXCEPTION 'Only today''s can go out early'; END IF;
    RETURN public.community_daily_visual_post(r.day, false);
  END IF;
  IF v_line IS NOT NULL AND char_length(v_line) > 300 THEN RAISE EXCEPTION 'Keep it under 300 characters'; END IF;
  UPDATE public.community_daily_visuals v SET
    ai_line = CASE WHEN _action = 'words' THEN NULL ELSE v.ai_line END,
    coach_line = CASE WHEN _action = 'line' THEN v_line WHEN _action = 'words' THEN NULL ELSE v.coach_line END,
    picture = CASE WHEN _action = 'picture' THEN NULL ELSE v.picture END,
    status = CASE
      WHEN _action = 'skip' THEN 'skipped'
      WHEN _action IN ('words', 'picture') THEN 'planned'
      WHEN (CASE WHEN _action = 'line' THEN coalesce(v_line, v.ai_line) ELSE coalesce(v.coach_line, v.ai_line) END) IS NOT NULL
           AND v.picture IS NOT NULL THEN 'ready'
      ELSE 'planned' END,
    attempts = CASE WHEN _action IN ('words', 'picture', 'unskip') THEN 0 ELSE v.attempts END,
    error = CASE WHEN _action IN ('words', 'picture', 'unskip') THEN NULL ELSE v.error END,
    updated_at = now()
   WHERE v.id = r.id
     AND _action IN ('words', 'picture', 'line', 'skip', 'unskip')
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown change'; END IF;
  IF _action IN ('words', 'picture', 'unskip') THEN PERFORM public.community_daily_visuals_kick(true); END IF;
  RETURN jsonb_build_object('status', r.status);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_act(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_act(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_daily_visuals_set_on(_on boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.community_series_settings SET daily_visuals_on = coalesce(_on, true), updated_at = now() WHERE id;
  RETURN coalesce(_on, true);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_set_on(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_set_on(boolean) TO authenticated;

-- ── the job ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'community-daily-visuals';
  PERFORM cron.schedule(
    'community-daily-visuals',
    '*/15 * * * *',
    $cmd$select public.community_publish_daily_visual(); select public.community_daily_visuals_kick(false);$cmd$
  );
EXCEPTION
  WHEN undefined_table OR undefined_function THEN NULL;
END;
$$;

SELECT public.community_daily_visuals_plan(NULL, 7);
