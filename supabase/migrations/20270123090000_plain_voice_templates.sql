-- Automated posts read like the coach texting his crew, at about a 5th grade
-- level (src/lib/plain-words.ts holds the check; the tests run it on these
-- templates). Wins and the Recap were already short and plain; what changes:
--
-- * Wednesday Wins stays lowercase every week (it capitalised every paragraph
--   on odd weeks, which isn't how he writes), and a hype word reads as its own
--   beat ("thats craaazy!! big week") instead of running into the next words.
-- * Tuesday's crew numbers lead with the question the numbers answer, say
--   "about N each" instead of "N on average", and keep "not proof" in plain words.
-- * Thursday's feature stat says the same in plain words, in two short sentences
--   ("5 of you log your bodyweight 2+ times a week. those 5 trained about 3.8 times…").
-- * The birthday DM points to Crew (the tab's name), not "the community".

-- ── Wednesday Wins ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_compose_wins(_week_start date, _exclude_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tz constant text := 'America/Winnipeg';
  v_all jsonb := public.community_week_wins(_week_start, _exclude_user);
  v_n int := jsonb_array_length(v_all);
  v_post date := _week_start + 9;
  -- local times to instants through local_to_instant (Manitoba's fixed UTC-5 from Nov 1, 2026)
  v_month_start timestamptz := public.local_to_instant(date_trunc('month', (_week_start + 9)::timestamp), tz);
  v_key text := 'wednesday_wins:' || to_char(_week_start + 9, 'IYYY-"W"IW');
  v_post_end timestamptz := public.local_to_instant((_week_start + 10)::timestamp, tz);
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
  v_hype_word text;
  v_caption text;
  v_hype text[] := array(SELECT w FROM unnest(public.coach_voice_words('hype')) w WHERE w !~* '(wtf|damn|shi)');
  v_emoji text[] := array(SELECT e FROM unnest(public.coach_voice_words('emojis')) e
                           WHERE e = ANY (ARRAY['🔥🔥🔥','🔥','💪','🙌','🏆','🥇','🫡','👊']));
BEGIN
  IF v_n = 0 THEN RETURN NULL; END IF;

  v_weds_left := ((date_trunc('month', v_post::timestamp) + interval '1 month - 1 day')::date - v_post) / 7 + 1;
  SELECT count(*)::int INTO v_waiting FROM jsonb_array_elements(v_all) w
   WHERE NOT EXISTS (SELECT 1 FROM public.community_series_features f
                      WHERE f.client_id = (w->>'client_id')::uuid AND f.featured_at >= v_month_start AND f.featured_at < v_post_end AND f.series_key <> v_key);
  v_k := least(v_n, greatest(3, least(5, ceil(v_waiting::numeric / greatest(v_weds_left, 1))::int)));

  SELECT jsonb_agg(w ORDER BY ord) INTO v_pick FROM (
    SELECT w, row_number() OVER (ORDER BY
             EXISTS (SELECT 1 FROM public.community_series_features f
                      WHERE f.client_id = (w->>'client_id')::uuid AND f.featured_at >= v_month_start AND f.featured_at < v_post_end AND f.series_key <> v_key) ASC,
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
    WHEN v_prs >= 25 THEN (ARRAY['yall are cooking. ' || v_prs || ' PRs last week', 'big week. ' || v_prs || ' PRs between everyone last week'])[1 + v_wk % 2]
    WHEN v_prs >= 10 THEN (ARRAY['big week. ' || v_prs || ' PRs between everyone', 'last week was a good one. ' || v_prs || ' PRs across the crew'])[1 + v_wk % 2]
    WHEN v_n * 10 >= (v_stats->>'roster')::int * 6 THEN (ARRAY['most of the crew showed up last week', 'good week from this group'])[1 + v_wk % 2]
    ELSE (ARRAY['some wins from last week', 'few highlights from last week'])[1 + v_wk % 2] END;
  v_outro := (ARRAY[v_n || ' of you got after it last week. proud of this crew 🔥',
                    'thats the standard. lets go again this week',
                    'not on here yet? you will be. lets go',
                    'everyone who showed up last week built this. keep stacking'])[1 + v_wk % 4];

  IF v_prs >= 25 AND coalesce(array_length(v_hype, 1), 0) > 0 THEN
    -- its own beat: "thats craaazy!! big week", never "thats craaazy big week"
    v_hype_word := lower(v_hype[1 + v_wk % array_length(v_hype, 1)]);
    v_intro := v_hype_word || CASE WHEN v_hype_word ~ '[!?.]$' THEN ' ' ELSE '!! ' END || v_intro;
  END IF;
  IF v_prs >= 10 AND coalesce(array_length(v_emoji, 1), 0) > 0 THEN
    v_outro := regexp_replace(v_outro, '\s*🔥$', '') || ' ' || v_emoji[1 + v_wk % array_length(v_emoji, 1)];
  END IF;

  -- lowercase every week, the way he texts (names in the win lines keep their capitals)
  v_caption := v_intro || E'\n\n' || v_lines || E'\n\n' || v_outro;

  RETURN jsonb_build_object(
    'week_of', _week_start,
    'trainers', v_n,
    'featured', (SELECT jsonb_agg(jsonb_build_object('client_id', w->>'client_id', 'type', w->>'type')) FROM jsonb_array_elements(v_pick) w),
    'stats', v_stats,
    'caption', v_caption);
END;
$function$;
REVOKE ALL ON FUNCTION public.community_compose_wins(date, uuid) FROM PUBLIC, anon, authenticated;

-- ── Tuesday: the crew's numbers ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_compose_observation(_exclude_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- the hook is the question the numbers answer; the numbers come before anything "more" can hide
  v_caption := CASE v_best->>'observation'
    WHEN 'frequency' THEN
      'do the people who train more hit more PRs? I checked the last 8 weeks 📊' || E'\n\n'
      || 'the ' || (v_best->>'a') || ' of you training 3+ times a week hit about ' || (v_best->>'x') || ' PRs each. the other ' || (v_best->>'b') || ': about ' || (v_best->>'y') || E'\n\n'
      || 'its not proof. how long youve lifted & whats going on in life matter too. but more good reps at a lift is how you get better at it'
    WHEN 'consistency' THEN
      'does missing a week cost you PRs? I checked the last 8 weeks 📊' || E'\n\n'
      || 'the ' || (v_best->>'a') || ' of you who missed 1 week or less: about ' || (v_best->>'x') || ' PRs each. the ' || (v_best->>'b') || ' who missed 2+ weeks: about ' || (v_best->>'y') || E'\n\n'
      || 'its not proof, lots goes into it. but the ones who show up every week keep being the ones with the PRs'
    ELSE
      'slept under 5 hours? your workout reviews say the session feels it 📊' || E'\n\n'
      || 'those sessions got rated ' || (v_best->>'x') || '/5. the rest: ' || (v_best->>'y') || '/5. thats ' || (v_best->>'a') || ' sessions from ' || (v_best->>'people') || ' of you' || E'\n\n'
      || 'its a pattern, not proof. rough night? keep the top set honest & dont chase a PR that day' END;
  RETURN v_best || jsonb_build_object('caption', v_caption);
END;
$function$;
REVOKE ALL ON FUNCTION public.community_compose_observation(uuid) FROM PUBLIC, anon, authenticated;

-- ── Thursday: how the people who use a feature train ──────────────────────
CREATE OR REPLACE FUNCTION public.community_feature_stat(_data jsonb, _exclude_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c jsonb;
BEGIN
  IF _data IS NULL OR NOT (_data ? 'habit') THEN RETURN NULL; END IF;
  v_c := public.community_crew_compare(public.community_crew_outcomes(_exclude_user),
           _data->>'habit', (_data->>'min')::numeric, coalesce((_data->>'ratio')::boolean, false), coalesce(_data->>'outcome', 'spw'));
  IF v_c IS NULL THEN RETURN NULL; END IF;
  RETURN v_c || jsonb_build_object('line', CASE v_c->>'outcome'
    WHEN 'prs' THEN (v_c->>'a') || ' of you ' || (_data->>'doers') || '. those ' || (v_c->>'a') || ' hit about ' || (v_c->>'x') || ' PRs each the last 8 weeks. everyone else: about ' || (v_c->>'y')
    ELSE (v_c->>'a') || ' of you ' || (_data->>'doers') || '. those ' || (v_c->>'a') || ' trained about ' || (v_c->>'x') || ' times a week the last 8 weeks. everyone else: ' || (v_c->>'y') END
    || '. the app doesnt do it for you. the people who use it are just more locked in');
END;
$function$;
REVOKE ALL ON FUNCTION public.community_feature_stat(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ── Birthdays: the DM points to Crew ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_birthday_compose(_client_id uuid, _slot integer, _facts jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_since := ' since ' || lower(to_char(public.instant_to_local(v_first, coalesce(c.timezone, 'America/Winnipeg')), 'FMMonth'));
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
      || (ARRAY['does NOT miss 💪🔥🔥🔥', 'the consistency is crazy 💪', 'thats what showing up looks like 🔥🔥🔥'])[1 + k % 3];
  ELSIF v_prs >= 3 THEN
    v_mid := v_prs || ' PRs' || CASE WHEN v_lifts IS NOT NULL THEN ' on ' || v_lifts ELSE '' END || v_since || '. '
      || (ARRAY['getting stronger and it shows 💪', 'the strength is going up 🔥', 'proud of the work youve been putting in 🙌'])[1 + k % 3];
  ELSIF v_sessions >= 8 THEN
    v_mid := v_sessions || ' sessions' || v_since || '. ' || (ARRAY['showing up week after week 💪', 'love the consistency 🙌'])[1 + k % 2];
  ELSE
    v_mid := (ARRAY['so glad youre part of this crew 🙌', 'glad to have you in the crew 🙏'])[1 + k % 2];
  END IF;

  v_close := ARRAY[
    'enjoy today, eat the cake. then we go again',
    'hope today is a great one, enjoy it 🙌',
    'have the best day, you deserve it 🙏',
    'go enjoy your day, the gym can wait (for today) 🤣',
    'eat the cake. all of it 🤤'];
  v_dm := ARRAY[
    'happy birthday ' || coalesce(v_nick, v_name) || '!! 🎂 hope you have a good one today. posted a lil something for you on Crew 👀',
    'hbd ' || coalesce(v_nick, v_name) || ' 🥳 made you a lil post on Crew, go check it out 🙌',
    'happy birthday ' || coalesce(v_nick, v_name) || ' 🎉 enjoy your day! put a lil something up for you on Crew'];

  RETURN jsonb_build_object(
    'body', v_open[1 + k % 5] || E'\n\n' || v_mid || E'\n\n' || v_close[1 + (k * 2 + 1) % 5],
    'dm_body', v_dm[1 + k % 3]);
END;
$function$;
REVOKE ALL ON FUNCTION public.community_birthday_compose(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
