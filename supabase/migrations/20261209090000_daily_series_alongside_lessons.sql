-- The five daily series the lessons took over (Monday Motivation, Tuesday Tips,
-- Try it Thursday, Finish Strong Friday, Saturday Spirit) come back as the
-- coach's choice: each one on or off, posting at its own time alongside that
-- day's lesson. Their libraries were kept (75 posts), so nothing is re-seeded.
-- Off by default: the week stays as it is until the coach turns one on.
SET lock_timeout = '3s';

ALTER TABLE public.community_series_settings ADD COLUMN IF NOT EXISTS series_on text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.community_series_settings DROP CONSTRAINT IF EXISTS community_series_settings_series_on_check;
ALTER TABLE public.community_series_settings ADD CONSTRAINT community_series_settings_series_on_check CHECK (
  series_on <@ ARRAY['monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit']::text[]
);

/** Turn one of the five series on or off (coaches). Returns the series that are on. */
CREATE OR REPLACE FUNCTION public.community_series_set_on(_series text, _on boolean)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_on text[];
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _series IS NULL OR _series NOT IN ('monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit') THEN
    RAISE EXCEPTION 'Unknown series';
  END IF;
  UPDATE public.community_series_settings
     SET series_on = CASE WHEN coalesce(_on, false)
                          THEN (SELECT coalesce(array_agg(DISTINCT s ORDER BY s), '{}') FROM unnest(series_on || _series) s)
                          ELSE array_remove(series_on, _series) END,
         updated_at = now()
   WHERE id
  RETURNING series_on INTO v_on;
  RETURN coalesce(v_on, '{}');
END;
$$;
REVOKE ALL ON FUNCTION public.community_series_set_on(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_series_set_on(text, boolean) TO authenticated;

-- The daily job: Wins and Recap as always; the other five only when the coach
-- turned them on (that day's lesson goes out too). Everything else is as it
-- was: Tuesday Tips posts the crew's own numbers when they hold, else a tip.
CREATE OR REPLACE FUNCTION public.community_publish_series(_series text DEFAULT NULL::text, _force boolean DEFAULT false, _at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  v_local timestamp := (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg');
  v_dow int := extract(isodow FROM v_local);
  v_series text := coalesce(_series, c_days[extract(isodow FROM (coalesce(_at, now()) AT TIME ZONE 'America/Winnipeg'))::int]);
  v_settings record;
  v_author uuid;
  v_key text;
  v_item record;
  v_id uuid;
  v_start time;
  v_end time;
  v_comp jsonb;
  v_caption text;
  v_data jsonb;
  v_stat jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT v_series = ANY (c_days) THEN RAISE EXCEPTION 'Unknown series'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  -- the other five days are lessons (community_publish_lessons); a series the coach turned on posts too
  IF _series IS NULL AND v_series NOT IN ('wednesday_wins', 'sunday_recap')
     AND NOT (v_series = ANY (coalesce(v_settings.series_on, '{}'::text[]))) THEN
    RETURN jsonb_build_object('status', 'lesson_day');
  END IF;
  v_start := CASE v_series
    WHEN 'monday_motivation' THEN time '07:00' WHEN 'finish_strong_friday' THEN time '07:00'
    WHEN 'saturday_spirit' THEN time '09:00' WHEN 'sunday_recap' THEN time '19:00'
    ELSE time '12:00' END;
  v_end := CASE WHEN v_start >= time '19:00' THEN time '23:59:59' ELSE v_start + interval '5 hours' END;
  IF NOT coalesce(_force, false) THEN
    IF v_dow <> array_position(c_days, v_series) OR v_local::time < v_start OR v_local::time >= v_end THEN
      RETURN jsonb_build_object('status', 'outside_window');
    END IF;
  END IF;

  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RETURN jsonb_build_object('status', 'no_author'); END IF;

  v_key := v_series || ':' || to_char(v_local, 'IYYY-"W"IW');
  IF EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_key) THEN
    RETURN jsonb_build_object('status', 'exists', 'key', v_key);
  END IF;

  IF v_series IN ('wednesday_wins', 'sunday_recap') THEN
    IF v_series = 'wednesday_wins' THEN
      v_comp := public.community_compose_wins((date_trunc('week', v_local)::date - 7), v_author);
      IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;
      v_data := CASE WHEN EXISTS (SELECT 1 FROM public.community_series_runs r
                                   WHERE r.series_key = 'sunday_recap:' || to_char(date_trunc('week', v_local)::date - 1, 'IYYY-"W"IW'))
                     THEN NULL ELSE v_comp->'stats' END;
    ELSE
      v_comp := public.community_compose_recap(date_trunc('week', v_local)::date, v_author);
      IF v_comp IS NULL THEN RETURN jsonb_build_object('status', 'no_wins'); END IF;
      v_data := v_comp->'stats';
    END IF;
    INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
    INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at)
    VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
            v_comp->>'caption', v_series, v_key, v_data, coalesce(_at, now()))
    RETURNING id INTO v_id;
    UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
    INSERT INTO public.community_series_features (series_key, client_id, win_type, featured_at)
    SELECT v_key, (f->>'client_id')::uuid, f->>'type', coalesce(_at, now()) FROM jsonb_array_elements(coalesce(v_comp->'featured', '[]'::jsonb)) f
    ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key);
  END IF;

  IF v_series = 'tuesday_tips' THEN
    v_comp := public.community_compose_observation(v_author);
    IF v_comp IS NOT NULL THEN
      INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, v_series) ON CONFLICT (series_key) DO NOTHING;
      IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
      INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data, created_at)
      VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
              v_comp->>'caption', v_series, v_key, v_comp - 'caption', coalesce(_at, now()))
      RETURNING id INTO v_id;
      UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
      RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'observation', v_comp->>'observation');
    END IF;
  END IF;

  SELECT * INTO v_item FROM public.community_series_next(v_series);
  IF v_item.id IS NULL THEN RETURN jsonb_build_object('status', 'no_items'); END IF;

  v_caption := v_item.body;
  v_data := v_item.data;
  IF v_series = 'try_it_thursday' THEN
    v_stat := public.community_feature_stat(v_item.data, v_author);
    IF v_stat IS NOT NULL THEN
      v_caption := v_caption || E'\n\n📊 ' || (v_stat->>'line');
      v_data := coalesce(v_data, '{}'::jsonb) || jsonb_build_object('stat', v_stat - 'line');
    END IF;
  END IF;

  INSERT INTO public.community_series_runs (series_key, series, item_id) VALUES (v_key, v_series, v_item.id)
  ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, quote, quote_author, quote_source,
                                      series, series_key, series_item_id, series_data, created_at)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', v_caption,
          v_item.quote, CASE WHEN v_item.quote IS NOT NULL THEN v_item.mentor END, v_item.quote_source,
          v_series, v_key, v_item.id, v_data, coalesce(_at, now()))
  ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
  IF jsonb_array_length(coalesce(v_item.media, '[]'::jsonb)) > 0 THEN PERFORM public.community_apply_media(v_id, v_item.media); END IF;

  UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
  UPDATE public.community_series_items SET last_used_at = coalesce(_at, now()), use_count = use_count + 1, media = '[]'::jsonb WHERE id = v_item.id;
  RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key, 'mentor', v_item.mentor);
END;
$function$;

-- Tuesday's lesson: with Tuesday Tips on, the crew's own numbers are the tip's
-- (as before the lessons), so the lesson goes out as a lesson. Off, the lesson
-- posts them while that week's Tuesday slot is still free, instead of failing
-- on a slot Tuesday Tips already took.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_lesson_post(uuid,boolean)'::regprocedure);
  v_old text := 'IF coalesce(_data_ok, true) AND extract(isodow FROM r.day) = 2 THEN';
  v_new text := 'IF coalesce(_data_ok, true) AND extract(isodow FROM r.day) = 2'
             || E'\n     AND NOT (''tuesday_tips'' = ANY (coalesce(v_settings.series_on, ''{}''::text[])))'
             || E'\n     AND NOT EXISTS (SELECT 1 FROM public.community_series_runs x WHERE x.series_key = ''tuesday_tips:'' || to_char(r.day, ''IYYY-"W"IW'')) THEN';
BEGIN
  IF position('x.series_key = ''tuesday_tips:''' IN v_def) > 0 THEN RETURN; END IF; -- already patched
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'community_lesson_post: Tuesday anchor not found'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

-- ...and the planner stops saying Tuesday's numbers go out "instead" of the lesson.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_lessons_overview()'::regprocedure);
  v_old text := '''observation'', CASE WHEN EXISTS (SELECT 1 FROM public.community_lesson_plan p';
  v_new text := '''observation'', CASE WHEN NOT (''tuesday_tips'' = ANY (coalesce(v_settings.series_on, ''{}''::text[])))'
             || E'\n                        AND EXISTS (SELECT 1 FROM public.community_lesson_plan p';
BEGIN
  IF position('''observation'', CASE WHEN NOT (''tuesday_tips''' IN v_def) > 0 THEN RETURN; END IF; -- already patched
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'community_lessons_overview: observation anchor not found'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

-- The coach screen: which series are on, and the holidays coming up (they post at 9 am on the day).
CREATE OR REPLACE FUNCTION public.community_series_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  c_libs constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit'];
  v_settings record;
  v_local timestamp := now() AT TIME ZONE 'America/Winnipeg';
  v_today date := (now() AT TIME ZONE 'America/Winnipeg')::date;
  v_year int := extract(year FROM now() AT TIME ZONE 'America/Winnipeg')::int;
  v_wk text := to_char(now() AT TIME ZONE 'America/Winnipeg', 'IYYY-"W"IW');
  v_wins_posted boolean;
  v_preview jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  v_wins_posted := EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = 'wednesday_wins:' || v_wk);
  v_preview := public.community_compose_wins(date_trunc('week', v_local)::date - CASE WHEN v_wins_posted THEN 0 ELSE 7 END,
                                              public.community_main_account(v_settings.author_user_id));
  RETURN jsonb_build_object(
    'wins_preview', CASE WHEN v_preview IS NOT NULL THEN jsonb_build_object('body', v_preview->>'caption', 'featured', jsonb_array_length(v_preview->'featured'),
                                                                             'trainers', v_preview->'trainers', 'week_of', v_preview->>'week_of', 'next_week', v_wins_posted,
                                                                             'stats', v_preview->'stats') END,
    'paused', coalesce(v_settings.paused, false),
    'series_on', to_jsonb(coalesce(v_settings.series_on, '{}'::text[])),
    'author', CASE WHEN v_settings.author_user_id IS NOT NULL THEN public.community_author(v_settings.author_user_id) END,
    'next', coalesce((SELECT jsonb_object_agg(s.series, jsonb_build_object('id', n.id, 'mentor', n.mentor, 'body', n.body,
                                                                           'quote', n.quote, 'quote_source', n.quote_source, 'data', n.data,
                                                                           'media', n.media))
                        FROM unnest(c_libs) s(series)
                        CROSS JOIN LATERAL public.community_series_next(s.series) n
                       WHERE n.id IS NOT NULL), '{}'::jsonb),
    'library', (SELECT jsonb_object_agg(s.series, (SELECT count(*) FROM public.community_series_items i WHERE i.series = s.series AND i.active))
                  FROM unnest(c_libs) s(series)),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'series', p.series, 'created_at', p.created_at,
                                                             'mentor', i.mentor, 'caption', left(p.caption, 120))
                                          ORDER BY p.created_at DESC)
                           FROM (SELECT * FROM public.community_posts WHERE series IS NOT NULL ORDER BY created_at DESC LIMIT 8) p
                           LEFT JOIN public.community_series_items i ON i.id = p.series_item_id), '[]'::jsonb),
    'this_week', (SELECT jsonb_object_agg(s.series, EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = s.series || ':' || v_wk))
                    FROM unnest(c_days) s(series)),
    'holidays', coalesce((
      SELECT jsonb_agg(jsonb_build_object('key', h.key, 'name', h.name, 'date', h.d, 'body', h.body,
                                          'posted', EXISTS (SELECT 1 FROM public.community_series_runs r
                                                             WHERE r.series_key = 'holiday:' || h.key || ':' || extract(year FROM h.d)::int))
                       ORDER BY h.d)
        FROM (SELECT x.key, x.name, x.body,
                     CASE WHEN public.community_holiday_date(x.key, v_year) >= v_today THEN public.community_holiday_date(x.key, v_year)
                          ELSE public.community_holiday_date(x.key, v_year + 1) END AS d
                FROM public.community_holidays x WHERE x.active) h
       WHERE h.d IS NOT NULL AND h.d <= v_today + 120), '[]'::jsonb));
END;
$function$;
