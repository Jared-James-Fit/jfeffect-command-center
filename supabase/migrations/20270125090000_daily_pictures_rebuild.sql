-- Daily pictures, rebuilt (src/lib/daily-visuals.ts, daily-visuals.server.ts).
--
-- Every daily picture is made concept first (who it's for, a topic, a real
-- situation, the message, the caption's form and the art style that tells it
-- best), then the caption, then the picture, then a review that looks at the
-- picture with the caption; it goes live only when all of that passes. It is
-- made on OpenAI; Lovable AI is off unless the coach turns it on.
--
-- What changes here:
--   * a day speaks to women, men or everyone (a 3-day turn, so each weekday
--     changes every week) and has a topic, a caption form and one of twelve
--     art styles;
--   * nothing is ever lost: every time a day's words or picture are replaced
--     (a remake, the coach's own words, a restore) the version before is kept
--     in community_daily_visual_versions by a trigger, and any version can be
--     put back;
--   * a day already posted is remade in place: the same post (id, date,
--     likes, comments, author), its words and picture replaced, never a new
--     post and never a notification; its date in the feed doesn't move;
--   * the coach can remake the whole post, the words only or the picture
--     only (with a style he picks), approve or reject one, edit the words,
--     see every version and restore one;
--   * a remake is built on the side (`candidate`) and goes live in one step
--     (community_daily_visual_apply) only once it passes; if it can't be made
--     the original stays and the reason is kept on the day.
-- Every day there is now (Nov 2 to 11) is queued for a remake.

-- ── what a day is now ──────────────────────────────────────────────────────
ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_audience_check;
ALTER TABLE public.community_daily_visuals ADD CONSTRAINT community_daily_visuals_audience_check
  CHECK (audience IN ('women', 'men', 'everyone'));
ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_style_check;
ALTER TABLE public.community_daily_visuals ADD CONSTRAINT community_daily_visuals_style_check CHECK (style IS NULL OR style IN (
  'cinematic_photo', 'minimal_illustration', 'pencil_sketch', 'ink_drawing', 'watercolor', 'vintage_fitness',
  'editorial_illustration', 'conceptual', 'comic', 'typography', 'mixed_media', 'graphic_design',
  -- the first version's two looks, kept for its history
  'photo', 'illustration'));
ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_ai_line_check;
ALTER TABLE public.community_daily_visuals ADD CONSTRAINT community_daily_visuals_ai_line_check
  CHECK (ai_line IS NULL OR char_length(ai_line) <= 600);
ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_coach_line_check;
ALTER TABLE public.community_daily_visuals ADD CONSTRAINT community_daily_visuals_coach_line_check
  CHECK (coach_line IS NULL OR char_length(coach_line) <= 600);
-- the caption's length now comes from its form (daily-visuals.ts DAILY_FORMATS)
ALTER TABLE public.community_daily_visuals DROP CONSTRAINT IF EXISTS community_daily_visuals_max_chars_check;

ALTER TABLE public.community_daily_visuals
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS format text,
  -- the plan behind it: situation, tension, message, the picture, any words in it
  ADD COLUMN IF NOT EXISTS concept jsonb,
  -- the review it passed: scores, the words read off the picture, the checks
  ADD COLUMN IF NOT EXISTS review jsonb,
  -- a remake being built (never shown until it passes and is applied)
  ADD COLUMN IF NOT EXISTS candidate jsonb,
  -- what's queued: the whole post, the words only or the picture only
  ADD COLUMN IF NOT EXISTS regen text CHECK (regen IS NULL OR regen IN ('full', 'caption', 'picture')),
  ADD COLUMN IF NOT EXISTS regen_style text,
  -- why: new, rebuild, coach, rejected (kept on the version it replaces)
  ADD COLUMN IF NOT EXISTS regen_reason text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS made_at timestamptz;

-- Lovable AI only when the coach allows it (OpenAI otherwise)
ALTER TABLE public.community_series_settings ADD COLUMN IF NOT EXISTS daily_visuals_lovable boolean NOT NULL DEFAULT false;

-- women, men, then everyone (the same as audienceForDay in daily-visuals.ts)
CREATE OR REPLACE FUNCTION public.community_daily_audience(_day date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['women', 'men', 'everyone'])[((((_day - date '2026-01-05') % 3) + 3) % 3) + 1]
$$;

-- ── every version kept ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_daily_visual_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visual_id uuid NOT NULL REFERENCES public.community_daily_visuals(id) ON DELETE CASCADE,
  day date NOT NULL,
  post_id uuid,
  -- the post's words exactly as people saw them (a day that was out)
  caption text,
  ai_line text,
  coach_line text,
  picture jsonb,
  picture_provider text,
  audience text,
  style text,
  format text,
  topic text,
  shot text,
  concept jsonb,
  review jsonb,
  verse_ref text,
  verse_text text,
  -- why it was replaced: rebuild, coach, rejected, edited, restored, replaced
  reason text NOT NULL DEFAULT 'replaced',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_daily_visual_versions_visual ON public.community_daily_visual_versions (visual_id, created_at DESC);

ALTER TABLE public.community_daily_visual_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read daily picture versions" ON public.community_daily_visual_versions;
CREATE POLICY "Staff read daily picture versions" ON public.community_daily_visual_versions
  FOR SELECT TO authenticated USING ((SELECT public.is_community_staff()));
REVOKE INSERT, UPDATE, DELETE ON public.community_daily_visual_versions FROM anon, authenticated;

-- Whatever replaces a day's words or picture, the version before is kept
-- (the reason comes from the change: jf.daily_visual_reason).
CREATE OR REPLACE FUNCTION public.community_daily_visuals_keep_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.ai_line, OLD.coach_line, OLD.picture) IS NOT DISTINCT FROM (NEW.ai_line, NEW.coach_line, NEW.picture) THEN RETURN NEW; END IF;
  IF OLD.ai_line IS NULL AND OLD.coach_line IS NULL AND OLD.picture IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.community_daily_visual_versions (
    visual_id, day, post_id, caption, ai_line, coach_line, picture, picture_provider, audience, style, format, topic,
    shot, concept, review, verse_ref, verse_text, reason, created_by)
  VALUES (
    OLD.id, OLD.day, OLD.post_id, (SELECT p.caption FROM public.community_posts p WHERE p.id = OLD.post_id),
    OLD.ai_line, OLD.coach_line, OLD.picture, OLD.picture_provider, OLD.audience, OLD.style, OLD.format, OLD.topic,
    OLD.shot, OLD.concept, OLD.review, OLD.verse_ref, OLD.verse_text,
    coalesce(nullif(current_setting('jf.daily_visual_reason', true), ''), 'replaced'), auth.uid());
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_keep_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS community_daily_visuals_keep_version ON public.community_daily_visuals;
CREATE TRIGGER community_daily_visuals_keep_version
  BEFORE UPDATE OF ai_line, coach_line, picture ON public.community_daily_visuals
  FOR EACH ROW EXECUTE FUNCTION public.community_daily_visuals_keep_version();

-- ── a day's words as posted ────────────────────────────────────────────────
-- The caption, and on Sunday the verse under it: the same as dailyCaption in
-- daily-visuals.ts.
CREATE OR REPLACE FUNCTION public.community_daily_visual_caption(_line text, _faith boolean, _verse_text text, _verse_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(_line) || CASE WHEN _faith AND coalesce(_verse_text, '') <> '' AND coalesce(_verse_ref, '') <> ''
                              THEN E'\n\n' || '“' || btrim(_verse_text) || '” ' || _verse_ref ELSE '' END
$$;

-- ── planning: a new day is queued to be made ───────────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visuals_plan(_from date DEFAULT NULL, _days int DEFAULT 7)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from date := coalesce(_from, public.instant_to_local(now(), 'America/Winnipeg')::date);
  v_n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_daily_visuals (day, theme, audience, faith, regen, regen_reason)
  SELECT d::date, public.community_daily_theme(d::date), public.community_daily_audience(d::date), extract(isodow FROM d) = 7, 'full', 'new'
    FROM generate_series(v_from, v_from + greatest(least(coalesce(_days, 7), 14) - 1, 0), interval '1 day') d
  ON CONFLICT (day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_plan(date, int) FROM PUBLIC, anon, authenticated;

-- ── posting a day's picture ────────────────────────────────────────────────
-- His words win (coach_line), then the written ones. _backdate puts it at 7
-- am on its own day (filling in a day that was missed).
CREATE OR REPLACE FUNCTION public.community_daily_visual_post(_day date, _backdate boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
  v_settings record;
  v_author uuid;
  v_key text := 'daily_visual:' || _day::text;
  v_line text;
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

  v_at := CASE WHEN coalesce(_backdate, false) THEN public.local_to_instant(_day + time '07:00', 'America/Winnipeg') ELSE now() END;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at, updated_at)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
          public.community_daily_visual_caption(v_line, r.faith, r.verse_text, r.verse_ref), 'daily_visual', v_key,
          jsonb_strip_nulls(jsonb_build_object('theme', r.theme, 'audience', r.audience, 'faith', r.faith, 'style', r.style,
                                               'format', r.format, 'topic', r.topic, 'verse', r.verse_ref)),
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

-- ── a posted day follows its row, in place ─────────────────────────────────
-- The same post: its words and picture replaced, its id, date, likes,
-- comments and author kept, and its updated_at put back so it never moves.
-- No notification goes out (only an @tag notifies, and these have none).
-- _caption: exact words to put back (restoring a version people saw).
CREATE OR REPLACE FUNCTION public.community_daily_visual_sync_post(_id uuid, _caption text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
  v_line text;
  v_updated timestamptz;
  v_path text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE id = _id;
  IF NOT FOUND OR r.status <> 'posted' OR r.post_id IS NULL THEN RETURN false; END IF;
  v_line := btrim(coalesce(nullif(btrim(r.coach_line), ''), r.ai_line));
  IF coalesce(v_line, '') = '' OR r.picture IS NULL THEN RETURN false; END IF;
  SELECT p.updated_at, p.media_path INTO v_updated, v_path FROM public.community_posts p WHERE p.id = r.post_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.community_posts p
     SET caption = coalesce(nullif(btrim(_caption), ''), public.community_daily_visual_caption(v_line, r.faith, r.verse_text, r.verse_ref)),
         series_data = coalesce(p.series_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'theme', r.theme, 'audience', r.audience, 'faith', r.faith, 'style', r.style,
           'format', r.format, 'topic', r.topic, 'verse', r.verse_ref))
   WHERE p.id = r.post_id;
  IF v_path IS DISTINCT FROM r.picture->>'path' THEN
    PERFORM public.community_apply_media(r.post_id, jsonb_build_array(r.picture));
  END IF;
  UPDATE public.community_posts SET updated_at = v_updated WHERE id = r.post_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_sync_post(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── a remake goes live (the background maker only) ─────────────────────────
-- One step: the new words / picture / plan on the day (the version before is
-- kept by the trigger), the queue cleared, and a posted day's post updated in
-- place. A new caption replaces the coach's own words too (he asked for new
-- ones, and the version keeps his).
CREATE OR REPLACE FUNCTION public.community_daily_visual_apply(_id uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such day'; END IF;
  PERFORM set_config('jf.daily_visual_reason', coalesce(r.regen_reason, 'replaced'), true);
  UPDATE public.community_daily_visuals v SET
    ai_line = coalesce(_patch->>'ai_line', v.ai_line),
    coach_line = CASE WHEN _patch ? 'ai_line' THEN NULL ELSE v.coach_line END,
    picture = coalesce(_patch->'picture', v.picture),
    picture_provider = coalesce(_patch->>'picture_provider', v.picture_provider),
    audience = coalesce(_patch->>'audience', v.audience),
    style = coalesce(_patch->>'style', v.style),
    format = coalesce(_patch->>'format', v.format),
    topic = coalesce(_patch->>'topic', v.topic),
    shot = coalesce(_patch->>'shot', v.shot),
    concept = coalesce(_patch->'concept', v.concept),
    review = coalesce(_patch->'review', v.review),
    verse_ref = CASE WHEN _patch ? 'verse_ref' THEN _patch->>'verse_ref' ELSE v.verse_ref END,
    verse_text = CASE WHEN _patch ? 'verse_text' THEN _patch->>'verse_text' ELSE v.verse_text END,
    model = coalesce(_patch->>'model', v.model),
    learned = coalesce(_patch->'learned', v.learned),
    status = CASE WHEN v.status IN ('planned', 'failed') THEN 'ready' ELSE v.status END,
    regen = NULL, regen_style = NULL, regen_reason = NULL, candidate = NULL,
    attempts = 0, error = NULL, made_at = now(), approved_at = NULL, approved_by = NULL, updated_at = now()
   WHERE v.id = r.id
  RETURNING * INTO r;
  PERFORM public.community_daily_visual_sync_post(r.id);
  RETURN jsonb_build_object('status', r.status, 'post_id', r.post_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_apply(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── the background maker, called when there's work ─────────────────────────
-- Work = a day queued for a remake (from 45 days back to 3 ahead), not tried
-- in the last 20 minutes. With no AI to make it (no OpenAI key and Lovable
-- off) it only checks again once an hour.
CREATE OR REPLACE FUNCTION public.community_daily_visuals_kick(_force boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_raw text := (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_status' LIMIT 1);
  v_status jsonb := CASE WHEN v_raw ~ '^\s*\{' THEN v_raw::jsonb END;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(_force, false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.community_daily_visuals v
       WHERE v.regen IS NOT NULL AND v.status <> 'skipped' AND v.day BETWEEN v_today - 45 AND v_today + 3
         AND (v.attempts = 0 OR v.updated_at < now() - interval '20 minutes')) THEN
      RETURN false;
    END IF;
    IF v_status->>'blocked' IS NOT NULL AND (v_status->>'at')::timestamptz > now() - interval '1 hour' THEN RETURN false; END IF;
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

-- ── how each posted picture did, for the learning (the coaches left out) ──
CREATE OR REPLACE FUNCTION public.community_daily_visual_stats(_days int DEFAULT 120)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH staff AS (SELECT s AS user_id FROM public.community_staff_people() s WHERE s IS NOT NULL)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day', v.day, 'theme', v.theme, 'audience', v.audience, 'style', v.style, 'format', v.format, 'topic', v.topic,
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

-- ── the coach's view: the last two weeks and the week ahead ───────────────
CREATE OR REPLACE FUNCTION public.community_daily_visuals_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'on', coalesce((SELECT daily_visuals_on FROM public.community_series_settings WHERE id), true),
    'paused', coalesce((SELECT paused FROM public.community_series_settings WHERE id), false),
    'lovable', coalesce((SELECT daily_visuals_lovable FROM public.community_series_settings WHERE id), false),
    'today', v_today,
    'learned', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_learned'),
    'maker', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_status'),
    'days', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'day', v.day, 'theme', v.theme, 'audience', v.audience, 'faith', v.faith,
               'style', v.style, 'format', v.format, 'topic', v.topic,
               'message', v.concept->>'message', 'situation', v.concept->>'situation',
               'line', coalesce(nullif(btrim(v.coach_line), ''), v.ai_line), 'own', nullif(btrim(v.coach_line), '') IS NOT NULL,
               'verse_ref', v.verse_ref, 'verse_text', v.verse_text, 'picture', v.picture->>'path',
               'review', v.review, 'status', v.status, 'error', v.error, 'post_id', v.post_id,
               'regen', v.regen, 'regen_style', v.regen_style, 'working', v.candidate IS NOT NULL,
               'step', CASE WHEN v.candidate IS NULL THEN NULL WHEN v.candidate ? 'caption' THEN 'picture' ELSE 'concept' END,
               'approved', v.approved_at IS NOT NULL, 'made_at', v.made_at,
               'versions', (SELECT count(*) FROM public.community_daily_visual_versions x WHERE x.visual_id = v.id),
               'likes', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r WHERE r.post_id = v.post_id) END,
               'comments', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(*) FROM public.community_comments c WHERE c.post_id = v.post_id AND c.hidden_at IS NULL) END,
               'views', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT pv.viewer_user_id) FROM public.community_post_views pv WHERE pv.post_id = v.post_id) END
             ) ORDER BY v.day)
        FROM public.community_daily_visuals v
       WHERE v.day BETWEEN v_today - 13 AND v_today + 6), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_overview() TO authenticated;

-- ── a day's versions, newest first ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visual_versions_list(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', x.id, 'created_at', x.created_at, 'reason', x.reason,
             'line', coalesce(nullif(btrim(x.coach_line), ''), x.ai_line), 'own', nullif(btrim(x.coach_line), '') IS NOT NULL,
             'caption', x.caption, 'picture', x.picture->>'path', 'audience', x.audience,
             'style', x.style, 'format', x.format, 'topic', x.topic, 'review', x.review
           ) ORDER BY x.created_at DESC)
      FROM public.community_daily_visual_versions x WHERE x.visual_id = _id), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_versions_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_versions_list(uuid) TO authenticated;

-- ── put a version back ─────────────────────────────────────────────────────
-- The day takes the version's words, picture and plan (what it had is kept
-- as a version too); a posted day's post gets them in place, its words
-- exactly as people saw them.
CREATE OR REPLACE FUNCTION public.community_daily_visual_restore(_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  x public.community_daily_visual_versions;
  r public.community_daily_visuals;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM public.community_daily_visual_versions WHERE id = _version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That version is gone'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE id = x.visual_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That day is gone'; END IF;
  PERFORM set_config('jf.daily_visual_reason', 'restored', true);
  UPDATE public.community_daily_visuals v SET
    ai_line = x.ai_line, coach_line = x.coach_line, picture = x.picture, picture_provider = x.picture_provider,
    audience = coalesce(x.audience, v.audience), style = x.style, format = x.format, topic = x.topic, shot = x.shot,
    concept = x.concept, review = x.review, verse_ref = x.verse_ref, verse_text = x.verse_text,
    status = CASE WHEN v.status IN ('planned', 'failed') AND x.picture IS NOT NULL AND coalesce(x.coach_line, x.ai_line) IS NOT NULL
                  THEN 'ready' ELSE v.status END,
    regen = NULL, regen_style = NULL, regen_reason = NULL, candidate = NULL, attempts = 0, error = NULL,
    approved_at = NULL, approved_by = NULL, updated_at = now()
   WHERE v.id = r.id
  RETURNING * INTO r;
  PERFORM public.community_daily_visual_sync_post(r.id, x.caption);
  RETURN jsonb_build_object('status', r.status);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_restore(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_restore(uuid) TO authenticated;

-- ── the coach's changes ────────────────────────────────────────────────────
-- full / caption / picture: make the whole post, the words or the picture
-- again (_style picks the look for full or picture; caption with no picture
-- yet is a full one) · reject: throw it out and make a new one · approve ·
-- line: his own words (empty = back to the written ones) · skip / unskip ·
-- post: today's, now. A posted day changes in place. 'words' = 'caption'
-- (older apps).
DROP FUNCTION IF EXISTS public.community_daily_visual_act(uuid, text, text);
CREATE OR REPLACE FUNCTION public.community_daily_visual_act(_id uuid, _action text, _line text DEFAULT NULL, _style text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_line text := nullif(btrim(coalesce(_line, '')), '');
  v_action text := CASE WHEN _action = 'words' THEN 'caption' ELSE _action END;
  v_style text := nullif(btrim(coalesce(_style, '')), '');
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That day isn''t planned'; END IF;

  IF v_action = 'post' THEN
    IF r.day <> v_today THEN RAISE EXCEPTION 'Only today''s can go out early'; END IF;
    RETURN public.community_daily_visual_post(r.day, false);
  END IF;

  IF v_action IN ('full', 'caption', 'picture', 'reject') THEN
    IF r.status = 'skipped' THEN RAISE EXCEPTION 'Bring the day back first'; END IF;
    IF v_style IS NOT NULL AND v_style NOT IN ('cinematic_photo', 'minimal_illustration', 'pencil_sketch', 'ink_drawing', 'watercolor',
        'vintage_fitness', 'editorial_illustration', 'conceptual', 'comic', 'typography', 'mixed_media', 'graphic_design') THEN
      RAISE EXCEPTION 'Unknown style';
    END IF;
    IF v_action = 'caption' AND r.picture IS NULL THEN v_action := 'full'; END IF;
    UPDATE public.community_daily_visuals v SET
      regen = CASE WHEN v_action = 'reject' THEN 'full' ELSE v_action END,
      regen_style = CASE WHEN v_action = 'caption' THEN NULL ELSE v_style END,
      regen_reason = CASE WHEN v_action = 'reject' THEN 'rejected' ELSE 'coach' END,
      candidate = NULL, attempts = 0, error = NULL, approved_at = NULL, approved_by = NULL,
      status = CASE WHEN v.status = 'failed' THEN 'planned' ELSE v.status END,
      updated_at = now()
     WHERE v.id = r.id;
    PERFORM public.community_daily_visuals_kick(true);
    RETURN jsonb_build_object('status', 'queued');
  END IF;

  IF v_action = 'line' THEN
    IF v_line IS NOT NULL AND char_length(v_line) > 600 THEN RAISE EXCEPTION 'Keep it under 600 characters'; END IF;
    PERFORM set_config('jf.daily_visual_reason', 'edited', true);
    UPDATE public.community_daily_visuals v SET
      coach_line = v_line,
      status = CASE WHEN v.status IN ('planned', 'failed') AND coalesce(v_line, v.ai_line) IS NOT NULL AND v.picture IS NOT NULL
                    THEN 'ready' ELSE v.status END,
      updated_at = now()
     WHERE v.id = r.id
    RETURNING * INTO r;
    PERFORM public.community_daily_visual_sync_post(r.id);
    RETURN jsonb_build_object('status', r.status);
  END IF;

  IF v_action IN ('approve', 'unapprove') THEN
    UPDATE public.community_daily_visuals v SET
      approved_at = CASE WHEN v_action = 'approve' THEN now() END,
      approved_by = CASE WHEN v_action = 'approve' THEN auth.uid() END,
      updated_at = now()
     WHERE v.id = r.id
    RETURNING * INTO r;
    RETURN jsonb_build_object('status', r.status, 'approved', r.approved_at IS NOT NULL);
  END IF;

  IF v_action = 'skip' THEN
    IF r.status = 'posted' THEN RAISE EXCEPTION 'Already posted. Archive it from the post instead.'; END IF;
    UPDATE public.community_daily_visuals SET status = 'skipped', updated_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('status', 'skipped');
  END IF;

  IF v_action = 'unskip' THEN
    UPDATE public.community_daily_visuals v SET
      status = CASE WHEN v.picture IS NOT NULL AND coalesce(nullif(btrim(v.coach_line), ''), v.ai_line) IS NOT NULL THEN 'ready' ELSE 'planned' END,
      regen = CASE WHEN v.picture IS NULL OR coalesce(nullif(btrim(v.coach_line), ''), v.ai_line) IS NULL THEN 'full' ELSE v.regen END,
      regen_reason = coalesce(v.regen_reason, 'new'),
      attempts = 0, error = NULL, updated_at = now()
     WHERE v.id = r.id AND v.status IN ('skipped', 'failed')
    RETURNING * INTO r;
    PERFORM public.community_daily_visuals_kick(true);
    RETURN jsonb_build_object('status', r.status);
  END IF;

  RAISE EXCEPTION 'Unknown change';
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_act(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_act(uuid, text, text, text) TO authenticated;

-- ── Lovable AI on or off for these (off: OpenAI only) ─────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visuals_set_lovable(_on boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.community_series_settings SET daily_visuals_lovable = coalesce(_on, false), updated_at = now() WHERE id;
  -- a maker that was waiting on an AI tries again now
  DELETE FROM public.app_settings WHERE key = 'daily_visuals_status' AND value LIKE '%"blocked"%';
  PERFORM public.community_daily_visuals_kick(false);
  RETURN coalesce(_on, false);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_set_lovable(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_set_lovable(boolean) TO authenticated;

-- ── every day there is now is remade (the originals kept as versions) ─────
UPDATE public.community_daily_visuals
   SET audience = public.community_daily_audience(day),
       regen = 'full',
       regen_reason = CASE WHEN ai_line IS NULL AND coach_line IS NULL AND picture IS NULL THEN 'new' ELSE 'rebuild' END,
       regen_style = NULL, candidate = NULL, attempts = 0, error = NULL, approved_at = NULL,
       status = CASE WHEN status = 'failed' THEN 'planned' ELSE status END,
       updated_at = now()
 WHERE status <> 'skipped';

-- ── the job: post today's at 7, wake the maker when there's work ──────────
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
