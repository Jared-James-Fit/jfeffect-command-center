-- One weekly crew post, and this week's extra coach posts out of the feed.
--
-- Wednesday Wins and the Sunday Recap both reported the same week (Nov 1's
-- Recap: "50 PRs between 9 of you"; Nov 4's Wins: "50 PRs last week"), three
-- days apart. Wins is the one people stay for (36% left Crew on it against
-- 60% on the Recap; 0.8 likes a post against 0.5) and it names people, so it
-- stays the weekly crew post: with no Recap the week before, Wins already
-- carries the week's numbers card (`community_publish_series`). The Recap now
-- posts on its own only while the coach has it on (`series_on`, a switch like
-- the library series, off), and Post now still sends one by hand.
--
-- The publisher also read the local time with a bare AT TIME ZONE, which this
-- database still drops to UTC-6 for Winnipeg, so every series went out an
-- hour late (Tuesday's tip at 1 pm, Monday Motivation at 8 am): it reads it
-- through instant_to_local now.
--
-- And the last 7 days of the feed, the "new to you" window, held 20 coach
-- posts against 3 by members. The ones the one-a-day plan wouldn't have sent
-- and nobody (no coach) liked, commented on, saved or reposted are archived:
-- lessons on days that are no longer lesson days, pictures on days something
-- else had, and the three posts of the series now switched off. Archived, not
-- deleted: the author keeps them, and anything someone engaged with stays.

-- ── the Recap is a switch too ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_series_set_on(_series text, _on boolean)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_on text[];
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _series IS NULL OR _series NOT IN ('monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday',
                                        'saturday_spirit', 'sunday_recap') THEN
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

-- ── the publisher: Wins always, the Recap only while it's on, on time ────
CREATE OR REPLACE FUNCTION public.community_publish_series(_series text DEFAULT NULL, _force boolean DEFAULT false, _at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  v_local timestamp := public.instant_to_local(coalesce(_at, now()), 'America/Winnipeg');
  v_dow int := extract(isodow FROM v_local);
  v_series text := coalesce(_series, c_days[extract(isodow FROM v_local)::int]);
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
  -- on its own, only Wins always runs; every other one posts while the coach has it on
  IF _series IS NULL AND v_series <> 'wednesday_wins'
     AND NOT (v_series = ANY (coalesce(v_settings.series_on, '{}'::text[]))) THEN
    RETURN jsonb_build_object('status', 'off');
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
      -- the week's numbers card, unless a Recap already showed them
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
$$;

-- ── this week's extra coach posts out of the feed ────────────────────────
-- Oct 30 to Nov 6, as the one-a-day plan would have had it: each one still
-- unarchived, still the coach's automated post, and still with nothing from
-- anyone but staff on it, or it stays.
WITH extra(id) AS (VALUES
  ('50623a7b-a2d7-436f-abfb-4a577b5f23a1'::uuid), -- Fri Oct 30 lesson (Friday is the picture's)
  ('93584a8e-87d2-4d64-b654-3061ccfaf73d'::uuid), -- Sat Oct 31 lesson (Halloween's day)
  ('0e9d8f2b-a340-4c54-a282-3fd464d2a0b2'::uuid), -- Sun Nov 1 lesson (the verse and the Recap's)
  ('5c669672-3504-45a7-be1a-90062c87d58a'::uuid), -- Mon Nov 2 picture (the lesson's day)
  ('38970b0f-a805-41ac-aeef-cb5a0531ab41'::uuid), -- Tue Nov 3 picture (the tip's day)
  ('64d24635-ae4d-48a3-b61e-1853a8a9f455'::uuid), -- Tue Nov 3 lesson (the tip's day)
  ('8e7692ff-b597-436c-9450-4faacc31b464'::uuid), -- Wed Nov 4 picture (Wins' day)
  ('1cb62a4b-8534-49f5-861c-0f01f10f74ac'::uuid), -- Thu Nov 5 picture (the lesson's day)
  ('62c23238-cb4a-4346-91e1-11375025bbf8'::uuid), -- Thu Nov 5 Try it Thursday (switched off)
  ('74d01dd2-3779-44d6-bea5-35267af70255'::uuid)  -- Fri Nov 6 Finish Strong Friday (switched off, an hour after the picture)
), staff AS (SELECT s AS id FROM public.community_staff_people() s WHERE s IS NOT NULL)
UPDATE public.community_posts p
   SET archived_at = now()
  FROM extra e
 WHERE p.id = e.id
   AND p.archived_at IS NULL
   AND p.series IN ('lesson', 'daily_visual', 'try_it_thursday', 'finish_strong_friday')
   AND NOT EXISTS (SELECT 1 FROM public.community_reactions r WHERE r.post_id = p.id AND r.user_id NOT IN (SELECT id FROM staff))
   AND NOT EXISTS (SELECT 1 FROM public.community_comments c WHERE c.post_id = p.id AND c.author_user_id NOT IN (SELECT id FROM staff))
   AND NOT EXISTS (SELECT 1 FROM public.community_saves s WHERE s.post_id = p.id AND s.user_id NOT IN (SELECT id FROM staff))
   AND NOT EXISTS (SELECT 1 FROM public.community_reposts r WHERE r.post_id = p.id AND r.user_id NOT IN (SELECT id FROM staff));

-- ── "Next: …" on the coach's Posts tab follows the week as it now runs ───
-- A lesson, Wins, a series that's on, or the morning's picture on a day
-- nothing else takes; never the Recap or a series that's off. Local times go
-- through local_to_instant (Manitoba's fixed UTC-5).
CREATE OR REPLACE FUNCTION public.community_next_post()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  c_days constant text[] := ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                  'finish_strong_friday', 'saturday_spirit', 'sunday_recap'];
  c_time constant time[] := ARRAY[time '07:00', time '12:00', time '12:00', time '12:00', time '07:00', time '09:00', time '19:00'];
  v_local timestamp := public.instant_to_local(now(), tz);
  v_settings record;
  v_lesson jsonb;
  v_fixed jsonb;
  v_day date;
  v_dow int;
  v_series text;
  v_time time;
BEGIN
  SELECT * INTO v_settings FROM public.community_series_settings s WHERE s.id;
  SELECT jsonb_build_object('series', 'lesson', 'at', p.post_at, 'title', i.data->>'title', 'track', p.track,
                            'needs_ok', v_settings.lesson_mode = 'review' AND p.status = 'planned')
    INTO v_lesson
    FROM public.community_lesson_plan p LEFT JOIN public.community_series_items i ON i.id = p.item_id
   WHERE p.status IN ('planned', 'approved') AND p.item_id IS NOT NULL AND p.post_at > now()
   ORDER BY p.post_at LIMIT 1;
  FOR i IN 0..7 LOOP
    v_day := v_local::date + i;
    v_dow := extract(isodow FROM v_day)::int;
    -- the morning's picture, on a day nothing else takes
    IF coalesce(v_settings.daily_visuals_on, true) AND public.community_coach_post_day(v_day) IS NULL
       AND NOT (i = 0 AND v_local::time >= time '21:00')
       AND NOT EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = 'daily_visual:' || v_day::text) THEN
      v_fixed := jsonb_build_object('series', 'daily_visual', 'at', public.local_to_instant(v_day + time '07:00', tz));
      EXIT;
    END IF;
    -- the day's series: Wins always, any other while it's on
    v_series := c_days[v_dow];
    v_time := c_time[v_dow];
    IF (v_series = 'wednesday_wins' OR v_series = ANY (coalesce(v_settings.series_on, '{}'::text[])))
       AND NOT (i = 0 AND v_local::time >= CASE WHEN v_time >= time '19:00' THEN time '23:59:59' ELSE v_time + interval '5 hours' END)
       AND NOT EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_series || ':' || to_char(v_day, 'IYYY-"W"IW')) THEN
      v_fixed := jsonb_build_object('series', v_series, 'at', public.local_to_instant(v_day + v_time, tz));
      EXIT;
    END IF;
  END LOOP;
  IF v_lesson IS NULL THEN RETURN v_fixed; END IF;
  IF v_fixed IS NULL OR (v_lesson->>'at')::timestamptz <= (v_fixed->>'at')::timestamptz THEN RETURN v_lesson; END IF;
  RETURN v_fixed;
END;
$$;
