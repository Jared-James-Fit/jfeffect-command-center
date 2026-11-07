-- Athlete Insights (the coach's ask, Nov 7 2026): the daily pictures become a
-- premium coaching series. The series key stays `daily_visual` and every table
-- keeps its name; what changes here:
--
--   1. The schedule is the coach's: the weekdays they go out on
--      (`community_series_settings.daily_visuals_days`, ISO weekdays, default
--      Friday, Saturday and Sunday = 3 a week), still only on a day no other
--      coach post takes (`community_coach_post_day`). Changing the days drops
--      the untouched placeholders on days no longer picked and skips any made
--      ones (never deletes them), then plans the new ones.
--   2. Any post not out yet can be moved to another free day
--      (`community_daily_visual_move`); the day it left stays marked as moved,
--      so the planner doesn't fill it again.
--   3. Nothing weak goes out on its own: a post that didn't fully pass (the
--      editor's verdict on its words, or the review of its photo) is held
--      until the coach approves it, and Publish now counts as his approval.
--   4. No more targeting by gender: every post is for every athlete
--      (`community_daily_audience` = 'everyone'; the coach's card labels a
--      post by its training relevance instead).
--   5. The coach's card gets what it shows: the days picked, a post's
--      category, its editor read and whether it's held.
--   6. Upcoming posts made in the 2D film look get a new photo, captions
--      kept (published ones change only when the coach approves it, post by
--      post or with "Approve the new look").

-- ── 1. the weekdays they go out ─────────────────────────────────────────────
ALTER TABLE public.community_series_settings
  ADD COLUMN IF NOT EXISTS daily_visuals_days int[] NOT NULL DEFAULT '{5,6,7}';
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_series_settings_insight_days_valid') THEN
    ALTER TABLE public.community_series_settings
      ADD CONSTRAINT community_series_settings_insight_days_valid
      CHECK (daily_visuals_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7] AND cardinality(daily_visuals_days) <= 7);
  END IF;
END
$c$;

CREATE OR REPLACE FUNCTION public.community_insight_days()
RETURNS int[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT daily_visuals_days FROM public.community_series_settings WHERE id LIMIT 1), '{5,6,7}'::int[])
$$;
REVOKE ALL ON FUNCTION public.community_insight_days() FROM PUBLIC, anon, authenticated;

-- the planner makes one only on a picked weekday that nothing else takes
CREATE OR REPLACE FUNCTION public.community_daily_visuals_plan(_from date DEFAULT NULL, _days int DEFAULT 7)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from date := coalesce(_from, public.instant_to_local(now(), 'America/Winnipeg')::date);
  v_on int[] := public.community_insight_days();
  v_n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_daily_visuals (day, theme, audience, faith, regen, regen_reason)
  SELECT d::date, public.community_daily_theme(d::date), 'everyone', extract(isodow FROM d) = 7, 'full', 'new'
    FROM generate_series(v_from, v_from + greatest(least(coalesce(_days, 7), 14) - 1, 0), interval '1 day') d
   WHERE extract(isodow FROM d)::int = ANY (v_on)
     AND public.community_coach_post_day(d::date) IS NULL
  ON CONFLICT (day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_plan(date, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_daily_visuals_set_days(_days int[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_days int[] := ARRAY(SELECT DISTINCT d FROM unnest(coalesce(_days, '{}'::int[])) d WHERE d BETWEEN 1 AND 7 ORDER BY d);
  v_dropped int;
  v_skipped int;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF cardinality(v_days) = 0 THEN RAISE EXCEPTION 'Pick at least one day (or switch them off)'; END IF;
  UPDATE public.community_series_settings SET daily_visuals_days = v_days, updated_at = now() WHERE id;

  -- days no longer picked: untouched placeholders go, anything made is skipped (the coach can still bring it back)
  DELETE FROM public.community_daily_visuals v
   WHERE v.day >= v_today AND NOT (extract(isodow FROM v.day)::int = ANY (v_days))
     AND v.status = 'planned' AND v.picture IS NULL AND v.ai_line IS NULL AND v.coach_line IS NULL
     AND v.candidate IS NULL AND v.concept IS NULL AND v.post_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.community_daily_visual_versions x WHERE x.visual_id = v.id);
  GET DIAGNOSTICS v_dropped = ROW_COUNT;
  UPDATE public.community_daily_visuals v
     SET status = 'skipped', regen = NULL, candidate = NULL, error = 'Not an Athlete Insights day any more', updated_at = now()
   WHERE v.day >= v_today AND NOT (extract(isodow FROM v.day)::int = ANY (v_days))
     AND v.status IN ('planned', 'ready', 'failed') AND v.post_id IS NULL;
  GET DIAGNOSTICS v_skipped = ROW_COUNT;

  PERFORM public.community_daily_visuals_plan(v_today, 7);
  PERFORM public.community_daily_visuals_kick(false);
  RETURN jsonb_build_object('days', v_days, 'dropped', v_dropped, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_set_days(int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_set_days(int[]) TO authenticated;

-- ── 2. move a post that isn't out yet ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visual_move(_id uuid, _day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.community_daily_visuals;
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_from date;
  v_taken text;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_daily_visuals WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That post isn''t planned'; END IF;
  IF r.status = 'posted' OR r.post_id IS NOT NULL THEN RAISE EXCEPTION 'It''s already out'; END IF;
  IF _day IS NULL OR _day < v_today THEN RAISE EXCEPTION 'Pick today or a day ahead'; END IF;
  IF _day = r.day THEN RETURN jsonb_build_object('status', 'unchanged', 'day', r.day); END IF;
  IF EXISTS (SELECT 1 FROM public.community_daily_visuals v WHERE v.day = _day AND v.id <> r.id AND v.status <> 'skipped') THEN
    RAISE EXCEPTION 'Another Athlete Insight is on that day';
  END IF;
  v_taken := public.community_coach_post_day(_day);
  IF v_taken IS NOT NULL AND extract(isodow FROM _day) <> 7 THEN
    RAISE EXCEPTION 'Something else goes out that day (%): one coach post a day', replace(v_taken, '_', ' ');
  END IF;
  -- a skipped placeholder on the new day makes room
  DELETE FROM public.community_daily_visuals v WHERE v.day = _day AND v.id <> r.id AND v.status = 'skipped' AND v.post_id IS NULL;

  v_from := r.day;
  PERFORM set_config('jf.daily_visual_reason', 'moved', true);
  UPDATE public.community_daily_visuals v SET
    day = _day,
    theme = public.community_daily_theme(_day),
    faith = extract(isodow FROM _day) = 7,
    -- the verse belongs to Sunday's post: it comes off when a post leaves Sunday
    verse_ref = CASE WHEN extract(isodow FROM _day) = 7 THEN v.verse_ref END,
    verse_text = CASE WHEN extract(isodow FROM _day) = 7 THEN v.verse_text END,
    audience = 'everyone',
    error = NULL,
    updated_at = now()
   WHERE v.id = r.id;

  -- the day it left is marked moved, so the planner doesn't make another one there
  IF v_from >= v_today AND extract(isodow FROM v_from)::int = ANY (public.community_insight_days()) THEN
    INSERT INTO public.community_daily_visuals (day, theme, audience, faith, status, error)
    VALUES (v_from, public.community_daily_theme(v_from), 'everyone', extract(isodow FROM v_from) = 7, 'skipped',
            'Moved to ' || to_char(_day, 'Dy Mon FMDD'))
    ON CONFLICT (day) DO NOTHING;
  END IF;
  PERFORM public.community_daily_visuals_kick(false);
  RETURN jsonb_build_object('status', 'moved', 'from', v_from, 'day', _day);
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_move(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_move(uuid, date) TO authenticated;

-- ── 3. nothing weak goes out on its own ─────────────────────────────────────
-- A post the editor or the photo review didn't fully pass waits for the
-- coach's approval (his own words count as checked words).
CREATE OR REPLACE FUNCTION public.community_daily_visual_held(r public.community_daily_visuals)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.approved_at IS NULL AND (
    coalesce(r.review->>'passed', 'true') = 'false'
    OR (nullif(btrim(coalesce(r.coach_line, '')), '') IS NULL AND coalesce(r.concept->'editor'->>'passed', 'true') = 'false'))
$$;
REVOKE ALL ON FUNCTION public.community_daily_visual_held(public.community_daily_visuals) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visual_held(public.community_daily_visuals) TO authenticated;

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
  -- held for the coach's OK: it didn't fully pass its checks
  IF public.community_daily_visual_held(r) THEN RETURN jsonb_build_object('status', 'needs_review'); END IF;

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
          jsonb_strip_nulls(jsonb_build_object('theme', r.theme, 'faith', r.faith, 'style', r.style,
                                               'format', r.format, 'topic', r.topic, 'category', r.concept->>'pillar', 'verse', r.verse_ref)),
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

-- Publish now works on any post that's ready and not out yet, and counts as the coach's approval.
DO $do$
DECLARE
  src text := pg_get_functiondef('public.community_daily_visual_act(uuid, text, text, text)'::regprocedure);
  def text := src;
  f text[];
  fixes text[] := ARRAY[
    [$o$  IF v_action = 'post' THEN
    IF r.day <> v_today THEN RAISE EXCEPTION 'Only today''s can go out early'; END IF;
    RETURN public.community_daily_visual_post(r.day, false);
  END IF;$o$,
     $n$  IF v_action = 'post' THEN
    IF r.day < v_today THEN RAISE EXCEPTION 'That day has passed: move it to today or a day ahead'; END IF;
    -- publishing it now is the coach's OK, even for one held for review
    UPDATE public.community_daily_visuals SET approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, auth.uid()) WHERE id = r.id;
    RETURN public.community_daily_visual_post(r.day, false);
  END IF;$n$]
  ];
BEGIN
  FOREACH f SLICE 1 IN ARRAY fixes LOOP
    IF position(f[1] IN def) > 0 THEN def := replace(def, f[1], f[2]);
    ELSIF position(f[2] IN def) = 0 THEN RAISE EXCEPTION 'athlete insights: community_daily_visual_act no longer has %', f[1];
    END IF;
  END LOOP;
  IF def <> src THEN EXECUTE def; END IF;

  -- the coach's "Next: …" only counts a picked weekday
  src := pg_get_functiondef('public.community_next_post()'::regprocedure);
  def := replace(src,
    $o$IF coalesce(v_settings.daily_visuals_on, true) AND public.community_coach_post_day(v_day) IS NULL$o$,
    $n$IF coalesce(v_settings.daily_visuals_on, true) AND public.community_coach_post_day(v_day) IS NULL
       AND v_dow = ANY (public.community_insight_days())$n$);
  IF def = src AND position('community_insight_days()' IN src) = 0 THEN
    RAISE EXCEPTION 'athlete insights: community_next_post no longer has its picture check';
  END IF;
  IF def <> src THEN EXECUTE def; END IF;
END
$do$;

-- ── 4. every post is for every athlete ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_audience(_day date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'everyone'::text
$$;
UPDATE public.community_daily_visuals SET audience = 'everyone', updated_at = now()
 WHERE audience <> 'everyone' AND post_id IS NULL AND status <> 'posted';

-- ── 5. what the coach's card shows ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_daily_visuals_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_on int[] := public.community_insight_days();
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'on', coalesce((SELECT daily_visuals_on FROM public.community_series_settings WHERE id), true),
    'paused', coalesce((SELECT paused FROM public.community_series_settings WHERE id), false),
    'lovable', coalesce((SELECT daily_visuals_lovable FROM public.community_series_settings WHERE id), false),
    'insight_days', to_jsonb(v_on),
    'today', v_today,
    -- what goes out each day of the coming week: null = an Athlete Insight, 'off' = not a picked day
    'week', (SELECT jsonb_agg(jsonb_build_object('day', d::date,
                                                 'post', coalesce(public.community_coach_post_day(d::date),
                                                                  CASE WHEN extract(isodow FROM d)::int = ANY (v_on) THEN NULL ELSE 'off' END)) ORDER BY d)
               FROM generate_series(v_today, v_today + 6, interval '1 day') d),
    'learned', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_learned'),
    'maker', (SELECT value FROM public.app_settings WHERE key = 'daily_visuals_status'),
    'tests', coalesce((
      SELECT jsonb_agg(t.data || jsonb_build_object('id', t.id, 'at', t.created_at) ORDER BY t.created_at DESC)
        FROM (SELECT * FROM public.community_daily_visual_tests ORDER BY created_at DESC LIMIT 9) t), '[]'::jsonb),
    'days', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'day', v.day, 'theme', v.theme, 'audience', v.audience, 'faith', v.faith,
               'style', v.style, 'light', v.concept->>'light', 'art', v.concept->>'art', 'look', v.concept->>'look',
               'format', v.format, 'topic', v.topic, 'pillar', v.concept->>'pillar',
               'message', v.concept->>'message', 'situation', v.concept->>'situation', 'visual', v.concept->>'visual',
               'editor', v.concept->'editor',
               'line', coalesce(nullif(btrim(v.coach_line), ''), v.ai_line), 'own', nullif(btrim(v.coach_line), '') IS NOT NULL,
               'verse_ref', v.verse_ref, 'verse_text', v.verse_text, 'picture', v.picture->>'path',
               'review', v.review, 'status', v.status, 'error', v.error, 'post_id', v.post_id,
               'regen', v.regen, 'regen_style', v.regen_style, 'working', v.candidate IS NOT NULL,
               'step', CASE WHEN v.candidate IS NULL THEN NULL WHEN v.candidate ? 'caption' THEN 'picture' ELSE 'concept' END,
               'approved', v.approved_at IS NOT NULL, 'held', v.status = 'ready' AND public.community_daily_visual_held(v),
               'archived', CASE WHEN v.post_id IS NOT NULL THEN EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = v.post_id AND p.archived_at IS NOT NULL) ELSE false END,
               'made_at', v.made_at,
               'versions', (SELECT count(*) FROM public.community_daily_visual_versions x WHERE x.visual_id = v.id),
               'likes', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT r.user_id) FROM public.community_reactions r WHERE r.post_id = v.post_id) END,
               'comments', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(*) FROM public.community_comments c WHERE c.post_id = v.post_id AND c.hidden_at IS NULL) END,
               'saves', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(*) FROM public.community_saves s WHERE s.post_id = v.post_id) END,
               'views', CASE WHEN v.post_id IS NOT NULL THEN (SELECT count(DISTINCT pv.viewer_user_id) FROM public.community_post_views pv WHERE pv.post_id = v.post_id) END
             ) ORDER BY v.day)
        FROM public.community_daily_visuals v
       WHERE v.day BETWEEN v_today - 42 AND v_today + 13), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_overview() TO authenticated;

-- a published post gets the new look only when the coach says so, and never one
-- that's archived (it's out of the feed: an image there costs and shows nobody)
CREATE OR REPLACE FUNCTION public.community_daily_visuals_restyle(_look text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(_look), '') = '' THEN RAISE EXCEPTION 'Which look?'; END IF;
  UPDATE public.community_daily_visuals v
     SET regen = 'picture', regen_reason = 'restyle', regen_style = NULL, candidate = NULL, attempts = 0, error = NULL,
         approved_at = NULL, updated_at = now()
   WHERE v.status IN ('ready', 'posted') AND v.picture IS NOT NULL AND v.regen IS NULL
     AND coalesce(v.concept->>'look', '') <> _look
     AND NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = v.post_id AND p.archived_at IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN PERFORM public.community_daily_visuals_kick(true); END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_restyle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_daily_visuals_restyle(text) TO authenticated;

-- ── 6. upcoming posts in the old look get a new photo, captions kept ────────
-- (applied after the photo look is published, so the worker makes photos)
UPDATE public.community_daily_visuals
   SET regen = 'picture', regen_reason = 'restyle', regen_style = NULL, candidate = NULL, attempts = 0, error = NULL,
       approved_at = NULL, updated_at = now()
 WHERE status = 'ready' AND post_id IS NULL AND picture IS NOT NULL AND regen IS NULL
   AND day >= public.instant_to_local(now(), 'America/Winnipeg')::date
   AND coalesce(concept->>'look', '') <> 'photo_v1';
SELECT public.community_daily_visuals_kick(true);
