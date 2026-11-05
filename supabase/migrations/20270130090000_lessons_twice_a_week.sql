-- Lessons twice a week, not every day (lessons.ts `lessonTrackFor`).
--
-- Over the 21 days to Nov 5 the lessons were 20 of the 42 automated posts in
-- Crew, while the members posted 15: the crew's own posts were about a
-- quarter of the feed. Lessons drew the fewest likes per view of any coach
-- post, and no automated post had a comment. So a lesson goes out on Monday
-- and Thursday only, and the tracks take turns week by week:
--   Monday:   strength science → hypertrophy → technique fix
--   Thursday: methods & cues → mind & recovery → uncomfortable truth
-- (weeks counted from Monday 2025-12-29, so Nov 9 2026 is strength and Nov 12
-- methods, the lessons already approved for those days). The Sunday reset is
-- no longer planned (its items stay in the library; the Recap and the daily
-- picture already close the week). An uncomfortable truth now comes once
-- every three weeks instead of every Wednesday.
--
-- Every lesson still to go out moves onto the new days in its own track's
-- turn, approval, sticker and words kept, so nothing the coach already
-- approved is lost; the two Sunday resets go back to the library.
--
-- Also: a lesson's default time is the coach's clock through local_to_instant
-- (Manitoba stays UTC-5 from Nov 1, 2026; the bare AT TIME ZONE put every
-- 3 PM lesson out at 4 PM), and "today" in the planner through
-- instant_to_local.

CREATE OR REPLACE FUNCTION public.community_lesson_track(_day date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE extract(isodow FROM _day)::int
           WHEN 1 THEN (ARRAY['strength', 'hypertrophy', 'fix'])[x.w + 1]
           WHEN 4 THEN (ARRAY['methods', 'mind', 'truth'])[x.w + 1]
         END
    FROM (SELECT ((floor((_day - date '2025-12-29')::numeric / 7)::int % 3) + 3) % 3 AS w) x
$$;

CREATE OR REPLACE FUNCTION public.community_lesson_default_at(_day date, _learned jsonb DEFAULT NULL::jsonb)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.local_to_instant(
           _day + coalesce((SELECT s.lesson_time FROM public.community_series_settings s WHERE s.id),
                           ((coalesce(_learned, public.community_lesson_learned_time()))->>'time')::time),
           'America/Winnipeg')
$$;

-- the next two weeks of lesson days (Monday and Thursday), planned from the library
CREATE OR REPLACE FUNCTION public.community_lessons_plan(_days integer DEFAULT 14)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_learned jsonb := public.community_lesson_learned_time();
  v_day date;
  v_track text;
  v_n int := 0;
  r record;
BEGIN
  FOR i IN 0..greatest(1, least(coalesce(_days, 14), 35)) - 1 LOOP
    v_day := v_today + i;
    v_track := public.community_lesson_track(v_day);
    CONTINUE WHEN v_track IS NULL OR EXISTS (SELECT 1 FROM public.community_lesson_plan p WHERE p.day = v_day);
    INSERT INTO public.community_lesson_plan (day, track, item_id, post_at)
    VALUES (v_day, v_track, public.community_lesson_pick(v_track, v_day), public.community_lesson_default_at(v_day, v_learned))
    ON CONFLICT (day) DO NOTHING;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  FOR r IN SELECT p.id, p.track, p.day FROM public.community_lesson_plan p
            WHERE p.status = 'planned' AND p.item_id IS NULL AND p.day >= v_today ORDER BY p.day LOOP
    UPDATE public.community_lesson_plan SET item_id = public.community_lesson_pick(r.track, r.day), updated_at = now() WHERE id = r.id;
  END LOOP;
  UPDATE public.community_lesson_plan p
     SET post_at = public.community_lesson_default_at(p.day, v_learned), updated_at = now()
   WHERE p.status IN ('planned', 'approved') AND NOT p.time_set AND p.day > v_today
     AND p.post_at IS DISTINCT FROM public.community_lesson_default_at(p.day, v_learned);
  RETURN v_n;
END;
$$;

-- a technique fix's level: the levels a month still needs, against the fix days left in it
CREATE OR REPLACE FUNCTION public.community_lesson_pick(_track text, _day date, _exclude uuid[] DEFAULT '{}'::uuid[])
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from date := date_trunc('month', _day::timestamp)::date;
  v_to date := (date_trunc('month', _day::timestamp) + interval '1 month')::date;
  v_need text[] := '{}';
  v_left int := 0;
  v_must boolean := false;
  v_last_lift text;
  v_recent_tags text[];
  v_cool interval := CASE WHEN _track = 'fix' THEN interval '26 weeks' ELSE interval '12 weeks' END;
  v_id uuid;
BEGIN
  IF _track = 'fix' THEN
    SELECT coalesce(array_agg(l), '{}') INTO v_need
      FROM unnest(ARRAY['beginner', 'advanced', 'elite']) l
     WHERE NOT EXISTS (SELECT 1 FROM public.community_lesson_plan p JOIN public.community_series_items i ON i.id = p.item_id
                        WHERE p.track = 'fix' AND p.day >= v_from AND p.day < v_to AND p.day <> _day
                          AND p.status IN ('planned', 'approved', 'posted') AND coalesce(p.posted_as, 'lesson') = 'lesson'
                          AND i.data->>'level' = l);
    SELECT count(*) INTO v_left FROM generate_series(_day::timestamp, (v_to - 1)::timestamp, interval '1 day') d
     WHERE public.community_lesson_track(d::date) = 'fix'
       AND NOT EXISTS (SELECT 1 FROM public.community_lesson_plan p WHERE p.day = d::date AND p.day <> _day);
    v_must := coalesce(array_length(v_need, 1), 0) >= greatest(v_left, 1);
    SELECT i.data->>'lift' INTO v_last_lift
      FROM public.community_lesson_plan p JOIN public.community_series_items i ON i.id = p.item_id
     WHERE p.track = 'fix' AND p.day < _day AND p.status IN ('planned', 'approved', 'posted')
     ORDER BY p.day DESC LIMIT 1;
  END IF;
  SELECT coalesce(array_agg(DISTINCT t), '{}') INTO v_recent_tags
    FROM public.community_lesson_plan p JOIN public.community_series_items i ON i.id = p.item_id
         CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(i.data->'tags', '[]'::jsonb)) t
   WHERE p.track = _track AND p.day <> _day AND p.day BETWEEN _day - 21 AND _day + 21 AND p.status <> 'skipped';
  WITH interest AS (
    SELECT o.o->>'tag' AS tag, count(*) AS n
      FROM public.community_sticker_answers a
      JOIN public.community_posts p ON p.id = a.post_id AND p.series = 'lesson'
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.sticker->'options', '[]'::jsonb)) WITH ORDINALITY o(o, i)
     WHERE a.choice = o.i - 1 AND o.o->>'tag' IS NOT NULL AND a.created_at > now() - interval '90 days'
     GROUP BY 1
  )
  SELECT i.id INTO v_id
    FROM public.community_series_items i
   WHERE i.series = 'lesson' AND i.active AND i.data->>'track' = _track
     AND NOT i.id = ANY (coalesce(_exclude, '{}'))
     AND NOT EXISTS (SELECT 1 FROM public.community_lesson_plan p
                      WHERE p.item_id = i.id AND p.day <> _day AND p.status IN ('planned', 'approved'))
     AND (NOT v_must OR coalesce(i.data->>'level' = ANY (v_need), false))
   ORDER BY (i.last_used_at IS NOT NULL AND i.last_used_at > now() - v_cool) ASC,
            coalesce(_track = 'fix' AND i.data->>'level' = ANY (v_need), false) DESC,
            (_track = 'fix' AND i.data->>'lift' IS DISTINCT FROM v_last_lift) DESC,
            (SELECT count(*) FROM jsonb_array_elements_text(coalesce(i.data->'tags', '[]'::jsonb)) t WHERE t = ANY (v_recent_tags)) ASC,
            (SELECT coalesce(sum(x.n), 0) FROM interest x WHERE coalesce(i.data->'tags', '[]'::jsonb) ? x.tag) DESC,
            i.last_used_at ASC NULLS FIRST, i.sort_order, i.created_at
   LIMIT 1;
  IF v_id IS NULL AND v_must THEN
    RETURN public.community_lesson_pick_any(_track, _day, _exclude);
  END IF;
  RETURN v_id;
END;
$$;

-- the coach's planner: "today" on his clock, and the crew's-numbers preview only for a Tuesday lesson (there are none now)
CREATE OR REPLACE FUNCTION public.community_lessons_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_settings record;
  v_learned jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public.community_lessons_plan(14);
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  v_learned := public.community_lesson_learned_time();
  RETURN jsonb_build_object(
    'today', v_today,
    'mode', v_settings.lesson_mode,
    'paused', coalesce(v_settings.paused, false),
    'author', CASE WHEN v_settings.author_user_id IS NOT NULL THEN public.community_author(v_settings.author_user_id) END,
    'time', jsonb_build_object('fixed', to_char(v_settings.lesson_time, 'HH24:MI'), 'learned', v_learned),
    'plan', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'day', p.day, 'track', p.track, 'status', p.status, 'post_at', p.post_at, 'time_set', p.time_set,
               'body', coalesce(p.body, i.body), 'edited', p.body IS NOT NULL, 'media', p.media,
               'sticker', CASE WHEN p.sticker_set THEN p.sticker ELSE public.community_sticker_try(i.data->'story') END,
               'sticker_set', p.sticker_set, 'posted_as', p.posted_as, 'post_id', p.post_id, 'posted_at', p.posted_at,
               'error', p.error, 'attempts', p.attempts, 'approved_at', p.approved_at,
               'item', CASE WHEN i.id IS NOT NULL THEN public.community_lesson_item_json(i) END)
             ORDER BY p.day)
        FROM public.community_lesson_plan p
        LEFT JOIN public.community_series_items i ON i.id = p.item_id
       WHERE p.day BETWEEN v_today - 7 AND v_today + 13), '[]'::jsonb),
    'coverage', (
      SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'levels', (
               SELECT jsonb_object_agg(l, (SELECT count(*) FROM public.community_lesson_plan p JOIN public.community_series_items i ON i.id = p.item_id
                                            WHERE p.track = 'fix' AND date_trunc('month', p.day::timestamp) = m AND p.status IN ('planned', 'approved', 'posted')
                                              AND coalesce(p.posted_as, 'lesson') = 'lesson' AND i.data->>'level' = l))
                 FROM unnest(ARRAY['beginner', 'advanced', 'elite']) l)) ORDER BY m)
        FROM (SELECT date_trunc('month', v_today::timestamp) AS m UNION ALL SELECT date_trunc('month', v_today::timestamp) + interval '1 month') ms),
    'library', (
      SELECT jsonb_object_agg(t, (SELECT jsonb_build_object(
               'active', count(*) FILTER (WHERE i.active),
               'fresh', count(*) FILTER (WHERE i.active AND i.last_used_at IS NULL))
               FROM public.community_series_items i WHERE i.series = 'lesson' AND i.data->>'track' = t))
        FROM unnest(ARRAY['strength', 'hypertrophy', 'truth', 'methods', 'mind', 'fix', 'reset']) t),
    'observation', CASE WHEN NOT ('tuesday_tips' = ANY (coalesce(v_settings.series_on, '{}'::text[])))
                        AND EXISTS (SELECT 1 FROM public.community_lesson_plan p
                                      WHERE extract(isodow FROM p.day) = 2 AND p.status IN ('planned', 'approved') AND p.day BETWEEN v_today AND v_today + 13)
                        THEN public.community_compose_observation(public.community_main_account(v_settings.author_user_id)) END,
    'stats', public.community_lessons_stats());
END;
$$;

-- every lesson still to go out moves onto the new days, in its track's turn (soonest first);
-- one with no day left (the Sunday resets) goes back to the library. Running it again changes nothing.
DO $$
DECLARE
  v_today date := public.instant_to_local(now(), 'America/Winnipeg')::date;
  v_learned jsonb := public.community_lesson_learned_time();
  v_slot date;
  v_track text;
  v_id uuid;
BEGIN
  CREATE TEMP TABLE lesson_moves ON COMMIT DROP AS
    SELECT p.id, p.day AS old_day, p.track, NULL::date AS new_day
      FROM public.community_lesson_plan p
     WHERE p.status IN ('planned', 'approved') AND p.day > v_today;
  -- out of the way of the one-lesson-a-day key while they move
  UPDATE public.community_lesson_plan p SET day = p.day + 36500 FROM lesson_moves m WHERE m.id = p.id;
  FOR v_slot IN SELECT d::date FROM generate_series((v_today + 1)::timestamp, (v_today + 56)::timestamp, interval '1 day') d LOOP
    v_track := public.community_lesson_track(v_slot);
    CONTINUE WHEN v_track IS NULL OR EXISTS (SELECT 1 FROM public.community_lesson_plan p WHERE p.day = v_slot);
    SELECT m.id INTO v_id FROM lesson_moves m WHERE m.new_day IS NULL AND m.track = v_track ORDER BY m.old_day LIMIT 1;
    CONTINUE WHEN v_id IS NULL;
    UPDATE lesson_moves SET new_day = v_slot WHERE id = v_id;
    UPDATE public.community_lesson_plan p
       SET day = v_slot,
           post_at = CASE WHEN p.time_set
                          THEN public.local_to_instant(v_slot + public.instant_to_local(p.post_at, 'America/Winnipeg')::time, 'America/Winnipeg')
                          ELSE public.community_lesson_default_at(v_slot, v_learned) END,
           updated_at = now()
     WHERE p.id = v_id;
  END LOOP;
  DELETE FROM public.community_lesson_plan p USING lesson_moves m WHERE m.id = p.id AND m.new_day IS NULL;
END $$;

-- and every lesson day's time on the coach's real clock
SELECT public.community_lessons_plan(14);
