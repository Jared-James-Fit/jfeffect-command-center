-- Birthday posts, reviewed by the coach before anything goes out.
--
--   the evening before (5pm Winnipeg)  a draft in Jared's voice, written from
--                                      real numbers only (sessions, PRs, since
--                                      when), plus a "ready to review" push
--   he approves (edit / re-roll / skip) it's scheduled for 8am on their
--                                      birthday, their time (or goes now, if
--                                      that's already passed)
--   8am their time                     the community post + a message to them
--                                      with a tap-through card to the post;
--                                      they're marked "wished"
--   9am on the day, still not reviewed a reminder push
--
-- Nothing ever posts without approval. Clients already wished this year, with
-- the birthday card switched off, or without community access are skipped.

-- One-time tips can carry a number now (the double-tap tip counts its visits).
ALTER TABLE public.community_hints_seen DROP CONSTRAINT IF EXISTS community_hints_seen_hint_check;
ALTER TABLE public.community_hints_seen ADD CONSTRAINT community_hints_seen_hint_check CHECK (hint ~ '^[a-z0-9_]{1,40}$');

CREATE TABLE IF NOT EXISTS public.community_birthday_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  birthday_year int NOT NULL,
  birthday date NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1200),
  dm_body text NOT NULL CHECK (char_length(dm_body) BETWEEN 1 AND 1000),
  slot int NOT NULL DEFAULT 0,
  -- the numbers it was written from (kept, so a re-roll is instant and honest)
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'scheduled', 'posted', 'skipped')),
  post_at timestamptz NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  posted_at timestamptz,
  ready_pushed_at timestamptz,
  reminder_pushed_at timestamptz,
  dm_pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, birthday_year)
);
CREATE INDEX IF NOT EXISTS community_birthday_posts_due ON public.community_birthday_posts (status, post_at);
ALTER TABLE public.community_birthday_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read birthday posts" ON public.community_birthday_posts;
CREATE POLICY "Staff read birthday posts" ON public.community_birthday_posts
  FOR SELECT TO authenticated USING (public.is_community_staff());
-- Writes go through the functions below.

-- The birthday in a given year (Feb 29 → Feb 28 in common years).
CREATE OR REPLACE FUNCTION public.community_birthday_on(_dob date, _year int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN extract(month FROM _dob) = 2 AND extract(day FROM _dob) = 29
         AND NOT (_year % 4 = 0 AND (_year % 100 <> 0 OR _year % 400 = 0))
      THEN make_date(_year, 2, 28)
    ELSE make_date(_year, extract(month FROM _dob)::int, extract(day FROM _dob)::int)
  END
$$;

-- Real numbers for the post: sessions, PRs, which big lifts, since when.
CREATE OR REPLACE FUNCTION public.community_birthday_facts(_client_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT pc.completed_at, public.community_workout_stats(pc.id) AS st
      FROM public.pl_day_completions pc
     WHERE pc.client_id = _client_id AND pc.completed_at IS NOT NULL
  ), lifts AS (
    SELECT DISTINCT
      CASE WHEN n ~* 'squat' THEN 'squats' WHEN n ~* 'bench' THEN 'bench' WHEN n ~* 'deadlift' THEN 'deadlifts' END AS w,
      CASE WHEN n ~* 'squat' THEN 1 WHEN n ~* 'bench' THEN 2 WHEN n ~* 'deadlift' THEN 3 END AS o
      FROM s, jsonb_array_elements(coalesce(s.st -> 'prs', '[]'::jsonb)) p, LATERAL (SELECT p ->> 'exercise_name' AS n) x
  )
  SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM s),
    'prs', (SELECT coalesce(sum((st ->> 'pr_count')::int), 0) FROM s),
    'first', (SELECT min(completed_at) FROM s),
    'recent', (SELECT count(*) FROM s WHERE completed_at > now() - interval '30 days'),
    'lifts', coalesce((SELECT jsonb_agg(w ORDER BY o) FROM lifts WHERE w IS NOT NULL), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.community_birthday_facts(uuid) FROM PUBLIC, anon, authenticated;

-- The post and the message, in his voice (lowercase, light punctuation, his
-- emojis, nickname when there is one). `_slot` picks the wording, so two
-- birthdays on the same day never read the same; re-roll bumps it.
CREATE OR REPLACE FUNCTION public.community_birthday_compose(_client_id uuid, _slot int, _facts jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  f jsonb := coalesce(_facts, public.community_birthday_facts(_client_id));
  k int := abs(coalesce(_slot, 0));
  v_name text;
  v_nick text;
  v_sessions int := (f ->> 'sessions')::int;
  v_prs int := (f ->> 'prs')::int;
  v_first timestamptz := (f ->> 'first')::timestamptz;
  v_since text := '';
  v_lw text[] := array(SELECT jsonb_array_elements_text(f -> 'lifts'));
  v_lifts text;
  v_mid text;
  v_open text[];
  v_close text[];
  v_dm text[];
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  v_name := coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''), 'you');
  v_nick := nullif(btrim(c.voice_nickname), '');
  IF v_first IS NOT NULL AND v_first < now() - interval '45 days' THEN
    v_since := ' since ' || lower(to_char(v_first AT TIME ZONE coalesce(c.timezone, 'America/Winnipeg'), 'FMMonth'));
  END IF;
  v_lifts := CASE coalesce(array_length(v_lw, 1), 0)
    WHEN 0 THEN NULL
    WHEN 1 THEN v_lw[1]
    WHEN 2 THEN v_lw[1] || ' & ' || v_lw[2]
    ELSE v_lw[1] || ', ' || v_lw[2] || ' & ' || v_lw[3] END;

  v_open := ARRAY[
    'happy birthday ' || v_name || ' 🎂',
    'happy birthday to ' || CASE WHEN v_nick IS NOT NULL THEN 'my ' || v_nick || ' ' ELSE '' END || v_name || ' 🥳',
    'its ' || v_name || '''s birthday today 🎂🎉',
    'HBD ' || v_name || ' 🎉',
    'big happy birthday to ' || v_name || ' today 🎂'];

  IF v_prs >= 10 AND v_sessions >= 20 THEN
    v_mid := v_sessions || ' sessions & ' || v_prs || ' PRs' || v_since || '. '
      || (ARRAY['does NOT miss 💪🔥🔥🔥', 'the consistency is crazy fr 💪', 'thats what showing up looks like 🔥🔥🔥'])[1 + k % 3];
  ELSIF v_prs >= 3 THEN
    v_mid := v_prs || ' PRs' || CASE WHEN v_lifts IS NOT NULL THEN ' on ' || v_lifts ELSE '' END || v_since || '. '
      || (ARRAY['getting stronger and it shows 💪', 'the strength is going up fr 🔥', 'proud of the work youve been putting in 🙌'])[1 + k % 3];
  ELSIF v_sessions >= 8 THEN
    v_mid := v_sessions || ' sessions' || v_since || '. ' || (ARRAY['showing up week after week 💪', 'love the consistency 🙌'])[1 + k % 2];
  ELSE
    v_mid := (ARRAY['so glad youre part of this crew 🙌', 'glad to have you in the crew 🙏'])[1 + k % 2];
  END IF;

  v_close := ARRAY[
    'enjoy today, eat the cake fr. then we go again',
    'hope today is a great one, enjoy it 🙌',
    'have the best day, you deserve it 🙏',
    'go enjoy your day, the gym can wait (for today) 🤣',
    'eat the cake. all of it 🤤'];
  v_dm := ARRAY[
    'happy birthday ' || coalesce(v_nick, v_name) || '!! 🎂 hope you have a good one today. posted a lil something for you in the community 👀',
    'hbd ' || coalesce(v_nick, v_name) || ' 🥳 made you a lil post in the community, go check it out 🙌',
    'happy birthday ' || coalesce(v_nick, v_name) || ' 🎉 enjoy your day! put a lil something up for you in the community'];

  RETURN jsonb_build_object(
    'body', v_open[1 + k % 5] || E'\n\n' || v_mid || E'\n\n' || v_close[1 + (k * 2 + 1) % 5],
    'dm_body', v_dm[1 + k % 3]);
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthday_compose(uuid, int, jsonb) FROM PUBLIC, anon, authenticated;

-- Drafts for birthdays coming up: tomorrow (once it's 5pm for Jared) and
-- today (if one was missed). Called hourly by the birthday hook.
CREATE OR REPLACE FUNCTION public.community_birthdays_prepare(_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_hour int := extract(hour FROM _now AT TIME ZONE tz)::int;
  r record;
  v_facts jsonb;
  v_slot int;
  v_comp jsonb;
  v_rank int := 0;
  v_made int := 0;
BEGIN
  FOR r IN
    SELECT c.id, b.day, b.yr, b.ctz, b.local_hour
      FROM public.clients c
      CROSS JOIN LATERAL (
        SELECT coalesce(nullif(c.timezone, ''), tz) AS ctz,
               (_now AT TIME ZONE coalesce(nullif(c.timezone, ''), tz))::date AS ld,
               extract(hour FROM _now AT TIME ZONE coalesce(nullif(c.timezone, ''), tz))::int AS local_hour
      ) l
      CROSS JOIN LATERAL (
        SELECT d AS day, extract(year FROM d)::int AS yr, l.ctz, l.local_hour
          FROM (SELECT CASE WHEN public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int) >= l.ld
                            THEN public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int)
                            ELSE public.community_birthday_on(c.date_of_birth, extract(year FROM l.ld)::int + 1) END AS d) x
         WHERE (x.d = l.ld AND l.local_hour < 20) OR (x.d = l.ld + 1 AND v_hour >= 17)
      ) b
     WHERE c.date_of_birth IS NOT NULL AND c.user_id IS NOT NULL
       AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
       AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.community_birthday_posts p WHERE p.client_id = c.id AND p.birthday_year = b.yr)
       AND NOT EXISTS (SELECT 1 FROM public.client_birthday_wishes w WHERE w.client_id = c.id AND w.birthday_year = b.yr)
       AND NOT EXISTS (SELECT 1 FROM public.client_birthday_cards bc WHERE bc.client_id = c.id AND bc.enabled = false)
     ORDER BY b.day, c.id
  LOOP
    v_facts := public.community_birthday_facts(r.id);
    v_slot := abs(hashtext(r.id::text || r.yr)) % 997 + v_rank;
    v_comp := public.community_birthday_compose(r.id, v_slot, v_facts);
    INSERT INTO public.community_birthday_posts (client_id, birthday_year, birthday, body, dm_body, slot, facts, post_at)
    VALUES (r.id, r.yr, r.day, v_comp ->> 'body', v_comp ->> 'dm_body', v_slot, v_facts,
            (r.day::timestamp + time '08:00') AT TIME ZONE r.ctz)
    ON CONFLICT (client_id, birthday_year) DO NOTHING;
    v_rank := v_rank + 1;
    v_made := v_made + 1;
  END LOOP;
  RETURN v_made;
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthdays_prepare(timestamptz) FROM PUBLIC, anon, authenticated;

-- Post one approved birthday: the community post as the approving coach,
-- the message to them with a card that opens the post, and "wished".
CREATE OR REPLACE FUNCTION public.community_birthday_publish_row(_id uuid)
RETURNS public.community_birthday_posts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.community_birthday_posts;
  v_author uuid;
  v_post uuid;
  v_msg uuid;
BEGIN
  SELECT * INTO b FROM public.community_birthday_posts WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'scheduled' OR b.approved_by IS NULL THEN RETURN b; END IF;
  v_author := public.community_main_account(b.approved_by);
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption)
  VALUES (v_author, (SELECT c.id FROM public.clients c WHERE c.user_id = v_author LIMIT 1), 'note', 'community', b.body)
  RETURNING id INTO v_post;
  INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, is_internal_note, read_by_admin_at)
  VALUES (b.client_id, b.approved_by, 'admin', b.dm_body,
    jsonb_build_array(jsonb_build_object(
      'type', 'link', 'kind', 'community_post', 'post_id', v_post,
      'url', '/portal/community#post=' || v_post,
      'name', '🎂 Your birthday post', 'title', 'Your birthday post',
      'request_note', split_part(b.body, E'\n', 1))),
    'General', false, now())
  RETURNING id INTO v_msg;
  INSERT INTO public.client_birthday_wishes (client_id, birthday_year, wished_by)
  VALUES (b.client_id, b.birthday_year, b.approved_by)
  ON CONFLICT (client_id, birthday_year) DO NOTHING;
  UPDATE public.community_birthday_posts
     SET status = 'posted', post_id = v_post, message_id = v_msg, posted_at = now(), updated_at = now()
   WHERE id = _id
  RETURNING * INTO b;
  RETURN b;
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthday_publish_row(uuid) FROM PUBLIC, anon, authenticated;

-- Approved ones whose time has come (hourly hook).
CREATE OR REPLACE FUNCTION public.community_birthdays_publish_due(_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.community_birthday_posts WHERE status = 'scheduled' AND post_at <= _now ORDER BY post_at LOOP
    PERFORM public.community_birthday_publish_row(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthdays_publish_due(timestamptz) FROM PUBLIC, anon, authenticated;

-- ---- for the coach ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_birthday_json(b public.community_birthday_posts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', b.id, 'client_id', b.client_id, 'birthday', b.birthday, 'birthday_year', b.birthday_year,
    'status', b.status, 'post_at', b.post_at, 'body', b.body, 'dm_body', b.dm_body,
    'post_id', b.post_id, 'message_id', b.message_id, 'posted_at', b.posted_at,
    'person', (SELECT jsonb_build_object(
                 'name', coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''), 'Client'),
                 'full_name', coalesce(nullif(btrim(c.full_name), ''), btrim(concat_ws(' ', c.first_name, c.last_name))),
                 'avatar_url', public.community_author(c.user_id) ->> 'avatar_url',
                 'timezone', c.timezone)
                 FROM public.clients c WHERE c.id = b.client_id))
$$;
REVOKE ALL ON FUNCTION public.community_birthday_json(public.community_birthday_posts) FROM PUBLIC, anon, authenticated;

-- What's waiting / going out: unposted ones, and ones posted in the last day.
CREATE OR REPLACE FUNCTION public.community_birthdays_upcoming()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_birthday_json(b) ORDER BY b.post_at)
      FROM public.community_birthday_posts b
     WHERE (b.status IN ('ready', 'scheduled') AND b.birthday >= current_date - 1)
        OR (b.status = 'posted' AND b.posted_at > now() - interval '24 hours')), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthdays_upcoming() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_birthdays_upcoming() TO authenticated;

-- One action from the review sheet: 'save' (keep edits), 'reroll' (fresh
-- wording), 'approve' (schedule for 8am their time, or post now if that's
-- passed), 'post_now', 'unschedule', 'skip'.
CREATE OR REPLACE FUNCTION public.community_birthday_act(_id uuid, _action text, _body text DEFAULT NULL, _dm_body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.community_birthday_posts;
  v_body text := nullif(btrim(coalesce(_body, '')), '');
  v_dm text := nullif(btrim(coalesce(_dm_body, '')), '');
  v_comp jsonb;
BEGIN
  IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('save', 'reroll', 'approve', 'post_now', 'unschedule', 'skip') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT * INTO b FROM public.community_birthday_posts WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF b.status = 'posted' THEN RAISE EXCEPTION 'Already posted'; END IF;
  IF v_body IS NOT NULL AND char_length(v_body) > 1200 THEN RAISE EXCEPTION 'Post is too long'; END IF;
  IF v_dm IS NOT NULL AND char_length(v_dm) > 1000 THEN RAISE EXCEPTION 'Message is too long'; END IF;

  IF _action = 'reroll' THEN
    v_comp := public.community_birthday_compose(b.client_id, b.slot + 1, nullif(b.facts, '{}'::jsonb));
    UPDATE public.community_birthday_posts
       SET slot = b.slot + 1, body = v_comp ->> 'body', dm_body = v_comp ->> 'dm_body', updated_at = now()
     WHERE id = _id RETURNING * INTO b;
  ELSIF _action = 'skip' THEN
    UPDATE public.community_birthday_posts SET status = 'skipped', updated_at = now() WHERE id = _id RETURNING * INTO b;
  ELSIF _action = 'unschedule' THEN
    UPDATE public.community_birthday_posts SET status = 'ready', approved_by = NULL, approved_at = NULL, updated_at = now()
     WHERE id = _id RETURNING * INTO b;
  ELSE
    UPDATE public.community_birthday_posts
       SET body = coalesce(v_body, body), dm_body = coalesce(v_dm, dm_body), updated_at = now(),
           status = CASE WHEN _action IN ('approve', 'post_now') THEN 'scheduled' ELSE status END,
           approved_by = CASE WHEN _action IN ('approve', 'post_now') THEN uid ELSE approved_by END,
           approved_at = CASE WHEN _action IN ('approve', 'post_now') THEN now() ELSE approved_at END
     WHERE id = _id RETURNING * INTO b;
    IF _action = 'post_now' OR (_action = 'approve' AND b.post_at <= now()) THEN
      b := public.community_birthday_publish_row(_id);
    END IF;
  END IF;
  RETURN public.community_birthday_json(b);
END;
$$;
REVOKE ALL ON FUNCTION public.community_birthday_act(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_birthday_act(uuid, text, text, text) TO authenticated;
