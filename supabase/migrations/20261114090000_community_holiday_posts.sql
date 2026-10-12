-- Holiday posts: one coach post on each big holiday, from the coach's account,
-- with a photo. Canadian dates (Winnipeg time), 9 am, same pause switch and
-- author as the daily posts. Each one is thanks + one thing to do today.
--
-- Rides along with the daily posts (it doesn't replace that day's post):
-- series 'holiday', key 'holiday:<holiday>:<year>' (once a year, ever), and
-- the picture goes to the app as series_extra { holiday, name, image }.
-- A coach photo on the post (swap photos) takes the picture's place.

-- ── Shape ──────────────────────────────────────────────────────────────────
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_series_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_series_check
  CHECK (series IS NULL OR (kind = 'note' AND series IN (
    'monday_motivation', 'tuesday_tips', 'wednesday_wins', 'try_it_thursday',
    'finish_strong_friday', 'saturday_spirit', 'sunday_recap', 'holiday')));

-- The date rule: a fixed day (month + day), the nth weekday of a month
-- (month + isodow + nth, Monday = 1), or Easter Sunday.
CREATE TABLE IF NOT EXISTS public.community_holidays (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  name text NOT NULL,
  month smallint CHECK (month BETWEEN 1 AND 12),
  day smallint CHECK (day BETWEEN 1 AND 31),
  isodow smallint CHECK (isodow BETWEEN 1 AND 7),
  nth smallint CHECK (nth BETWEEN 1 AND 5),
  easter boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1200),
  image text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (easter OR (month IS NOT NULL AND ((day IS NOT NULL AND isodow IS NULL AND nth IS NULL)
                                          OR (day IS NULL AND isodow IS NOT NULL AND nth IS NOT NULL))))
);
ALTER TABLE public.community_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_holidays FROM anon, authenticated;
DROP POLICY IF EXISTS "Staff read holidays" ON public.community_holidays;
CREATE POLICY "Staff read holidays" ON public.community_holidays FOR SELECT TO authenticated USING (public.is_community_staff());
GRANT SELECT ON public.community_holidays TO authenticated;

-- ── When it falls in a given year ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_holiday_date(_key text, _year int)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  h public.community_holidays;
  a int; b int; c int; d int; e int; f int; g int; i int; k int; l int; m int; n int; p int;
  v_first date;
BEGIN
  SELECT * INTO h FROM public.community_holidays WHERE key = _key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF h.easter THEN
    -- Anonymous Gregorian algorithm
    a := _year % 19; b := _year / 100; c := _year % 100; d := b / 4; e := b % 4;
    f := (b + 8) / 25; g := (b - f + 1) / 3; n := (19 * a + b - d - g + 15) % 30;
    i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - n - k) % 7;
    m := (a + 11 * n + 22 * l) / 451; p := n + l - 7 * m + 114;
    RETURN make_date(_year, p / 31, p % 31 + 1);
  END IF;
  IF h.day IS NOT NULL THEN RETURN make_date(_year, h.month, h.day); END IF;
  v_first := make_date(_year, h.month, 1);
  RETURN v_first + ((h.isodow - extract(isodow FROM v_first)::int + 7) % 7) + 7 * (h.nth - 1);
END;
$$;
REVOKE ALL ON FUNCTION public.community_holiday_date(text, int) FROM PUBLIC, anon, authenticated;

-- ── Publish: today's holiday, once ─────────────────────────────────────────
-- No key: whatever holiday today is, from 9 am to 9 pm (the job runs every
-- 15 minutes, so a missed run still catches it). With a key and _force (staff
-- "post now"), it goes out today regardless; still only once that year.
CREATE OR REPLACE FUNCTION public.community_publish_holiday(_key text DEFAULT NULL, _force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/Winnipeg';
  v_year int := extract(year FROM now() AT TIME ZONE 'America/Winnipeg')::int;
  v_settings record;
  v_author uuid;
  h public.community_holidays;
  v_key text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _key IS NOT NULL THEN
    SELECT * INTO h FROM public.community_holidays WHERE key = _key AND active;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_holiday'); END IF;
    IF NOT coalesce(_force, false) AND public.community_holiday_date(h.key, v_year) <> v_local::date THEN
      RETURN jsonb_build_object('status', 'not_today');
    END IF;
  ELSE
    SELECT * INTO h FROM public.community_holidays x
     WHERE x.active AND public.community_holiday_date(x.key, v_year) = v_local::date
     ORDER BY x.key LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_holiday'); END IF;
  END IF;
  IF NOT coalesce(_force, false) AND (v_local::time < time '09:00' OR v_local::time >= time '21:00') THEN
    RETURN jsonb_build_object('status', 'outside_window');
  END IF;

  SELECT * INTO v_settings FROM public.community_series_settings WHERE id;
  IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;
  v_author := public.community_main_account(v_settings.author_user_id);
  IF v_author IS NULL THEN RETURN jsonb_build_object('status', 'no_author'); END IF;

  v_key := 'holiday:' || h.key || ':' || v_year;
  INSERT INTO public.community_series_runs (series_key, series) VALUES (v_key, 'holiday') ON CONFLICT (series_key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;

  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, series, series_key, series_data)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community',
          btrim(h.body), 'holiday', v_key,
          jsonb_strip_nulls(jsonb_build_object('holiday', h.key, 'name', h.name, 'image', h.image)))
  ON CONFLICT (series_key) WHERE series_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status', 'exists', 'key', v_key); END IF;
  UPDATE public.community_series_runs SET post_id = v_id WHERE series_key = v_key;
  RETURN jsonb_build_object('status', 'published', 'post_id', v_id, 'key', v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.community_publish_holiday(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_publish_holiday(text, boolean) TO authenticated;

-- ── The app gets the picture as series_extra ───────────────────────────────
-- Patched in place (the rest of community_post_json is unchanged from
-- 20261026090000_community_lockin_separate_post): 'holiday' joins the
-- series whose series_data goes out as series_extra.
DO $$
DECLARE
  c_old constant text := $s$'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit') THEN n.series_data END,$s$;
  c_new constant text := $s$'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit', 'holiday') THEN n.series_data END,$s$;
  v_def text := pg_get_functiondef('public.community_post_json(uuid, uuid)'::regprocedure);
BEGIN
  IF position(c_new IN v_def) > 0 THEN RETURN; END IF;
  IF position(c_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'community_post_json no longer has the series_extra line this migration patches';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END $$;

-- ── Schedule ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  PERFORM cron.schedule('community-holiday-posts', '*/15 * * * *', 'select public.community_publish_holiday();');
EXCEPTION WHEN undefined_table OR invalid_schema_name OR undefined_function THEN
  RAISE NOTICE 'pg_cron not available; community-holiday-posts not scheduled';
END $$;

-- ── The holidays ───────────────────────────────────────────────────────────
-- In the coach's voice: thanks first, then ONE thing to do today.
INSERT INTO public.community_holidays (key, name, month, day, isodow, nth, easter, image, body) VALUES
('new_year', 'New Year''s Day', 1, 1, NULL, NULL, false, '/community/holidays/new_year.jpg',
'happy new year 🎉

before anything else, thank you. every session you logged last year built the person reading this. i got to watch a lot of you hit stuff you didnt think was possible & that never gets old

one thing for today: pick the ONE habit that would change your year the most. not 10. one. write it in your notes app & set a reminder 7 days from now to check if you did it

no new year new me stuff. same you, more reps 💪'),

('valentines', 'Valentine''s Day', 2, 14, NULL, NULL, false, '/community/holidays/valentines.jpg',
'happy valentines day ❤️

shoutout to everyone who looks out for this crew in the quiet ways. the spot on the last rep, the hype in the comments, the text when someone misses a session. thats what makes this place different & im grateful for every one of you

one thing for today: drop a comment on someone elses post in here. tell them one specific thing you noticed about their training. takes 30 seconds & it will make their day

love yall fr 🤝'),

('easter', 'Easter', NULL, NULL, NULL, NULL, true, '/community/holidays/easter.jpg',
'happy easter everyone 🐣

spring is the reminder that growth happens underground first. the weeks where it felt like nothing was changing were still doing work. v proud of how many of you kept showing up all winter 🙏

one thing for today: go for a 20 minute walk after the big meal. bring the family if you can. sun, fresh air & your digestion will thank you

enjoy the day & the chocolate. no guilt 🫡'),

('mothers_day', 'Mother''s Day', 5, NULL, 7, 2, false, '/community/holidays/mothers_day.jpg',
'happy mothers day to all the moms in this crew 💐

you train around school runs, work, no sleep & everyone elses schedule and you still get it done. honestly some of the most consistent people i coach are moms & that says everything 🙌

one thing for today: text your mom (or whoever raised you) one specific thing they taught you that you still use. not just happy mothers day. the specific thing

and moms, today counts as a rest day if you want it to 🫶'),

('fathers_day', 'Father''s Day', 6, NULL, 7, 3, false, '/community/holidays/fathers_day.jpg',
'happy fathers day to all the dads in here 👊

your kids are watching how you handle hard things. every time you show up when you dont feel like it, they see it. thats the stuff that actually gets passed down. grateful to coach so many of you

one thing for today: get your kid (or your dad) moving with you. a walk, catch, a backyard workout, anything. 15 minutes together beats any session you could do alone today

proud of yall 💪'),

('canada_day', 'Canada Day', 7, 1, NULL, NULL, false, '/community/holidays/canada_day.jpg',
'happy canada day 🇨🇦

grateful i get to do this with such a good crew. suns out, long weekend energy, enjoy it fr

one thing for today: drink a full glass of water before every drink & every plate. sun + patio + bbq is how you wake up tomorrow feeling like trash. future you will thank you

have fun, be safe & ill see you in the gym 🔥'),

('labour_day', 'Labour Day', 9, NULL, 1, 1, false, '/community/holidays/labour_day.jpg',
'happy labour day 💪

thank you for sticking with it all summer. trips, bbqs, late nights & you still found ways to train. that matters more than you think

fall is my favourite time to train. schedules settle down & the people who lock in now show up to january already ahead

one thing for today: put this weeks sessions in your calendar right now. actual days & actual times. if its not scheduled it doesnt happen

lets go 🔥'),

('thanksgiving', 'Thanksgiving', 10, NULL, 1, 2, false, '/community/holidays/thanksgiving.jpg',
'happy thanksgiving everyone 🦃

real talk, im grateful for every one of you. you show up, you log your sets & you trust the plan even on the days it sucks. coaching you is the best part of what i do & i dont take it for granted 🙏

one thing for today: before you eat, text one person who helped you get where you are. a training partner, a parent, a friend, whoever. 2 minutes & it will hit harder than you think

then enjoy the food. one big meal doesnt undo months of work. we go again tomorrow 💪'),

('halloween', 'Halloween', 10, 31, NULL, NULL, false, '/community/holidays/halloween.jpg',
'happy halloween 🎃

real talk, youre allowed to have the candy. one night doesnt move the scale, what you do most days does. and most of you are crushing most days 💪

one thing for today: eat a real meal with protein before you go out or start handing out candy. you will eat way less of it without even trying

thanks for being the best crew to coach. have fun & send me the costumes 🤣'),

('christmas', 'Christmas', 12, 25, NULL, NULL, false, '/community/holidays/christmas.jpg',
'merry christmas everyone 🎄

today is the one day i want you to fully switch off. no tracking, no stressing about food, no guilt. you earned it. thank you for trusting me with your training this year, it means more than you know 🙏

one thing for today: put your phone in another room for one meal. be all the way there with the people you love

ill see you in the gym when youre back 💪')
ON CONFLICT (key) DO NOTHING;
