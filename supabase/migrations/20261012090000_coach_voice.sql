-- Coach voice: one editable profile (Admin → My Voice) for everything the app
-- writes as Jared: AI-suggested check-in replies, form-review replies and the
-- Wednesday Wins post. Seeded with his own words. Per-client: a nickname only
-- they get (e.g. Dwayne → "brudda") and whether edgy humour is OK (guys only).

CREATE TABLE IF NOT EXISTS public.coach_voice (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.coach_voice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read coach voice" ON public.coach_voice;
CREATE POLICY "Staff read coach voice" ON public.coach_voice
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'coach'::public.app_role));
-- Writes go through staff-checked server functions (service role).

INSERT INTO public.coach_voice (id, profile)
VALUES (true, $voice${"rules":"You are Jared, a powerlifting / strength nerd coach texting a client he knows. Gen z, casual, real. Not an email, not a hype account.\nMostly lowercase. Capitalize only names and words you're stressing (like FIRST or LAST rep).\nLight punctuation. Lists of wins can run on with no commas: \"training felt strong food was on point cardio got done\".\nWrite \"thats\", \"lets\", \"its\" without apostrophes. Use \"&\" sometimes instead of \"and\". Grammar doesn't need to be perfect.\nBe a strength nerd when the data supports it: RPE / RIR, reps in the tank, top sets, bar speed, depth, pauses to comp standard, fatigue, deloads, recovery. Never invent lifts, numbers or sessions that aren't in the data.\nShape (40–90 words): a quick hype opener on a real win → what went well → \"biggest thing to clean up this week is…\" → \"this week lets…\" with 1–3 concrete goals. Pain or a red flag gets a plain, direct line (\"dont push through sharp pain\").\nUsually don't use their name. Never more than once.","everyday":["cooked","cooking","killing it","crushing it","looking yoked","massive","honestly","ngl","fr","imo","crazy","trash","trashhh","dump","dumping","winner","winning","geeking","geeking out","goes hard","floored","no way","bless","bless up","omg","perff"],"hype":["sheeeesh","ayooooo","noo way","thats craaazy","gawd damn","holy shiii","wtf","tooo goood!!"],"emojis":["💪","🔥🔥🔥","😭","💀","🙏","👊","🤝","🙌","🥹","🤣","🤩","🫡","🏆","🥇","🤤"],"for_guys":["big man","big guy","boss man","dude","bro","brother","man"],"for_women":["sis","gurllll"],"edgy":["👅💦","zesty"],"banned":["navigating","it's clear that","solid win","momentum","journey","dial in","a strong start","keep it up","significantly","metabolic flexibility","ensure","crucial","optimal","prioritize","Great work this week, [name]."],"examples":["really good week overall! training felt strong food was on point cardio got done and bodyweight held steady while everything tightened up. thats exactly what we want to see\n\nstress is a bit higher but you're still getting everything done & not letting it touch training which is a big win\n\nthis week lets keep doing what's working and lock in all 4 sessions","sheeeesh a 10lb bench PR?? you're cooking fr 🔥🔥🔥\n\nbar speed on the top set looked massive too so theres more in the tank. biggest thing to clean up is sleep, 6hrs isnt gonna cut it if we want to keep this going\n\nthis week lets hit all 4 sessions and get 7+ hrs every night","squats looked perff, depth is there and bar path is way more consistent\n\nfor bench pause the FIRST rep of every set like comp, long pause til its dead still. rest of the reps can be touch n go\n\ntop sets should feel like an RPE 8. if bar speed dies before that we pull the weight back a bit","glad youre feeling well enough to get back at it! being sick while traveling is rough so a 4/5 on nutrition is honestly a win\n\nenergy & sleep took a hit so this week lets just get the 3 sessions in. keep it around RPE 7 and leave a couple reps in the tank til the congestion clears, no grinding reps\n\nget sleep back on track first and the strength comes right back"]}$voice$::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS voice_nickname text,
  ADD COLUMN IF NOT EXISTS voice_edgy_ok boolean NOT NULL DEFAULT false;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_voice_nickname_len;
ALTER TABLE public.clients ADD CONSTRAINT clients_voice_nickname_len
  CHECK (voice_nickname IS NULL OR char_length(voice_nickname) <= 40);

-- A word list from the profile (empty when missing), for SQL-written posts.
CREATE OR REPLACE FUNCTION public.coach_voice_words(_key text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT array(SELECT jsonb_array_elements_text(cv.profile -> _key))
       FROM public.coach_voice cv
      WHERE cv.id AND jsonb_typeof(cv.profile -> _key) = 'array'),
    '{}'::text[])
$$;
REVOKE ALL ON FUNCTION public.coach_voice_words(text) FROM PUBLIC, anon, authenticated;

-- Wednesday Wins: same facts, rotation and stats; big weeks now get his hype
-- words / emojis from the voice profile.
CREATE OR REPLACE FUNCTION public.community_compose_wins(_week_start date, _exclude_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_all jsonb := public.community_week_wins(_week_start, _exclude_user);
  v_n int := jsonb_array_length(v_all);
  v_post date := _week_start + 9;
  v_month_start timestamptz := (date_trunc('month', (_week_start + 9)::timestamp) AT TIME ZONE tz);
  v_key text := 'wednesday_wins:' || to_char(_week_start + 9, 'IYYY-"W"IW');
  -- only shout-outs before this post count (so re-composing a past week is honest)
  v_post_end timestamptz := ((_week_start + 10)::timestamp AT TIME ZONE tz);
  v_weds_left int;
  v_waiting int;
  v_k int;
  v_pick jsonb;
  v_lines text;
  v_stats jsonb;
  v_prs int;
  v_wk int := extract(week FROM _week_start)::int;
  v_intro text;
  v_outro text;
  v_caption text;
  -- Jared's voice (Admin → My Voice): hype words + hype emojis for big weeks.
  -- Group post, so no swears / edgy words and only group-friendly emojis.
  v_hype text[] := array(SELECT w FROM unnest(public.coach_voice_words('hype')) w WHERE w !~* '(wtf|damn|shi)');
  v_emoji text[] := array(SELECT e FROM unnest(public.coach_voice_words('emojis')) e
                           WHERE e = ANY (ARRAY['🔥🔥🔥','🔥','💪','🙌','🏆','🥇','🫡','👊']));
BEGIN
  IF v_n = 0 THEN RETURN NULL; END IF;

  -- Wednesdays left in this month, this one included
  v_weds_left := ((date_trunc('month', v_post::timestamp) + interval '1 month - 1 day')::date - v_post) / 7 + 1;
  -- people who trained and haven't had a shout-out yet this month
  SELECT count(*)::int INTO v_waiting FROM jsonb_array_elements(v_all) w
   WHERE NOT EXISTS (SELECT 1 FROM public.community_series_features f
                      WHERE f.client_id = (w->>'client_id')::uuid AND f.featured_at >= v_month_start AND f.featured_at < v_post_end AND f.series_key <> v_key);
  v_k := least(v_n, greatest(3, least(5, ceil(v_waiting::numeric / greatest(v_weds_left, 1))::int)));

  SELECT jsonb_agg(w ORDER BY ord) INTO v_pick FROM (
    SELECT w, row_number() OVER (ORDER BY
             EXISTS (SELECT 1 FROM public.community_series_features f
                      WHERE f.client_id = (w->>'client_id')::uuid AND f.featured_at >= v_month_start AND f.featured_at < v_post_end AND f.series_key <> v_key) ASC,
             -- people who train every week will be back next week; catch the
             -- ones who train on and off while they're here
             ((w->>'streak')::int >= 4) ASC,
             (w->>'score')::int DESC,
             md5((w->>'client_id') || _week_start::text)) AS ord
      FROM jsonb_array_elements(v_all) w) z
   WHERE ord <= v_k;

  SELECT string_agg(coalesce(w->'texts'->>((pos - 1 + v_wk)::int % 3), w->>'text'), E'\n\n' ORDER BY pos) INTO v_lines
    FROM (SELECT w, row_number() OVER (ORDER BY (w->>'score')::int DESC) AS pos FROM jsonb_array_elements(v_pick) w) z;

  v_stats := public.community_week_stats(_week_start, _exclude_user, v_all);
  v_prs := (v_stats->>'prs')::int;

  v_intro := CASE
    -- "yall" only when it's genuinely hype
    WHEN v_prs >= 25 THEN (ARRAY['yall are cooking. ' || v_prs || ' PRs last week', 'big week. ' || v_prs || ' PRs between everyone last week'])[1 + v_wk % 2]
    WHEN v_prs >= 10 THEN (ARRAY['big week. ' || v_prs || ' PRs between everyone', 'last week was a good one. ' || v_prs || ' PRs across the crew'])[1 + v_wk % 2]
    WHEN v_n * 10 >= (v_stats->>'roster')::int * 6 THEN (ARRAY['most of the crew showed up last week', 'good week from this group'])[1 + v_wk % 2]
    ELSE (ARRAY['some wins from last week', 'few highlights from last week'])[1 + v_wk % 2] END;
  v_outro := (ARRAY[v_n || ' of you got after it last week. proud of this crew 🔥',
                    'thats the standard. lets go again this week',
                    'not on here yet? you will be. lets go',
                    'everyone who showed up last week built this. keep stacking'])[1 + v_wk % 4];

  -- Only when it's genuinely hype: a hype word up front, a hype emoji at the end.
  IF v_prs >= 25 AND coalesce(array_length(v_hype, 1), 0) > 0 THEN
    v_intro := v_hype[1 + v_wk % array_length(v_hype, 1)] || ' ' || v_intro;
  END IF;
  IF v_prs >= 10 AND coalesce(array_length(v_emoji, 1), 0) > 0 THEN
    v_outro := regexp_replace(v_outro, '\s*🔥$', '') || ' ' || v_emoji[1 + v_wk % array_length(v_emoji, 1)];
  END IF;

  v_caption := v_intro || E'\n\n' || v_lines || E'\n\n' || v_outro;
  -- not perfect every time: some weeks every paragraph starts lowercase,
  -- other weeks they're capitalized
  IF v_wk % 2 = 1 THEN
    SELECT string_agg(upper(left(p, 1)) || substr(p, 2), E'\n\n' ORDER BY n) INTO v_caption
      FROM unnest(string_to_array(v_caption, E'\n\n')) WITH ORDINALITY AS t(p, n);
  END IF;

  RETURN jsonb_build_object(
    'week_of', _week_start,
    'trainers', v_n,
    'featured', (SELECT jsonb_agg(jsonb_build_object('client_id', w->>'client_id', 'type', w->>'type')) FROM jsonb_array_elements(v_pick) w),
    'stats', v_stats,
    'caption', v_caption);
END;
$$;

REVOKE ALL ON FUNCTION public.community_compose_wins(date, uuid) FROM PUBLIC, anon, authenticated;
