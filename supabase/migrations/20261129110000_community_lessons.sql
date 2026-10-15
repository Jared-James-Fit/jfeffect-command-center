-- Coach lessons: the educational posts in the Crew, planned ahead, reviewed by
-- the coach, posted at the hour the crew is actually around.
--
-- The week keeps its 7 posts. Wednesday Wins and Sunday Recap stay as they
-- are; the five library days become lessons from the coach's own library
-- (community_series_items, series 'lesson'):
--
--   Mon  strength     technique & biomechanics, strength curves, adaptation, programming
--   Tue  hypertrophy  bodybuilding technique & the science of growth
--                     (the crew's own data takes the slot, at most once every 4 weeks,
--                      when the numbers hold up with 5+ people on each side)
--   Thu  methods      bodybuilding cues & advanced methods
--   Fri  mind         psychology & well-known research, recovery, mindset, experiments
--   Sat  fix          Powerlifting Technique & Troubleshooting: problem → why → fix →
--                     when it applies, by lift and by level (beginner / advanced / elite);
--                     every calendar month gets at least one of each level
--
-- community_lesson_plan holds the next two weeks, one lesson a day. While the
-- coach is reviewing (lesson_mode 'review', the default) a lesson only goes out
-- once he's approved it; 'auto' posts whatever's planned unless he skipped it.
-- Each one can be edited, swapped for another lesson, moved, skipped, or posted
-- now. Posting is idempotent ('lesson:<day>' in community_series_runs + the
-- posts' unique series_key) and a failure is retried, then flagged, never
-- doubled. A lesson can carry a story sticker (poll, slider, question box):
-- the post is in the coach's story for 24h like every Crew post, and answers
-- that point at a topic (a poll option's tag) steer what gets planned next.

-- ── Series ───────────────────────────────────────────────────────────────────
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_series_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_series_check CHECK (
  series IS NULL OR (kind = 'note' AND series = ANY (ARRAY['monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
                                                            'finish_strong_friday', 'saturday_spirit', 'sunday_recap', 'holiday', 'lesson'])));
ALTER TABLE public.community_series_items DROP CONSTRAINT IF EXISTS community_series_items_series_check;
ALTER TABLE public.community_series_items ADD CONSTRAINT community_series_items_series_check CHECK (
  series = ANY (ARRAY['monday_motivation', 'tuesday_tips', 'try_it_thursday', 'finish_strong_friday', 'saturday_spirit', 'lesson']));
-- one library entry per lesson key (the seed and the editor both rely on it)
CREATE UNIQUE INDEX IF NOT EXISTS community_series_items_lesson_key_uidx
  ON public.community_series_items ((data->>'key')) WHERE series = 'lesson';

ALTER TABLE public.community_series_settings ADD COLUMN IF NOT EXISTS lesson_mode text NOT NULL DEFAULT 'review';
ALTER TABLE public.community_series_settings DROP CONSTRAINT IF EXISTS community_series_settings_lesson_mode_check;
ALTER TABLE public.community_series_settings ADD CONSTRAINT community_series_settings_lesson_mode_check CHECK (lesson_mode IN ('review', 'auto'));
-- NULL = learned from when the crew opens the app
ALTER TABLE public.community_series_settings ADD COLUMN IF NOT EXISTS lesson_time time;

-- ── Story stickers (any post: the coach's lessons and anyone's own story) ────
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS sticker jsonb;
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_sticker_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_sticker_check CHECK (sticker IS NULL OR jsonb_typeof(sticker) = 'object');

CREATE TABLE IF NOT EXISTS public.community_sticker_answers (
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  choice smallint CHECK (choice IS NULL OR choice BETWEEN 0 AND 3),
  value smallint CHECK (value IS NULL OR value BETWEEN 0 AND 100),
  body text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_sticker_answers_recent_idx ON public.community_sticker_answers (created_at DESC);
ALTER TABLE public.community_sticker_answers ENABLE ROW LEVEL SECURITY;
-- read and written only through the functions below

-- ── The plan ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_lesson_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL UNIQUE,
  track text NOT NULL CHECK (track IN ('strength', 'hypertrophy', 'methods', 'mind', 'fix')),
  item_id uuid REFERENCES public.community_series_items(id) ON DELETE SET NULL,
  -- the coach's wording for this post (NULL = the library's)
  body text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 1200),
  media jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media) = 'array'),
  -- the coach's sticker for this post, when sticker_set (NULL then = no sticker)
  sticker jsonb,
  sticker_set boolean NOT NULL DEFAULT false,
  post_at timestamptz NOT NULL,
  time_set boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'approved', 'posted', 'skipped', 'missed', 'failed')),
  posted_as text CHECK (posted_as IN ('lesson', 'data')),
  approved_by uuid,
  approved_at timestamptz,
  post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL,
  posted_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  error text,
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_lesson_plan_due_idx ON public.community_lesson_plan (post_at) WHERE status IN ('planned', 'approved');
ALTER TABLE public.community_lesson_plan ENABLE ROW LEVEL SECURITY;
-- staff read and change it only through the functions below

-- Which lesson track a weekday carries (Wednesday and Sunday are Wins and Recap).
CREATE OR REPLACE FUNCTION public.community_lesson_track(_day date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE extract(isodow FROM _day)::int
    WHEN 1 THEN 'strength' WHEN 2 THEN 'hypertrophy' WHEN 4 THEN 'methods' WHEN 5 THEN 'mind' WHEN 6 THEN 'fix' END
$$;

-- ── Stickers ─────────────────────────────────────────────────────────────────
/** A sticker as stored, or an exception saying what's wrong with it. */
CREATE OR REPLACE FUNCTION public.community_sticker_clean(_s jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  v_type text := _s->>'type';
  v_q text := btrim(coalesce(_s->>'q', ''));
  v_opts jsonb := '[]'::jsonb;
  v_o jsonb;
  v_label text;
  v_tag text;
  v_emoji text;
BEGIN
  IF _s IS NULL OR jsonb_typeof(_s) <> 'object' THEN RETURN NULL; END IF;
  IF v_type IS NULL OR v_type NOT IN ('poll', 'slider', 'question') THEN RAISE EXCEPTION 'Pick a poll, a slider or a question'; END IF;
  IF char_length(v_q) < 1 OR char_length(v_q) > 80 THEN RAISE EXCEPTION 'Keep the question to 80 characters'; END IF;
  IF v_type = 'poll' THEN
    IF jsonb_typeof(_s->'options') <> 'array' OR jsonb_array_length(_s->'options') NOT BETWEEN 2 AND 4 THEN
      RAISE EXCEPTION 'A poll needs 2 to 4 answers';
    END IF;
    FOR v_o IN SELECT * FROM jsonb_array_elements(_s->'options') LOOP
      v_label := btrim(coalesce(CASE WHEN jsonb_typeof(v_o) = 'string' THEN v_o #>> '{}' ELSE v_o->>'label' END, ''));
      v_tag := CASE WHEN jsonb_typeof(v_o) = 'object' THEN nullif(lower(btrim(coalesce(v_o->>'tag', ''))), '') END;
      IF char_length(v_label) < 1 OR char_length(v_label) > 24 THEN RAISE EXCEPTION 'Keep each answer to 24 characters'; END IF;
      IF v_tag IS NOT NULL AND v_tag !~ '^[a-z0-9-]{1,32}$' THEN v_tag := NULL; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) e WHERE lower(e->>'label') = lower(v_label)) THEN
        RAISE EXCEPTION 'Each answer needs to be different';
      END IF;
      v_opts := v_opts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('label', v_label, 'tag', v_tag)));
    END LOOP;
    RETURN jsonb_build_object('type', 'poll', 'q', v_q, 'options', v_opts);
  ELSIF v_type = 'slider' THEN
    v_emoji := btrim(coalesce(_s->>'emoji', ''));
    IF v_emoji = '' OR char_length(v_emoji) > 8 THEN v_emoji := '🔥'; END IF;
    RETURN jsonb_build_object('type', 'slider', 'q', v_q, 'emoji', v_emoji);
  END IF;
  RETURN jsonb_build_object('type', 'question', 'q', v_q);
END;
$$;

/** The same, or NULL instead of an error (a library entry must never break a screen or a post). */
CREATE OR REPLACE FUNCTION public.community_sticker_try(_s jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
BEGIN
  RETURN public.community_sticker_clean(_s);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

/**
 * A post's sticker for one viewer: the question, the tallies once there's
 * something to show, the viewer's own answer, and (the poster only) who
 * answered what. Question-box answers are only ever the poster's to read.
 */
CREATE OR REPLACE FUNCTION public.community_sticker_json(_post_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_s jsonb;
  v_author uuid;
  v_me uuid := public.community_main_account(_viewer);
  v_mine record;
  v_has boolean;
  v_total int;
  v_out jsonb;
BEGIN
  SELECT p.sticker, p.author_user_id INTO v_s, v_author FROM public.community_posts p WHERE p.id = _post_id;
  IF v_s IS NULL THEN RETURN NULL; END IF;
  SELECT a.choice, a.value, a.body INTO v_mine FROM public.community_sticker_answers a WHERE a.post_id = _post_id AND a.user_id = v_me;
  v_has := FOUND;
  SELECT count(*) INTO v_total FROM public.community_sticker_answers a WHERE a.post_id = _post_id;
  v_out := v_s || jsonb_build_object(
    'total', v_total,
    'is_mine', v_author = v_me,
    'mine', CASE WHEN v_has AND (v_mine.choice IS NOT NULL OR v_mine.value IS NOT NULL OR v_mine.body IS NOT NULL)
                 THEN jsonb_strip_nulls(jsonb_build_object('choice', v_mine.choice, 'value', v_mine.value, 'body', v_mine.body)) END);
  IF v_s->>'type' = 'poll' THEN
    v_out := jsonb_set(v_out, '{options}', (
      SELECT coalesce(jsonb_agg(o.o || jsonb_build_object('votes',
               (SELECT count(*) FROM public.community_sticker_answers a WHERE a.post_id = _post_id AND a.choice = o.i - 1)) ORDER BY o.i), '[]'::jsonb)
        FROM jsonb_array_elements(v_s->'options') WITH ORDINALITY o(o, i)));
  ELSIF v_s->>'type' = 'slider' THEN
    v_out := v_out || jsonb_build_object('average',
      (SELECT round(avg(a.value))::int FROM public.community_sticker_answers a WHERE a.post_id = _post_id AND a.value IS NOT NULL));
  END IF;
  IF v_author = v_me THEN
    v_out := v_out || jsonb_build_object('answers', coalesce((
      SELECT jsonb_agg(public.community_author(a.user_id)
                       || jsonb_strip_nulls(jsonb_build_object('choice', a.choice, 'value', a.value, 'body', a.body, 'at', a.updated_at))
                       ORDER BY a.updated_at DESC)
        FROM (SELECT * FROM public.community_sticker_answers a WHERE a.post_id = _post_id ORDER BY a.updated_at DESC LIMIT 100) a), '[]'::jsonb));
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.community_sticker_json(uuid, uuid) FROM PUBLIC, anon;

/** Answer a sticker (again to change it; a poll answer of NULL takes the vote back). */
CREATE OR REPLACE FUNCTION public.community_sticker_answer(_post_id uuid, _choice int DEFAULT NULL, _value int DEFAULT NULL, _body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  v_me uuid;
  v_s jsonb;
  v_author uuid;
  v_body text := nullif(btrim(coalesce(_body, '')), '');
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.sticker, p.author_user_id INTO v_s, v_author FROM public.community_posts p
   WHERE p.id = _post_id AND p.archived_at IS NULL
     AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF v_s IS NULL THEN RAISE EXCEPTION 'That sticker is gone'; END IF;
  v_me := public.community_main_account(uid);
  IF v_s->>'type' = 'poll' THEN
    IF _choice IS NULL THEN
      DELETE FROM public.community_sticker_answers WHERE post_id = _post_id AND user_id = v_me;
      RETURN public.community_sticker_json(_post_id, uid);
    END IF;
    IF _choice < 0 OR _choice >= jsonb_array_length(v_s->'options') THEN RAISE EXCEPTION 'That answer isn''t on this poll'; END IF;
    INSERT INTO public.community_sticker_answers (post_id, user_id, choice) VALUES (_post_id, v_me, _choice)
    ON CONFLICT (post_id, user_id) DO UPDATE SET choice = EXCLUDED.choice, updated_at = now();
  ELSIF v_s->>'type' = 'slider' THEN
    IF _value IS NULL OR _value < 0 OR _value > 100 THEN RAISE EXCEPTION 'Slide to answer'; END IF;
    INSERT INTO public.community_sticker_answers (post_id, user_id, value) VALUES (_post_id, v_me, _value)
    ON CONFLICT (post_id, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  ELSE
    IF v_author = v_me THEN RAISE EXCEPTION 'That''s your own question'; END IF;
    IF v_body IS NULL OR char_length(v_body) > 300 THEN RAISE EXCEPTION 'Write up to 300 characters'; END IF;
    INSERT INTO public.community_sticker_answers (post_id, user_id, body) VALUES (_post_id, v_me, v_body)
    ON CONFLICT (post_id, user_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now();
  END IF;
  RETURN public.community_sticker_json(_post_id, uid);
END;
$$;
REVOKE ALL ON FUNCTION public.community_sticker_answer(uuid, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_sticker_answer(uuid, int, int, text) TO authenticated;

/** Put a sticker on your own post (NULL takes it off; a different sticker starts its answers over). */
CREATE OR REPLACE FUNCTION public.community_set_sticker(_post_id uuid, _sticker jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  v_old jsonb;
  v_new jsonb := public.community_sticker_clean(_sticker);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.sticker INTO v_old FROM public.community_posts p
   WHERE p.id = _post_id AND p.author_user_id = public.community_main_account(uid) AND p.archived_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the person who posted can add a sticker' USING ERRCODE = '42501'; END IF;
  -- a new question (or a poll with different answers) can't keep the old answers
  IF v_new IS NULL OR v_old IS NULL OR v_old->>'type' IS DISTINCT FROM v_new->>'type' OR v_old->'options' IS DISTINCT FROM v_new->'options' THEN
    DELETE FROM public.community_sticker_answers WHERE post_id = _post_id;
  END IF;
  UPDATE public.community_posts SET sticker = v_new WHERE id = _post_id;
  RETURN public.community_sticker_json(_post_id, uid);
END;
$$;
REVOKE ALL ON FUNCTION public.community_set_sticker(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_set_sticker(uuid, jsonb) TO authenticated;

-- ── Timing ───────────────────────────────────────────────────────────────────
/**
 * The hour the crew is most around: of 11am–8pm (Winnipeg), the start of the
 * 3 hours with the most people opening posts over the last 8 weeks (coaches
 * left out). Until there's enough to go on (150 views), 5pm: the crew mostly
 * opens the app late afternoon to evening.
 */
CREATE OR REPLACE FUNCTION public.community_lesson_learned_time()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH staff AS (
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach')
    UNION SELECT cp.user_id FROM public.community_profiles cp
           WHERE cp.same_person_as IS NOT NULL
              OR cp.user_id IN (SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach'))
    UNION SELECT s.author_user_id FROM public.community_series_settings s WHERE s.author_user_id IS NOT NULL
  ), v AS (
    SELECT pv.viewer_user_id AS who, (pv.viewed_at AT TIME ZONE 'America/Winnipeg') AS l
      FROM public.community_post_views pv
     WHERE pv.viewed_at > now() - interval '56 days'
       AND pv.viewer_user_id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)
  ), score AS (
    SELECT h, count(DISTINCT (v.who, v.l::date)) FILTER (WHERE extract(hour FROM v.l) >= h AND extract(hour FROM v.l) < h + 3) AS s
      FROM generate_series(11, 20) h CROSS JOIN v
     GROUP BY h
  )
  SELECT jsonb_build_object(
    'views', (SELECT count(*) FROM v),
    'learned', (SELECT count(*) FROM v) >= 150,
    'time', CASE WHEN (SELECT count(*) FROM v) >= 150
                 THEN to_char(make_time((SELECT h FROM score ORDER BY s DESC, abs(h - 17), h LIMIT 1), 0, 0), 'HH24:MI')
                 ELSE '17:00' END)
$$;
REVOKE ALL ON FUNCTION public.community_lesson_learned_time() FROM PUBLIC, anon;

/** When a lesson on `_day` goes out: the coach's fixed time, else the learned one. */
CREATE OR REPLACE FUNCTION public.community_lesson_default_at(_day date, _learned jsonb DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (_day + coalesce((SELECT s.lesson_time FROM public.community_series_settings s WHERE s.id),
                          ((coalesce(_learned, public.community_lesson_learned_time()))->>'time')::time))
         AT TIME ZONE 'America/Winnipeg'
$$;
REVOKE ALL ON FUNCTION public.community_lesson_default_at(date, jsonb) FROM PUBLIC, anon;

-- ── Picking ──────────────────────────────────────────────────────────────────
/**
 * The next lesson for a day's track. In order:
 *   - troubleshooting: every calendar month gets a beginner, an advanced and
 *     an elite post; once the Saturdays left can only just cover the missing
 *     levels, only those count (before that they're preferred)
 *   - nothing used in the last 26 weeks (fix) / 12 weeks (others), unless the
 *     library runs out
 *   - a different lift from the last troubleshooting post
 *   - not the same topic tag as a lesson planned within 3 weeks
 *   - topics the crew has said they care about (poll answers with a tag, 90 days)
 *   - least recently used first
 */
CREATE OR REPLACE FUNCTION public.community_lesson_pick(_track text, _day date, _exclude uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
     WHERE extract(isodow FROM d) = 6
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
  -- a month with nothing left at a missing level still gets a lesson
  IF v_id IS NULL AND v_must THEN
    RETURN public.community_lesson_pick_any(_track, _day, _exclude);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_lesson_pick_any(_track text, _day date, _exclude uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT i.id FROM public.community_series_items i
   WHERE i.series = 'lesson' AND i.active AND i.data->>'track' = _track
     AND NOT i.id = ANY (coalesce(_exclude, '{}'))
     AND NOT EXISTS (SELECT 1 FROM public.community_lesson_plan p
                      WHERE p.item_id = i.id AND p.day <> _day AND p.status IN ('planned', 'approved'))
   ORDER BY i.last_used_at ASC NULLS FIRST, i.sort_order, i.created_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.community_lesson_pick(text, date, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_lesson_pick_any(text, date, uuid[]) FROM PUBLIC, anon, authenticated;

/**
 * Fill the plan for the next `_days` days (one lesson per lesson day; a day
 * the coach cleared keeps its row, so nothing comes back on its own), and
 * move lessons whose time nobody set to the current best hour.
 */
CREATE OR REPLACE FUNCTION public.community_lessons_plan(_days int DEFAULT 14)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Winnipeg')::date;
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
  -- a day that was planned before there was anything to pick gets its lesson now
  FOR r IN SELECT p.id, p.track, p.day FROM public.community_lesson_plan p
            WHERE p.status = 'planned' AND p.item_id IS NULL AND p.day >= v_today ORDER BY p.day LOOP
    UPDATE public.community_lesson_plan SET item_id = public.community_lesson_pick(r.track, r.day), updated_at = now() WHERE id = r.id;
  END LOOP;
  -- the best hour moves as the crew's habits do (never onto a time that's passed)
  UPDATE public.community_lesson_plan p
     SET post_at = public.community_lesson_default_at(p.day, v_learned), updated_at = now()
   WHERE p.status IN ('planned', 'approved') AND NOT p.time_set AND p.day > v_today
     AND p.post_at IS DISTINCT FROM public.community_lesson_default_at(p.day, v_learned);
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_lessons_plan(int) FROM PUBLIC, anon, authenticated;

-- ── Crew data (Tuesday) ──────────────────────────────────────────────────────
-- Comparing groups only when each side has 5+ people: fewer and the "other"
-- group is a handful of people everyone can name.
CREATE OR REPLACE FUNCTION public.community_crew_compare(_rows jsonb, _habit text, _min numeric, _ratio boolean, _outcome text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_a int; v_b int; v_x numeric; v_y numeric;
BEGIN
  WITH t AS (
    SELECT (CASE WHEN _ratio THEN coalesce((r->>_habit)::numeric, 0) / greatest((r->>'sessions')::numeric, 1)
                 ELSE coalesce((r->>_habit)::numeric, 0) END) >= _min AS yes,
           CASE _outcome WHEN 'spw' THEN (r->>'sessions')::numeric / 8 ELSE coalesce((r->>_outcome)::numeric, 0) END AS v
      FROM jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) r)
  SELECT count(*) FILTER (WHERE yes), count(*) FILTER (WHERE NOT yes), avg(v) FILTER (WHERE yes), avg(v) FILTER (WHERE NOT yes)
    INTO v_a, v_b, v_x, v_y FROM t;
  IF v_a < 5 OR v_b < 5 OR v_x IS NULL OR v_y IS NULL THEN RETURN NULL; END IF;
  IF v_x < v_y * 1.25 OR v_x - v_y < (CASE _outcome WHEN 'prs' THEN 2 ELSE 0.5 END) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('habit', _habit, 'outcome', _outcome, 'a', v_a, 'b', v_b,
                            'x', round(v_x, CASE _outcome WHEN 'prs' THEN 0 ELSE 1 END),
                            'y', round(v_y, CASE _outcome WHEN 'prs' THEN 0 ELSE 1 END));
END;
$$;

/**
 * One observation from the crew's own training, or NULL: at most one every 4
 * weeks, each kind at most once every 8, 5+ people on each side, and worded
 * as what it is (a pattern, not proof).
 */
CREATE OR REPLACE FUNCTION public.community_compose_observation(_exclude_user uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rows jsonb;
  v_recent text[];
  v_best jsonb;
  v_c jsonb;
  v_lo record;
  v_caption text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.community_posts p
              WHERE p.series = 'tuesday_tips' AND p.series_data ? 'observation' AND p.created_at > now() - interval '27 days') THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(p.series_data->>'observation') INTO v_recent FROM public.community_posts p
   WHERE p.series = 'tuesday_tips' AND p.series_data ? 'observation' AND p.created_at > now() - interval '56 days';
  v_recent := coalesce(v_recent, '{}');
  v_rows := public.community_crew_outcomes(_exclude_user);

  IF NOT 'frequency' = ANY (v_recent) THEN
    v_c := public.community_crew_compare(v_rows, 'sessions', 24, false, 'prs');
    IF v_c IS NOT NULL THEN v_best := v_c || jsonb_build_object('observation', 'frequency'); END IF;
  END IF;
  IF NOT 'consistency' = ANY (v_recent) THEN
    v_c := public.community_crew_compare(v_rows, 'weeks', 7, false, 'prs');
    IF v_c IS NOT NULL AND (v_best IS NULL OR (v_c->>'x')::numeric / greatest((v_c->>'y')::numeric, 0.5)
                                              > (v_best->>'x')::numeric / greatest((v_best->>'y')::numeric, 0.5)) THEN
      v_best := v_c || jsonb_build_object('observation', 'consistency');
    END IF;
  END IF;
  IF v_best IS NULL AND NOT 'sleep' = ANY (v_recent) THEN
    SELECT count(*) FILTER (WHERE fb.sleep_bucket = 'lt5') AS n_lo,
           count(DISTINCT fb.client_id) FILTER (WHERE fb.sleep_bucket = 'lt5') AS p_lo,
           count(DISTINCT fb.client_id) FILTER (WHERE fb.sleep_bucket <> 'lt5') AS p_hi,
           count(*) FILTER (WHERE fb.sleep_bucket <> 'lt5') AS n_hi,
           avg(fb.overall_rating) FILTER (WHERE fb.sleep_bucket = 'lt5') AS r_lo,
           avg(fb.overall_rating) FILTER (WHERE fb.sleep_bucket <> 'lt5') AS r_hi
      INTO v_lo
      FROM public.pl_workout_feedback fb
      JOIN public.clients cl ON cl.id = fb.client_id
     WHERE cl.user_id IS DISTINCT FROM _exclude_user
       AND fb.created_at > now() - interval '120 days' AND fb.sleep_bucket IS NOT NULL AND fb.overall_rating IS NOT NULL;
    IF v_lo.n_lo >= 15 AND v_lo.p_lo >= 5 AND v_lo.p_hi >= 5 AND v_lo.n_hi >= 40 AND v_lo.r_hi - v_lo.r_lo >= 0.3 THEN
      v_best := jsonb_build_object('observation', 'sleep', 'habit', 'sleep', 'outcome', 'rating', 'a', v_lo.n_lo, 'b', v_lo.n_hi,
                                   'x', round(v_lo.r_lo, 1), 'y', round(v_lo.r_hi, 1), 'people', v_lo.p_lo);
    END IF;
  END IF;
  IF v_best IS NULL THEN RETURN NULL; END IF;

  v_caption := CASE v_best->>'observation'
    WHEN 'frequency' THEN
      'looked through the last 8 weeks of training in the app 📊' || E'\n\n'
      || 'the ' || (v_best->>'a') || ' of you averaging 3+ sessions a week hit ' || (v_best->>'x') || ' PRs on average. the other ' || (v_best->>'b') || ': ' || (v_best->>'y') || E'\n\n'
      || 'thats a pattern not proof. how long youve been lifting & whats going on in life play into it too. but more good practice at the lifts is usually how you get better at them'
    WHEN 'consistency' THEN
      'something from the app data 📊' || E'\n\n'
      || 'the ' || (v_best->>'a') || ' of you who trained in 7 or 8 of the last 8 weeks hit ' || (v_best->>'x') || ' PRs on average. the ' || (v_best->>'b') || ' who missed 2+ weeks: ' || (v_best->>'y') || E'\n\n'
      || 'doesnt prove missing weeks costs PRs, a lot goes into it. but boring consistency keeps showing up next to the PRs'
    ELSE
      'noticed this in your workout reviews 📊' || E'\n\n'
      || 'sessions after under 5 hours of sleep got rated ' || (v_best->>'x') || '/5 on average (' || (v_best->>'a') || ' sessions from ' || (v_best->>'people') || ' of you). everything else: ' || (v_best->>'y') || '/5' || E'\n\n'
      || 'just a pattern, not proof. but if the night before was rough, keep the top set honest and dont go chasing a PR that day' END;
  RETURN v_best || jsonb_build_object('caption', v_caption);
END;
$$;

-- ── Posting ──────────────────────────────────────────────────────────────────
/**
 * Post one planned lesson (or, on a Tuesday, the crew's data when it holds
 * up). Idempotent: the day's key is claimed first and a second call finds it.
 * Raises on a real problem so the caller can record it.
 */
CREATE OR REPLACE FUNCTION public.community_lesson_post(_id uuid, _data_ok boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.community_lesson_plan%ROWTYPE;
  v_item public.community_series_items%ROWTYPE;
  v_settings record;
  v_author uuid;
  v_key text;
  v_obs jsonb;
  v_obs_key text;
  v_id uuid;
  v_sticker jsonb;
  v_media jsonb;
BEGIN
  SELECT * INTO r FROM public.community_lesson_plan WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That lesson isn''t in the plan'; END IF;
  IF r.status = 'posted' THEN RETURN jsonb_build_object('status', 'exists', 'post_id', r.post_id); END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RAISE EXCEPTION 'No posting account is set for coach posts'; END IF;
  v_key := 'lesson:' || to_char(r.day, 'YYYY-MM-DD');

  -- Tuesday: the crew's own numbers go out instead when they hold up
  IF coalesce(_data_ok, true) AND extract(isodow FROM r.day) = 2 THEN
    v_obs := public.community_compose_observation(v_author);
    IF v_obs IS NOT NULL THEN
      v_obs_key := 'tuesday_tips:' || to_char(r.day, 'IYYY-"W"IW');
      INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, 'lesson') ON CONFLICT (series_key) DO NOTHING;
      IF NOT FOUND THEN RAISE EXCEPTION 'Already posted today (lesson key taken)'; END IF;
      INSERT INTO public.community_series_runs (series_key, series) VALUES (v_obs_key, 'tuesday_tips') ON CONFLICT (series_key) DO NOTHING;
      INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data)
      VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
              v_obs->>'caption', 'tuesday_tips', v_obs_key, v_obs - 'caption')
      ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN RAISE EXCEPTION 'This week''s data post is already up'; END IF;
      UPDATE public.community_series_runs SET post_id = v_id WHERE series_key IN (v_key, v_obs_key);
      UPDATE public.community_lesson_plan
         SET status = 'posted', posted_as = 'data', post_id = v_id, posted_at = now(), error = NULL, updated_at = now()
       WHERE id = r.id;
      RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'as', 'data');
    END IF;
  END IF;

  SELECT * INTO v_item FROM public.community_series_items WHERE id = r.item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No lesson picked for this day'; END IF;
  v_sticker := CASE WHEN r.sticker_set THEN r.sticker ELSE public.community_sticker_try(v_item.data->'story') END;
  v_media := CASE WHEN jsonb_array_length(r.media) > 0 THEN r.media ELSE coalesce(v_item.media, '[]'::jsonb) END;

  INSERT INTO public.community_series_runs (series_key, series, item_id) VALUES (v_key, 'lesson', v_item.id) ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN
    -- posted already (another run got there): link it and stop
    SELECT p.id INTO v_id FROM public.community_posts p WHERE p.series_key = v_key;
    UPDATE public.community_lesson_plan SET status = 'posted', posted_as = 'lesson', post_id = v_id, posted_at = coalesce(posted_at, now()), updated_at = now()
     WHERE id = r.id;
    RETURN jsonb_build_object('status', 'exists', 'post_id', v_id);
  END IF;
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_item_id, series_data, sticker)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
          coalesce(r.body, v_item.body), 'lesson', v_key, v_item.id,
          jsonb_strip_nulls(jsonb_build_object(
            'key', v_item.data->>'key', 'track', v_item.data->>'track', 'title', v_item.data->>'title',
            'level', v_item.data->>'level', 'lift', v_item.data->>'lift', 'tags', v_item.data->'tags',
            'visual', v_item.data->'visual', 'refs', v_item.data->'refs')),
          v_sticker)
  ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Already posted today'; END IF;
  IF jsonb_array_length(v_media) > 0 THEN PERFORM public.community_apply_media(v_id, v_media); END IF;
  UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
  UPDATE public.community_series_items SET last_used_at = now(), use_count = use_count + 1, media = '[]'::jsonb, updated_at = now() WHERE id = v_item.id;
  UPDATE public.community_lesson_plan
     SET status = 'posted', posted_as = 'lesson', post_id = v_id, posted_at = now(), error = NULL, updated_at = now()
   WHERE id = r.id;
  RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'as', 'lesson');
END;
$$;
REVOKE ALL ON FUNCTION public.community_lesson_post(uuid, boolean) FROM PUBLIC, anon, authenticated;

/**
 * Every 15 minutes: keep two weeks planned, post what's due (approved, or
 * anything planned when the coach let lessons run on their own), and let a
 * lesson whose moment passed by 6 hours go (it's not used up; it comes back
 * in the rotation). A failure is recorded and retried; after 3 tries it's
 * flagged for the coach.
 */
CREATE OR REPLACE FUNCTION public.community_publish_lessons(_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_settings record;
  r record;
  v_posted int := 0;
  v_failed int := 0;
  v_missed int := 0;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.is_community_staff() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  PERFORM public.community_lessons_plan(14);
  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;

  FOR r IN SELECT p.id FROM public.community_lesson_plan p
            WHERE p.status IN ('planned', 'approved') AND p.post_at <= _now AND p.post_at > _now - interval '6 hours'
              AND (p.status = 'approved' OR v_settings.lesson_mode = 'auto')
              AND (p.item_id IS NOT NULL OR extract(isodow FROM p.day) = 2)
            ORDER BY p.post_at
            FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      PERFORM public.community_lesson_post(r.id);
      v_posted := v_posted + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.community_lesson_plan
         SET attempts = attempts + 1, error = left(SQLERRM, 300),
             status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE status END, updated_at = now()
       WHERE id = r.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  UPDATE public.community_lesson_plan
     SET status = 'missed', updated_at = now()
   WHERE status IN ('planned', 'approved') AND post_at <= _now - interval '6 hours';
  GET DIAGNOSTICS v_missed = ROW_COUNT;
  RETURN jsonb_build_object('status', 'ok', 'posted', v_posted, 'failed', v_failed, 'missed', v_missed);
END;
$$;
REVOKE ALL ON FUNCTION public.community_publish_lessons(timestamptz) FROM PUBLIC, anon;

-- ── Coach controls ───────────────────────────────────────────────────────────
/**
 * One change to a planned lesson:
 *   approve / unapprove   (with any edit in the same call)
 *   save                  wording (NULL or the library's own = the library's), photos, sticker
 *   swap                  another lesson from the library (`_item_id`, or the next pick)
 *   reschedule            `_post_at`: a later time, or another day (trading places with
 *                         that day's lesson; the day it leaves stays cleared)
 *   skip / restore
 *   post_now              straight to the Crew, whatever the mode
 */
CREATE OR REPLACE FUNCTION public.community_lesson_act(
  _id uuid, _action text, _body text DEFAULT NULL, _post_at timestamptz DEFAULT NULL,
  _item_id uuid DEFAULT NULL, _media jsonb DEFAULT NULL, _sticker jsonb DEFAULT NULL, _sticker_set boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  tz constant text := 'America/Winnipeg';
  r public.community_lesson_plan%ROWTYPE;
  o public.community_lesson_plan%ROWTYPE;
  v_lib text;
  v_body text;
  v_day date;
  v_new uuid;
  v_res jsonb;
BEGIN
  IF uid IS NULL OR NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.community_lesson_plan WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That lesson isn''t in the plan'; END IF;
  IF r.status = 'posted' THEN RAISE EXCEPTION 'That one''s already posted. Edit it on the post itself'; END IF;

  -- edits ride along with any action
  IF _action IN ('save', 'approve') THEN
    IF _body IS NOT NULL THEN
      SELECT i.body INTO v_lib FROM public.community_series_items i WHERE i.id = r.item_id;
      v_body := btrim(_body);
      IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
      UPDATE public.community_lesson_plan SET body = CASE WHEN v_body = btrim(coalesce(v_lib, '')) THEN NULL ELSE v_body END WHERE id = r.id;
    END IF;
    IF _media IS NOT NULL THEN
      UPDATE public.community_lesson_plan SET media = public.community_clean_media(_media, uid, r.media) WHERE id = r.id;
    END IF;
    IF _sticker_set IS NOT NULL THEN
      UPDATE public.community_lesson_plan
         SET sticker_set = _sticker_set, sticker = CASE WHEN _sticker_set THEN public.community_sticker_clean(_sticker) END
       WHERE id = r.id;
    END IF;
  END IF;

  IF _action = 'save' THEN
    NULL;
  ELSIF _action = 'approve' THEN
    IF r.status NOT IN ('planned', 'approved') THEN RAISE EXCEPTION 'Pick a new time for it first'; END IF;
    IF r.item_id IS NULL THEN RAISE EXCEPTION 'Pick a lesson for this day first'; END IF;
    UPDATE public.community_lesson_plan SET status = 'approved', approved_by = uid, approved_at = now() WHERE id = r.id;
  ELSIF _action = 'unapprove' THEN
    UPDATE public.community_lesson_plan SET status = 'planned', approved_by = NULL, approved_at = NULL WHERE id = r.id AND status = 'approved';
  ELSIF _action = 'swap' THEN
    v_new := coalesce(_item_id, public.community_lesson_pick(r.track, r.day, ARRAY[r.item_id]), public.community_lesson_pick_any(r.track, r.day, ARRAY[r.item_id]));
    IF v_new IS NULL THEN RAISE EXCEPTION 'Nothing else in the library for this day'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.community_series_items i WHERE i.id = v_new AND i.series = 'lesson') THEN RAISE EXCEPTION 'That isn''t a lesson'; END IF;
    IF EXISTS (SELECT 1 FROM public.community_lesson_plan p WHERE p.item_id = v_new AND p.id <> r.id AND p.status IN ('planned', 'approved')) THEN
      RAISE EXCEPTION 'That lesson is already planned for another day';
    END IF;
    -- a new lesson needs a new look before it goes out
    UPDATE public.community_lesson_plan
       SET item_id = v_new, body = NULL, sticker = NULL, sticker_set = false,
           status = CASE WHEN status = 'approved' THEN 'planned' ELSE status END, approved_by = NULL, approved_at = NULL
     WHERE id = r.id;
  ELSIF _action = 'reschedule' THEN
    IF _post_at IS NULL OR _post_at < now() + interval '2 minutes' THEN RAISE EXCEPTION 'Pick a time that hasn''t passed'; END IF;
    v_day := (_post_at AT TIME ZONE tz)::date;
    IF v_day > (now() AT TIME ZONE tz)::date + 60 THEN RAISE EXCEPTION 'Pick a day in the next 2 months'; END IF;
    IF v_day <> r.day THEN
      SELECT * INTO o FROM public.community_lesson_plan WHERE day = v_day FOR UPDATE;
      IF FOUND AND o.status = 'posted' THEN RAISE EXCEPTION 'There''s already a lesson posted that day'; END IF;
      IF FOUND THEN
        -- trade places: the other lesson takes this one's day at its own time of day
        UPDATE public.community_lesson_plan SET day = DATE '1900-01-01' WHERE id = o.id;
        UPDATE public.community_lesson_plan SET day = v_day, post_at = _post_at, time_set = true,
               status = CASE WHEN status IN ('missed', 'failed') THEN 'planned' ELSE status END, attempts = 0, error = NULL
         WHERE id = r.id;
        UPDATE public.community_lesson_plan
           SET day = r.day,
               post_at = greatest((r.day + (o.post_at AT TIME ZONE tz)::time) AT TIME ZONE tz, now() + interval '30 minutes'),
               status = CASE WHEN status IN ('missed', 'failed') THEN 'planned' ELSE status END
         WHERE id = o.id;
      ELSE
        UPDATE public.community_lesson_plan SET day = v_day, post_at = _post_at, time_set = true,
               status = CASE WHEN status IN ('missed', 'failed') THEN 'planned' ELSE status END, attempts = 0, error = NULL
         WHERE id = r.id;
        -- the day it left stays cleared (nothing gets planned there behind the coach's back)
        INSERT INTO public.community_lesson_plan (day, track, item_id, post_at, status)
        VALUES (r.day, r.track, NULL, r.post_at, 'skipped')
        ON CONFLICT (day) DO NOTHING;
      END IF;
    ELSE
      UPDATE public.community_lesson_plan SET post_at = _post_at, time_set = true,
             status = CASE WHEN status IN ('missed', 'failed') THEN 'planned' ELSE status END, attempts = 0, error = NULL
       WHERE id = r.id;
    END IF;
  ELSIF _action = 'skip' THEN
    UPDATE public.community_lesson_plan SET status = 'skipped', approved_by = NULL, approved_at = NULL WHERE id = r.id;
  ELSIF _action = 'restore' THEN
    IF r.post_at < now() + interval '2 minutes' THEN RAISE EXCEPTION 'Pick a new time for it'; END IF;
    UPDATE public.community_lesson_plan
       SET status = 'planned', attempts = 0, error = NULL,
           item_id = coalesce(item_id, public.community_lesson_pick(r.track, r.day))
     WHERE id = r.id;
  ELSIF _action = 'post_now' THEN
    IF r.item_id IS NULL THEN RAISE EXCEPTION 'Pick a lesson for this day first'; END IF;
    IF r.day <> (now() AT TIME ZONE tz)::date THEN
      -- posting another day's lesson today: it takes today's spot, and its own day stays cleared
      SELECT * INTO o FROM public.community_lesson_plan WHERE day = (now() AT TIME ZONE tz)::date FOR UPDATE;
      IF FOUND AND o.status = 'posted' THEN RAISE EXCEPTION 'Today''s lesson is already up'; END IF;
      IF FOUND THEN
        UPDATE public.community_lesson_plan SET day = DATE '1900-01-01' WHERE id = o.id;
        UPDATE public.community_lesson_plan SET day = (now() AT TIME ZONE tz)::date WHERE id = r.id;
        UPDATE public.community_lesson_plan SET day = r.day,
               post_at = greatest((r.day + (o.post_at AT TIME ZONE tz)::time) AT TIME ZONE tz, now() + interval '30 minutes')
         WHERE id = o.id;
      ELSE
        UPDATE public.community_lesson_plan SET day = (now() AT TIME ZONE tz)::date WHERE id = r.id;
        INSERT INTO public.community_lesson_plan (day, track, item_id, post_at, status)
        VALUES (r.day, r.track, NULL, r.post_at, 'skipped') ON CONFLICT (day) DO NOTHING;
      END IF;
    END IF;
    UPDATE public.community_lesson_plan SET post_at = now(), approved_by = coalesce(approved_by, uid), approved_at = coalesce(approved_at, now()) WHERE id = r.id;
    v_res := public.community_lesson_post(r.id, false);
    RETURN v_res;
  ELSE
    RAISE EXCEPTION 'Unknown action';
  END IF;
  UPDATE public.community_lesson_plan SET updated_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('status', 'ok');
END;
$$;
REVOKE ALL ON FUNCTION public.community_lesson_act(uuid, text, text, timestamptz, uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_lesson_act(uuid, text, text, timestamptz, uuid, jsonb, jsonb, boolean) TO authenticated;

/** Review mode or let lessons post on their own; a fixed time or the learned one (NULL). */
CREATE OR REPLACE FUNCTION public.community_lessons_settings(_mode text DEFAULT NULL, _time text DEFAULT NULL, _clear_time boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _mode IS NOT NULL AND _mode NOT IN ('review', 'auto') THEN RAISE EXCEPTION 'Unknown mode'; END IF;
  UPDATE public.community_series_settings
     SET lesson_mode = coalesce(_mode, lesson_mode),
         lesson_time = CASE WHEN coalesce(_clear_time, false) THEN NULL WHEN _time IS NOT NULL THEN _time::time ELSE lesson_time END,
         updated_at = now()
   WHERE id;
  -- planned lessons follow a new time (unless the coach set theirs by hand)
  IF _time IS NOT NULL OR coalesce(_clear_time, false) THEN
    UPDATE public.community_lesson_plan p
       SET post_at = public.community_lesson_default_at(p.day), updated_at = now()
     WHERE p.status IN ('planned', 'approved') AND NOT p.time_set
       AND public.community_lesson_default_at(p.day) > now() + interval '2 minutes';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_lessons_settings(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_lessons_settings(text, text, boolean) TO authenticated;

/** A library entry as the coach's screens use it. */
CREATE OR REPLACE FUNCTION public.community_lesson_item_json(_i public.community_series_items)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'id', _i.id, 'body', _i.body, 'active', _i.active, 'use_count', _i.use_count, 'last_used_at', _i.last_used_at,
    'key', _i.data->>'key', 'track', _i.data->>'track', 'title', _i.data->>'title', 'level', _i.data->>'level',
    'lift', _i.data->>'lift', 'tags', coalesce(_i.data->'tags', '[]'::jsonb), 'visual', _i.data->'visual',
    'refs', coalesce(_i.data->'refs', '[]'::jsonb), 'story', _i.data->'story', 'media', _i.media)
$$;
REVOKE ALL ON FUNCTION public.community_lesson_item_json(public.community_series_items) FROM PUBLIC, anon;

/**
 * Everything the coach's lesson screen shows, after topping up the plan: the
 * mode, the posting time (and how it was picked), two weeks of lessons, this
 * month's levels, the library, and how lessons have done with the crew.
 */
CREATE OR REPLACE FUNCTION public.community_lessons_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_today date := (now() AT TIME ZONE tz)::date;
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
    -- troubleshooting levels this month and next (planned or posted)
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
        FROM unnest(ARRAY['strength', 'hypertrophy', 'methods', 'mind', 'fix']) t),
    'observation', CASE WHEN EXISTS (SELECT 1 FROM public.community_lesson_plan p
                                      WHERE p.track = 'hypertrophy' AND p.status IN ('planned', 'approved') AND p.day BETWEEN v_today AND v_today + 13)
                        THEN public.community_compose_observation(public.community_main_account(v_settings.author_user_id)) END,
    'stats', public.community_lessons_stats());
END;
$$;
REVOKE ALL ON FUNCTION public.community_lessons_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_lessons_overview() TO authenticated;

/**
 * How lessons land with the crew (coaches not counted), last 12 weeks: per
 * track, per post, which hours people open the app, and what the crew's
 * story answers say they want more of. Small numbers say so (`posts`).
 */
CREATE OR REPLACE FUNCTION public.community_lessons_stats()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH staff AS (
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'coach')
    UNION SELECT cp.user_id FROM public.community_profiles cp WHERE cp.same_person_as IS NOT NULL
    UNION SELECT s.author_user_id FROM public.community_series_settings s WHERE s.author_user_id IS NOT NULL
  ), posts AS (
    SELECT p.id, p.created_at, p.series, p.series_data, p.sticker,
           coalesce(p.series_data->>'track', CASE WHEN p.series = 'tuesday_tips' AND p.series_data ? 'observation' THEN 'data' END) AS track,
           (SELECT count(*) FROM public.community_post_views v WHERE v.post_id = p.id AND v.viewer_user_id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)) AS views,
           (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = p.id AND r.user_id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)) AS reactions,
           (SELECT count(*) FROM public.community_comments c WHERE c.post_id = p.id AND c.hidden_at IS NULL AND c.author_user_id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)) AS comments,
           (SELECT count(*) FROM public.community_sticker_answers a WHERE a.post_id = p.id AND a.user_id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)) AS answers
      FROM public.community_posts p
     WHERE p.archived_at IS NULL AND p.created_at > now() - interval '12 weeks'
       AND (p.series = 'lesson' OR (p.series = 'tuesday_tips' AND p.series_data ? 'observation'))
  )
  SELECT jsonb_build_object(
    'posts', (SELECT count(*) FROM posts),
    'by_track', coalesce((SELECT jsonb_agg(jsonb_build_object('track', track, 'posts', n, 'views', v, 'reactions', re, 'comments', co, 'answers', an) ORDER BY track)
                            FROM (SELECT track, count(*) n, round(avg(views), 1) v, sum(reactions) re, sum(comments) co, sum(answers) an FROM posts GROUP BY track) x), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('post_id', id, 'created_at', created_at, 'track', track, 'title', series_data->>'title',
                                                            'level', series_data->>'level', 'lift', series_data->>'lift',
                                                            'views', views, 'reactions', reactions, 'comments', comments, 'answers', answers,
                                                            'sticker', sticker->>'type') ORDER BY created_at DESC)
                          FROM (SELECT * FROM posts ORDER BY created_at DESC LIMIT 20) z), '[]'::jsonb),
    'interest', coalesce((
      SELECT jsonb_agg(jsonb_build_object('tag', tag, 'answers', n) ORDER BY n DESC)
        FROM (SELECT o.o->>'tag' AS tag, count(*) AS n
                FROM public.community_sticker_answers a
                JOIN public.community_posts p ON p.id = a.post_id AND p.series = 'lesson'
                CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.sticker->'options', '[]'::jsonb)) WITH ORDINALITY o(o, i)
               WHERE a.choice = o.i - 1 AND o.o->>'tag' IS NOT NULL AND a.created_at > now() - interval '90 days'
               GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.community_lessons_stats() FROM PUBLIC, anon;

/** The whole library, for browsing and swapping. */
CREATE OR REPLACE FUNCTION public.community_lesson_library()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_lesson_item_json(i)
                     || jsonb_build_object('planned', (SELECT p.day FROM public.community_lesson_plan p
                                                        WHERE p.item_id = i.id AND p.status IN ('planned', 'approved') ORDER BY p.day LIMIT 1))
                     ORDER BY i.data->>'track', CASE i.data->>'level' WHEN 'beginner' THEN 1 WHEN 'advanced' THEN 2 WHEN 'elite' THEN 3 ELSE 4 END,
                              i.data->>'lift', i.sort_order, i.created_at)
      FROM public.community_series_items i WHERE i.series = 'lesson'), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_lesson_library() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_lesson_library() TO authenticated;

/**
 * Add or change a library lesson (`_id` NULL adds one). The wording is the
 * coach's; what's checked is the shape (track, level, lift, tags, sticker).
 */
CREATE OR REPLACE FUNCTION public.community_lesson_item_save(_id uuid, _body text, _data jsonb, _active boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_body text := btrim(coalesce(_body, ''));
  v_old public.community_series_items%ROWTYPE;
  v_d jsonb := coalesce(_data, '{}'::jsonb);
  v_track text := v_d->>'track';
  v_title text := btrim(coalesce(v_d->>'title', ''));
  v_level text := nullif(v_d->>'level', '');
  v_lift text := nullif(v_d->>'lift', '');
  v_key text;
  v_tags jsonb;
  v_out public.community_series_items%ROWTYPE;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Write 1–1200 characters'; END IF;
  IF _id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.community_series_items WHERE id = _id AND series = 'lesson';
    IF NOT FOUND THEN RAISE EXCEPTION 'That lesson is gone'; END IF;
    v_d := v_old.data || v_d;
    v_track := v_d->>'track'; v_title := btrim(coalesce(v_d->>'title', '')); v_level := nullif(v_d->>'level', ''); v_lift := nullif(v_d->>'lift', '');
  END IF;
  IF v_track IS NULL OR v_track NOT IN ('strength', 'hypertrophy', 'methods', 'mind', 'fix') THEN RAISE EXCEPTION 'Pick a day for it'; END IF;
  IF char_length(v_title) < 1 OR char_length(v_title) > 60 THEN RAISE EXCEPTION 'Give it a short title (up to 60 characters)'; END IF;
  IF v_level IS NOT NULL AND v_level NOT IN ('beginner', 'advanced', 'elite') THEN RAISE EXCEPTION 'Unknown level'; END IF;
  IF v_track = 'fix' AND v_level IS NULL THEN RAISE EXCEPTION 'Troubleshooting posts need a level'; END IF;
  IF v_lift IS NOT NULL AND v_lift NOT IN ('squat', 'bench', 'deadlift') THEN RAISE EXCEPTION 'Unknown lift'; END IF;
  SELECT coalesce(jsonb_agg(DISTINCT lower(t)), '[]'::jsonb) INTO v_tags
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_d->'tags') = 'array' THEN v_d->'tags' ELSE '[]'::jsonb END) t
   WHERE lower(t) ~ '^[a-z0-9-]{1,32}$';
  v_key := coalesce(nullif(v_d->>'key', ''), left(trim(BOTH '-' FROM regexp_replace(lower(v_title), '[^a-z0-9]+', '-', 'g')), 40) || '-' || substr(md5(random()::text), 1, 4));
  v_d := jsonb_strip_nulls(jsonb_build_object(
    'key', v_key, 'track', v_track, 'title', v_title, 'level', v_level, 'lift', v_lift, 'tags', v_tags,
    'visual', CASE WHEN jsonb_typeof(v_d->'visual') = 'object' THEN v_d->'visual' END,
    'refs', CASE WHEN jsonb_typeof(v_d->'refs') = 'array' THEN v_d->'refs' ELSE '[]'::jsonb END,
    'story', public.community_sticker_clean(v_d->'story')));
  IF _id IS NULL THEN
    INSERT INTO public.community_series_items (series, mentor, body, data, active, sort_order)
    VALUES ('lesson', v_track, v_body, v_d, coalesce(_active, true), 1000)
    RETURNING * INTO v_out;
  ELSE
    UPDATE public.community_series_items
       SET body = v_body, data = v_d, mentor = v_track, active = coalesce(_active, active), updated_at = now()
     WHERE id = _id
    RETURNING * INTO v_out;
  END IF;
  RETURN public.community_lesson_item_json(v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.community_lesson_item_save(uuid, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_lesson_item_save(uuid, text, jsonb, boolean) TO authenticated;

/** What the coach still has to look at (the hourly reminder and the dashboard). */
CREATE OR REPLACE FUNCTION public.community_lessons_waiting(_hours int DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'day', p.day, 'post_at', p.post_at, 'track', p.track,
                                               'title', i.data->>'title', 'reminded_at', p.reminded_at) ORDER BY p.post_at), '[]'::jsonb)
    FROM public.community_lesson_plan p
    LEFT JOIN public.community_series_items i ON i.id = p.item_id
    JOIN public.community_series_settings s ON s.id
   WHERE s.lesson_mode = 'review' AND NOT coalesce(s.paused, false)
     AND p.status = 'planned' AND p.item_id IS NOT NULL
     AND p.post_at > now() AND p.post_at <= now() + make_interval(hours => greatest(1, least(coalesce(_hours, 30), 24 * 14)))
$$;
REVOKE ALL ON FUNCTION public.community_lessons_waiting(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_lessons_waiting(int) TO service_role;

/** The next coach post going out: the next lesson, or Wednesday Wins / Sunday Recap if sooner. */
CREATE OR REPLACE FUNCTION public.community_next_post()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_local timestamp := now() AT TIME ZONE tz;
  v_lesson jsonb;
  v_fixed jsonb;
  v_day date;
  v_series text;
  v_time time;
  v_mode text;
BEGIN
  SELECT s.lesson_mode INTO v_mode FROM public.community_series_settings s WHERE s.id;
  SELECT jsonb_build_object('series', 'lesson', 'at', p.post_at, 'title', i.data->>'title', 'track', p.track,
                            'needs_ok', v_mode = 'review' AND p.status = 'planned')
    INTO v_lesson
    FROM public.community_lesson_plan p LEFT JOIN public.community_series_items i ON i.id = p.item_id
   WHERE p.status IN ('planned', 'approved') AND p.item_id IS NOT NULL AND p.post_at > now()
   ORDER BY p.post_at LIMIT 1;
  FOR i IN 0..7 LOOP
    v_day := v_local::date + i;
    v_series := CASE extract(isodow FROM v_day)::int WHEN 3 THEN 'wednesday_wins' WHEN 7 THEN 'sunday_recap' END;
    CONTINUE WHEN v_series IS NULL;
    v_time := CASE v_series WHEN 'wednesday_wins' THEN time '12:00' ELSE time '19:00' END;
    CONTINUE WHEN i = 0 AND v_local::time >= CASE WHEN v_time >= time '19:00' THEN time '23:59:59' ELSE v_time + interval '5 hours' END;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_series || ':' || to_char(v_day, 'IYYY-"W"IW'));
    v_fixed := jsonb_build_object('series', v_series, 'at', (v_day + v_time) AT TIME ZONE tz);
    EXIT;
  END LOOP;
  IF v_lesson IS NULL THEN RETURN v_fixed; END IF;
  IF v_fixed IS NULL OR (v_lesson->>'at')::timestamptz <= (v_fixed->>'at')::timestamptz THEN RETURN v_lesson; END IF;
  RETURN v_fixed;
END;
$$;
REVOKE ALL ON FUNCTION public.community_next_post() FROM PUBLIC, anon;

-- ── Existing functions, patched in place ─────────────────────────────────────
DO $patch$
DECLARE
  v_def text;
BEGIN
  -- Posts carry their sticker; a lesson's card data rides in series_extra.
  v_def := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
  IF position('''sticker''' IN v_def) = 0 THEN
    IF position('''series_extra'', CASE WHEN n.series IN (''tuesday_tips'', ''try_it_thursday'', ''saturday_spirit'', ''holiday'')' IN v_def) = 0
       OR position('''edited_at'', n.edited_at,' IN v_def) = 0 THEN
      RAISE EXCEPTION 'community_post_json changed shape; patch by hand';
    END IF;
    v_def := replace(v_def, '''series_extra'', CASE WHEN n.series IN (''tuesday_tips'', ''try_it_thursday'', ''saturday_spirit'', ''holiday'')',
                            '''series_extra'', CASE WHEN n.series IN (''tuesday_tips'', ''try_it_thursday'', ''saturday_spirit'', ''holiday'', ''lesson'')');
    v_def := replace(v_def, '''edited_at'', n.edited_at,',
                            '''sticker'', CASE WHEN n.sticker IS NOT NULL THEN public.community_sticker_json(n.id, _viewer) END,' || E'\n    ' || '''edited_at'', n.edited_at,');
    EXECUTE v_def;
  END IF;

  -- The daily series job only does Wednesday Wins and Sunday Recap now; lessons have their own.
  v_def := pg_get_functiondef('public.community_publish_series(text, boolean, timestamptz)'::regprocedure);
  IF position('lesson_day' IN v_def) = 0 THEN
    IF position('IF NOT v_series = ANY (c_days) THEN RAISE EXCEPTION ''Unknown series''; END IF;' IN v_def) = 0 THEN
      RAISE EXCEPTION 'community_publish_series changed shape; patch by hand';
    END IF;
    v_def := replace(v_def, 'IF NOT v_series = ANY (c_days) THEN RAISE EXCEPTION ''Unknown series''; END IF;',
                     'IF NOT v_series = ANY (c_days) THEN RAISE EXCEPTION ''Unknown series''; END IF;' || E'\n  '
                     || '-- the other five days are lessons (community_publish_lessons)' || E'\n  '
                     || 'IF _series IS NULL AND v_series NOT IN (''wednesday_wins'', ''sunday_recap'') THEN RETURN jsonb_build_object(''status'', ''lesson_day''); END IF;');
    EXECUTE v_def;
  END IF;

  -- The dashboard's "next post" knows about lessons, and how many wait on the coach.
  v_def := pg_get_functiondef('public.community_admin_pulse()'::regprocedure);
  IF position('community_next_post' IN v_def) = 0 THEN
    IF position('''next'', v_next,' IN v_def) = 0 THEN RAISE EXCEPTION 'community_admin_pulse changed shape; patch by hand'; END IF;
    v_def := replace(v_def, '''next'', v_next,',
                     '''next'', public.community_next_post(),' || E'\n    '
                     || '''lessons_review'', (SELECT jsonb_array_length(public.community_lessons_waiting(24 * 7))),');
    EXECUTE v_def;
  END IF;
END
$patch$;

-- ── Schedule ─────────────────────────────────────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-lessons') THEN
    PERFORM cron.unschedule('community-lessons');
  END IF;
  PERFORM cron.schedule('community-lessons', '*/15 * * * *', 'select public.community_publish_lessons();');
END
$cron$;

NOTIFY pgrst, 'reload schema';
