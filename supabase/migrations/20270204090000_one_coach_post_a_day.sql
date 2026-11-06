-- One coach post a day.
--
-- Before: 16 automated posts a week (a daily picture every day, lessons Monday
-- and Thursday, five library series Monday to Saturday, Wins, the Recap) for a
-- crew where about 6 people open Crew a day and 12 a week, and a visit reads
-- one or two posts. In the 30 days to Nov 6 that was 55 automated posts
-- against 28 posts by members, and not one automated post got a comment, while
-- members' posts did. Mondays and Thursdays had three coach posts, and the
-- Friday picture and Finish Strong Friday went out an hour apart saying much
-- the same thing.
--
-- Now each day has one job:
--   Mon  lesson              Tue  Tuesday tip (and the crew's numbers)
--   Wed  Wednesday Wins      Thu  lesson
--   Fri  daily picture       Sat  daily picture
--   Sun  daily picture with the verse, and the Recap in the evening
-- The daily picture goes out only on a day nothing else does
-- (`community_coach_post_day`), so a lesson the coach moves, a series he turns
-- back on or a holiday takes the day and the picture steps aside; Sunday's
-- always runs, since it carries the weekly verse. Monday Motivation, Try it
-- Thursday, Finish Strong Friday and Saturday Spirit are switched off (their
-- libraries stay, each still a switch in Crew → Posts): Monday and Thursday are
-- the lessons', and the daily picture is a better Friday and Saturday post.

-- ── what else goes out on a day (NULL: nothing, so it's a picture day) ─────
CREATE OR REPLACE FUNCTION public.community_coach_post_day(_day date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    -- Sunday's picture carries the weekly verse: always its day
    WHEN d.n = 7 THEN NULL
    -- a lesson: one planned, approved or out that day, or a lesson day not planned yet
    WHEN EXISTS (SELECT 1 FROM public.community_lesson_plan l
                  WHERE l.day = _day AND l.status IN ('planned', 'approved', 'posted'))
      OR (public.community_lesson_track(_day) IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.community_lesson_plan l WHERE l.day = _day)) THEN 'lesson'
    WHEN d.n = 3 THEN 'wednesday_wins'
    WHEN d.n = 1 AND 'monday_motivation' = ANY (s.series_on) THEN 'monday_motivation'
    WHEN d.n = 2 AND 'tuesday_tips' = ANY (s.series_on) THEN 'tuesday_tips'
    WHEN d.n = 4 AND 'try_it_thursday' = ANY (s.series_on) THEN 'try_it_thursday'
    WHEN d.n = 5 AND 'finish_strong_friday' = ANY (s.series_on) THEN 'finish_strong_friday'
    WHEN d.n = 6 AND 'saturday_spirit' = ANY (s.series_on) THEN 'saturday_spirit'
    WHEN EXISTS (SELECT 1 FROM public.community_holidays h
                  WHERE h.active AND public.community_holiday_date(h.key, extract(year FROM _day)::int) = _day) THEN 'holiday'
  END
    FROM (SELECT extract(isodow FROM _day)::int AS n) d
    LEFT JOIN (SELECT coalesce(series_on, '{}'::text[]) AS series_on
                 FROM public.community_series_settings WHERE id LIMIT 1) s ON true
$$;
REVOKE ALL ON FUNCTION public.community_coach_post_day(date) FROM PUBLIC, anon, authenticated;

-- ── the planner makes a picture only for the days it'll go out ─────────────
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
   WHERE public.community_coach_post_day(d::date) IS NULL
  ON CONFLICT (day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_daily_visuals_plan(date, int) FROM PUBLIC, anon, authenticated;

-- ── the coach's card shows the week: what goes out each day ────────────────
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
    'refs', coalesce((SELECT daily_visuals_refs FROM public.community_series_settings WHERE id), '{}'::jsonb),
    'today', v_today,
    'week', (SELECT jsonb_agg(jsonb_build_object('day', d::date, 'post', public.community_coach_post_day(d::date)) ORDER BY d)
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
               'format', v.format, 'topic', v.topic,
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

-- ── the series that doubled up a day go off (their libraries stay) ─────────
UPDATE public.community_series_settings
   SET series_on = ARRAY(SELECT s FROM unnest(coalesce(series_on, '{}'::text[])) s
                          WHERE s NOT IN ('monday_motivation', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit')),
       updated_at = now()
 WHERE id;

-- ── pictures already planned for a day that's now taken ───────────────────
-- Untouched placeholders go; one already made is skipped, so the coach can
-- still bring it back or post it from its sheet.
DELETE FROM public.community_daily_visuals v
 WHERE v.day >= public.instant_to_local(now(), 'America/Winnipeg')::date
   AND v.status = 'planned' AND v.picture IS NULL AND v.ai_line IS NULL AND v.coach_line IS NULL
   AND v.candidate IS NULL AND v.concept IS NULL AND v.post_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.community_daily_visual_versions x WHERE x.visual_id = v.id)
   AND public.community_coach_post_day(v.day) IS NOT NULL;

UPDATE public.community_daily_visuals v
   SET status = 'skipped', updated_at = now()
 WHERE v.day >= public.instant_to_local(now(), 'America/Winnipeg')::date
   AND v.status IN ('planned', 'ready') AND v.post_id IS NULL
   AND public.community_coach_post_day(v.day) IS NOT NULL;
