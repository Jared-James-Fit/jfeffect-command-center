-- Leaderboard-first reads: paging, search, find-my-ranking, who's up, the
-- organizer's summary and the registration window. Run after schema.sql and
-- the three live-challenge migrations (see README.md).
\set ON_ERROR_STOP 1
\set QUIET 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION public.t_ok(p boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF; END $$;
CREATE OR REPLACE FUNCTION public.t_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
GRANT EXECUTE ON FUNCTION public.t_ok(boolean, text), public.t_err(text) TO anon, authenticated;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'owner@jf.test', now()),
  ('00000000-0000-0000-0000-00000000000b', 'judge@jf.test', now()),
  ('00000000-0000-0000-0000-00000000000c', 'desk@jf.test', now()),
  ('00000000-0000-0000-0000-00000000000d', 'rene@jf.test', now());
INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-00000000000a', 'admin');
SELECT id AS cid FROM public.challenges WHERE slug = 'winnipeg-225' \gset
SELECT acknowledgments AS acks FROM public.challenges WHERE slug = 'winnipeg-225' \gset

-- owner: publish, staff, 40 athletes with scores (ties included), one unscored
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset _
SET ROLE authenticated;
UPDATE public.challenges SET starts_at = now() + interval '1 day', venue_name = 'Test Gym' WHERE id = :'cid';
SELECT public.challenge_set_status(:'cid', 'upcoming') \gset _
SELECT public.challenge_add_staff(:'cid', 'judge@jf.test', 'judge') \gset _
SELECT public.challenge_add_staff(:'cid', 'desk@jf.test', 'registration') \gset _
SELECT public.challenge_register(:'cid', jsonb_build_object('public_name', 'René Côté', 'full_name', 'René Côté', 'email', 'rene@jf.test', 'acknowledged', :'acks'::jsonb)) \gset _
SELECT public.challenge_register(:'cid', jsonb_build_object('public_name', 'Jared M.', 'full_name', 'Jared McIntyre', 'email', 'jared@x.test', 'acknowledged', :'acks'::jsonb)) \gset _
SELECT count(*) FROM (SELECT public.challenge_register(:'cid', jsonb_build_object('public_name', 'Athlete ' || i, 'full_name', 'Athlete Number ' || i, 'email', 'a' || i || '@x.test', 'acknowledged', :'acks'::jsonb)) FROM generate_series(1, 40) i) q \gset _
SELECT public.challenge_register(:'cid', jsonb_build_object('public_name', 'Late Comer', 'full_name', 'Late Comer', 'email', 'late@x.test', 'acknowledged', :'acks'::jsonb)) \gset _
SELECT public.challenge_set_status(:'cid', 'live') \gset _
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) \gset _
SET ROLE authenticated;
-- Athlete i scores i reps (Athlete 10 and René tie on 10), Jared 45
SELECT count(*) FROM (SELECT public.challenge_record_attempt(e.id, (regexp_replace(e.public_name, '\D', '', 'g'))::int, true, gen_random_uuid())
  FROM public.challenge_entries e WHERE e.public_name LIKE 'Athlete %') q \gset _
SELECT public.challenge_record_attempt((SELECT id FROM public.challenge_entries WHERE public_name = 'René Côté'), 10, true, gen_random_uuid()) \gset _
SELECT public.challenge_record_attempt((SELECT id FROM public.challenge_entries WHERE public_name = 'Jared M.'), 45, true, gen_random_uuid()) \gset _
RESET ROLE;

SELECT share_code AS rene FROM public.challenge_entries WHERE public_name = 'René Côté' \gset
SELECT share_code AS late FROM public.challenge_entries WHERE public_name = 'Late Comer' \gset
SELECT share_code AS jared FROM public.challenge_entries WHERE public_name = 'Jared M.' \gset

-- the public, signed out
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.challenge_board_page('winnipeg-225', NULL, 0, 10) AS p1 \gset
SELECT public.t_ok((:'p1'::jsonb ->> 'total')::int = 42, 'total ranked 42 (unscored not ranked)');
SELECT public.t_ok(jsonb_array_length(:'p1'::jsonb -> 'rows') = 10, 'page of 10');
SELECT public.t_ok((:'p1'::jsonb -> 'rows' -> 0 ->> 'name') = 'Jared M.', 'leader first');
SELECT public.t_ok(jsonb_array_length(:'p1'::jsonb -> 'recent') > 0, 'recent on first page');
SELECT public.t_ok(position('@x.test' IN :'p1'::text) = 0 AND position('bodyweight' IN :'p1'::text) = 0, 'no email or bodyweight on the board');
SELECT public.challenge_board_page('winnipeg-225', NULL, 40, 10) AS p5 \gset
SELECT public.t_ok(jsonb_array_length(:'p5'::jsonb -> 'rows') = 2 AND (:'p5'::jsonb -> 'recent') = '[]'::jsonb, 'last page');
-- search: capitals, accents, a typo, a bib, the unscored
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', 'rene cote') -> 0 ->> 'name') = 'René Côté', 'accents and capitals forgiven');
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', 'JARED') -> 0 ->> 'name') = 'Jared M.', 'capitals forgiven');
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', 'jraed') -> 0 ->> 'name') = 'Jared M.', 'a typo forgiven');
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', 'jard') -> 0 ->> 'name') = 'Jared M.', 'a missing letter forgiven');
SELECT public.t_ok(public.t_err('SELECT public._challenge_words_match(''a'', ''b'')') LIKE '%permission denied%', 'internal helpers are not callable');
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', 'rene  côte') -> 0 ->> 'name') = 'René Côté', 'extra spaces and a half-accent forgiven');
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', '#2') -> 0 ->> 'bib')::int = 2, 'a bib number finds that athlete first');
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', 'late') -> 0 ->> 'rank') IS NULL, 'registered but unscored is found, unranked');
SELECT public.t_ok(jsonb_array_length(public.challenge_board_find('winnipeg-225', 'zzzz')) = 0, 'no match is empty');
SELECT public.t_ok((public.challenge_board_find('winnipeg-225', 'athlete 1') -> 0 ->> 'name') = 'Athlete 1', 'exact name first among many');
SELECT public.t_ok(position('@x.test' IN public.challenge_board_find('winnipeg-225', 'a')::text) = 0, 'search carries no email');
-- around: René is tied 32nd with Athlete 10 (Jared and Athletes 11-40 above)
SELECT public.challenge_board_around('winnipeg-225', :'rene', NULL, 2) AS ar \gset
SELECT public.t_ok((:'ar'::jsonb -> 'me' ->> 'place')::int = 32 AND (:'ar'::jsonb -> 'me' ->> 'shared')::boolean, 'tied place for René');
SELECT public.t_ok((:'ar'::jsonb -> 'next' ->> 'score')::numeric = 11, 'next place up is 11 reps, never the tie');
SELECT public.t_ok(jsonb_array_length(:'ar'::jsonb -> 'rows') = 5, 'two above and two below');
SELECT public.t_ok((:'ar'::jsonb ->> 'total')::int = 42, 'of 42');
SELECT public.t_ok((public.challenge_board_around('winnipeg-225', :'late', NULL, 2) -> 'me' ->> 'rank') IS NULL, 'unscored: no place');
SELECT public.t_ok(public.challenge_board_around('winnipeg-225', 'nosuchcode', NULL, 2) IS NULL, 'unknown code');
SELECT public.t_ok(public.challenge_board_around('winnipeg-225', :'jared', NULL, 2) -> 'next' = 'null'::jsonb, 'the leader has no next place');
-- who's up: the public can't set it, sees nothing until a judge does
SELECT public.t_ok(public.t_err(format('SELECT public.challenge_set_now(%L, NULL, NULL)', :'cid')) LIKE '%permission denied%', 'anon cannot set who is up');
SELECT public.t_ok(public.challenge_now_public('winnipeg-225') IS NULL, 'nobody up yet');
SELECT public.t_ok(public.t_err(format('SELECT public.challenge_dashboard(%L)', :'cid')) LIKE '%permission denied%', 'anon cannot read the dashboard');
RESET ROLE;

-- registration staff can't call someone up; a judge can, and counts
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) \gset _
SET ROLE authenticated;
SELECT public.t_ok(public.t_err(format('SELECT public.challenge_set_now(%L, %L, 1)', :'cid', (SELECT id FROM public.challenge_entries WHERE public_name = 'Late Comer'))) LIKE '%not_allowed%', 'registration staff cannot set who is up');
SELECT public.t_ok((public.challenge_dashboard(:'cid') ->> 'registered')::int = 43, 'registration staff sees the summary');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) \gset _
SET ROLE authenticated;
SELECT public.challenge_set_now(:'cid', (SELECT id FROM public.challenge_entries WHERE public_name = 'Late Comer'), NULL) \gset _
SELECT public.challenge_set_now(:'cid', (SELECT id FROM public.challenge_entries WHERE public_name = 'Late Comer'), 7) \gset _
SELECT public.t_ok(public.t_err(format('SELECT public.challenge_set_now(%L, %L, -1)', :'cid', (SELECT id FROM public.challenge_entries WHERE public_name = 'Late Comer'))) LIKE '%out of range%', 'count range checked');
SELECT public.challenge_dashboard(:'cid') AS dash \gset
SELECT public.t_ok((:'dash'::jsonb ->> 'scored')::int = 42 AND (:'dash'::jsonb ->> 'waiting')::int = 0, 'dashboard counts');
SELECT public.t_ok((:'dash'::jsonb -> 'leaders' -> 0 ->> 'name') = 'Jared M.', 'dashboard leader');
SELECT public.t_ok(jsonb_array_length(:'dash'::jsonb -> 'recent') = 12 AND (:'dash'::jsonb -> 'recent' -> 0 ->> 'name') IS NOT NULL, 'recent activity named');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.t_ok((public.challenge_now_public('winnipeg-225') ->> 'name') = 'Late Comer' AND (public.challenge_now_public('winnipeg-225') ->> 'live_value')::numeric = 7, 'the public sees who is up and the count');
SELECT public.t_ok(public.t_err('UPDATE public.challenge_now SET live_value = 99') LIKE '%permission denied%', 'nobody writes the table directly');
RESET ROLE;
UPDATE public.challenge_now SET updated_at = now() - interval '20 minutes';
SET ROLE anon;
SELECT public.t_ok(public.challenge_now_public('winnipeg-225') IS NULL, 'a stale call-up disappears');
RESET ROLE;

-- the registration window (self sign-up only) and the viewer's own entry
UPDATE public.challenges SET registration_closes_at = now() - interval '1 minute', registration_opens_at = now() - interval '1 day' WHERE id = :'cid';
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SELECT set_config('request.headers', '{"x-forwarded-for":"198.51.100.4"}', false) \gset _
SET ROLE anon;
SELECT public.t_ok(public.t_err(format('SELECT public.challenge_register(%L, %L::jsonb)', :'cid', jsonb_build_object('public_name','Too Late','full_name','Too Late','email','toolate@x.test','acknowledged',:'acks'::jsonb)::text)) LIKE '%closed%', 'closed registration refuses self sign-up');
SELECT public.t_ok(NOT (public.challenge_public('winnipeg-225') ->> 'registration_open')::boolean, 'page says registration is closed');
SELECT public.t_ok(public.challenge_public('winnipeg-225') -> 'my_code' = 'null'::jsonb, 'signed out: no own entry');
RESET ROLE;
SELECT set_config('request.headers', '', false) \gset _
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) \gset _
SET ROLE authenticated;
SELECT public.t_ok((public.challenge_register(:'cid', jsonb_build_object('public_name','Walk In','full_name','Walk In','email','walkin@x.test','acknowledged',:'acks'::jsonb)) ->> 'bib') IS NOT NULL, 'staff can still register after the window');
RESET ROLE;
UPDATE public.challenge_people SET user_id = '00000000-0000-0000-0000-00000000000d' WHERE id = (SELECT person_id FROM public.challenge_entries WHERE public_name = 'René Côté');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false) \gset _
SET ROLE authenticated;
SELECT public.t_ok((public.challenge_public('winnipeg-225') ->> 'my_code') = :'rene', 'signed-in athlete gets their own entry code');
RESET ROLE;

SELECT public.t_ok(NOT public._challenge_words_match('james', 'jared m.'), 'james is not jared');
SELECT public.t_ok(public._challenge_words_match('mcintire', 'jared mcintyre'), 'mcintire is mcintyre');
SELECT public.t_ok(public._challenge_words_match('jraed m', 'jared m.'), 'swapped letters plus a second word');

-- scoring locks once a published board has verified scores; words don't
SELECT public.t_ok(public.t_err(format('UPDATE public.challenges SET measure = ''weight'', unit = ''lb'' WHERE id = %L', :'cid')) LIKE '%Scoring is locked%', 'scoring locked under a live board');
SELECT public.t_ok(public.t_err(format('UPDATE public.challenges SET tiebreak = ''shared'' WHERE id = %L', :'cid')) LIKE '%Scoring is locked%', 'tie rule locked under a live board');
SELECT public.t_ok(public.t_err(format('UPDATE public.challenges SET tagline = ''New line'', rules = ''["One"]''::jsonb WHERE id = %L', :'cid')) = 'ok', 'words still editable');
INSERT INTO public.challenges (slug, title, activity, measure, direction, unit) VALUES ('practice-only', 'Practice only', 'Bench', 'reps', 'higher', 'reps');
SELECT public.t_ok(public.t_err('UPDATE public.challenges SET measure = ''time'', unit = ''s'', direction = ''lower'' WHERE slug = ''practice-only''') = 'ok', 'a draft can change scoring');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset _
SET ROLE authenticated;
SELECT public.t_ok((SELECT count(*) FROM jsonb_array_elements(public.challenge_dashboard(:'cid') -> 'recent') x
  WHERE x ->> 'action' = 'record' AND (x ->> 'value') IS NOT NULL AND x ->> 'name' IS NOT NULL) > 0, 'dashboard scores carry the value and the athlete');
RESET ROLE;

-- clearing the platform is per athlete: another judge's athlete stays up
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) \gset _
SET ROLE authenticated;
SELECT public.challenge_set_now(:'cid', (SELECT id FROM public.challenge_entries WHERE public_name = 'Late Comer'), 3) \gset _
SELECT public.challenge_clear_now(:'cid', (SELECT id FROM public.challenge_entries WHERE public_name = 'Jared M.')) \gset _
SELECT public.t_ok((public.challenge_now_public('winnipeg-225') ->> 'name') = 'Late Comer', 'clearing someone else leaves the athlete up');
SELECT public.challenge_clear_now(:'cid', (SELECT id FROM public.challenge_entries WHERE public_name = 'Late Comer')) \gset _
SELECT public.t_ok(public.challenge_now_public('winnipeg-225') IS NULL, 'clearing your athlete takes them down');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) \gset _
SET ROLE authenticated;
SELECT public.t_ok(public.t_err(format('SELECT public.challenge_clear_now(%L, NULL)', :'cid')) LIKE '%not_allowed%', 'registration staff cannot clear the platform');
RESET ROLE;

\echo ALL LEADERBOARD TESTS PASSED
