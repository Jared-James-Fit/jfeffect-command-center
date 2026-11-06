-- Live challenges: an event from draft to final results, with every role.
-- Run after schema.sql and the migration (see README.md). Stops at the first failure.
\set ON_ERROR_STOP 1
\set QUIET 1
SET client_min_messages = warning;

-- A helper to assert that a statement fails with a given message fragment.
CREATE OR REPLACE FUNCTION public.t_fails(p_sql text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT ILIKE '%' || p_like || '%' THEN
      RAISE EXCEPTION 'expected failure like "%" but got "%" for: %', p_like, SQLERRM, p_sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected failure like "%" but it worked: %', p_like, p_sql;
END $$;
GRANT EXECUTE ON FUNCTION public.t_fails(text, text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.t_ok(p boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_ok(boolean, text) TO anon, authenticated;

-- People
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'owner@jf.test', now()),
  ('00000000-0000-0000-0000-00000000000b', 'judge@jf.test', now()),
  ('00000000-0000-0000-0000-00000000000c', 'registrar@jf.test', now()),
  ('00000000-0000-0000-0000-00000000000d', 'random@jf.test', now()),
  ('00000000-0000-0000-0000-00000000000e', 'manager@jf.test', now());
INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000d', 'client');

-- 1. The seeded Winnipeg 225 is a draft: nobody outside sees it.
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.t_ok(public.challenge_page('winnipeg-225') IS NULL, 'draft hidden from the public');
SELECT public.t_ok(public.challenge_board('winnipeg-225') IS NULL, 'draft board hidden');
SELECT public.t_ok(jsonb_array_length(public.challenge_hub()) = 0, 'hub empty');
SELECT public.t_fails('SELECT * FROM public.challenges', 'permission denied');
SELECT public.t_fails('SELECT * FROM public.challenge_athlete_private', 'permission denied');
SELECT public.t_fails($q$SELECT public.challenge_record_attempt(gen_random_uuid(), 1, 'valid', gen_random_uuid())$q$, 'permission denied');
RESET ROLE;

-- 2. The owner sees and edits it; publishing needs a date and a venue.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT id AS cid FROM public.challenges WHERE slug = 'winnipeg-225' \gset
SELECT public.t_ok((public.challenge_page('winnipeg-225')->>'preview')::boolean, 'owner previews draft');
SELECT public.t_fails($q$SELECT public.challenge_set_status('$q$ || :'cid' || $q$', 'upcoming')$q$, 'a start date, a venue');
SELECT public.t_fails($q$UPDATE public.challenges SET status = 'live' WHERE slug = 'winnipeg-225'$q$, 'controls');
UPDATE public.challenges SET starts_at = now() + interval '1 hour', location_name = 'Test Gym', ends_at = now() + interval '6 hours' WHERE id = :'cid';
SELECT public.challenge_set_status(:'cid', 'upcoming');
SELECT public.t_ok((SELECT status FROM public.challenges WHERE id = :'cid') = 'upcoming', 'published');
-- staff
SELECT public.challenge_add_staff(:'cid', 'judge@jf.test', 'judge');
SELECT public.challenge_add_staff(:'cid', 'registrar@jf.test', 'registrar');
SELECT public.challenge_add_staff(:'cid', 'manager@jf.test', 'manager');
SELECT public.t_fails($q$SELECT public.challenge_add_staff('$q$ || :'cid' || $q$', 'nobody@jf.test', 'judge')$q$, 'No JF Effect login');
-- a second division to test division ranks
INSERT INTO public.challenge_divisions (challenge_id, name, sort) VALUES (:'cid', 'Women', 1);
SELECT id AS open_div FROM public.challenge_divisions WHERE challenge_id = :'cid' AND name = 'Open' \gset
SELECT id AS women_div FROM public.challenge_divisions WHERE challenge_id = :'cid' AND name = 'Women' \gset
INSERT INTO public.challenge_prizes (challenge_id, place, title, value_cents) VALUES (:'cid', 2, 'Runner-up shirt', 3000);
RESET ROLE;

-- 3. The public now sees it, never a contact detail.
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.t_ok(jsonb_array_length(public.challenge_hub()) = 1, 'hub lists it');
SELECT public.t_ok(public.challenge_page('winnipeg-225')->'challenge'->>'title' = 'Winnipeg 225 Bench Press Challenge', 'public page');
SELECT public.t_ok(public.challenge_page('winnipeg-225')->>'registration' = 'open', 'registration open');
-- self-registration: every box must be ticked
SELECT public.t_fails($q$SELECT public.challenge_self_register('winnipeg-225', '{"display_name":"Big Al","email":"al@x.test","division_id":"$q$ || :'open_div' || $q$","acks":["I''m 18 or older."]}')$q$, 'Every box');
SELECT public.t_fails($q$SELECT public.challenge_self_register('winnipeg-225', jsonb_build_object('display_name','Big Al','acks',(SELECT acknowledgments FROM public.challenges WHERE slug='winnipeg-225')))$q$, 'permission denied');
RESET ROLE;
-- (anon can't read challenges for the acks; the app sends the ack texts it was shown)
SELECT acknowledgments AS acks FROM public.challenges WHERE id = :'cid' \gset
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.challenge_self_register('winnipeg-225', jsonb_build_object('display_name','Big Al','full_name','Alan Smith','email','AL@x.test',
  'division_id', :'open_div', 'acks', :'acks'::jsonb, 'photo_consent', true, 'marketing', true, 'via', 'qr')) AS r1 \gset
SELECT public.t_ok((:'r1'::jsonb->>'bib')::int = 1, 'first bib is 1');
SELECT public.t_ok(:'r1'::jsonb->>'photo_nonce' IS NOT NULL, 'photo nonce issued with consent');
SELECT public.t_ok((public.challenge_self_register('winnipeg-225', jsonb_build_object('display_name','Someone Else','email','al@x.test',
  'division_id', :'open_div', 'acks', :'acks'::jsonb))->>'already')::boolean, 'same email = already registered');
SELECT public.t_fails(format('SELECT public.challenge_self_register(%L, %L::jsonb)', 'winnipeg-225', jsonb_build_object('display_name','No Email','acks', :'acks'::jsonb, 'division_id', :'open_div')), 'Add your email');
-- photo: only the nonce file, only into their own folder
SELECT public.t_ok(public.challenge_media_can_write('athletes/' || (:'r1'::jsonb->>'athlete_id') || '/' || (:'r1'::jsonb->>'photo_nonce') || '.jpg'), 'nonce upload allowed');
SELECT public.t_ok(NOT public.challenge_media_can_write('athletes/' || (:'r1'::jsonb->>'athlete_id') || '/abcdefgh12345678.jpg'), 'other file refused');
SELECT public.t_ok(NOT public.challenge_media_can_write('challenges/' || :'cid' || '/abcdefgh12345678.jpg'), 'anon cannot write covers');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name) VALUES ('challenge-media', 'athletes/' || (:'r1'::jsonb->>'athlete_id') || '/' || (:'r1'::jsonb->>'photo_nonce') || '.jpg');
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.challenge_set_athlete_photo((:'r1'::jsonb->>'athlete_id')::uuid, 'athletes/' || (:'r1'::jsonb->>'athlete_id') || '/' || (:'r1'::jsonb->>'photo_nonce') || '.jpg');
SELECT public.t_fails($q$SELECT public.challenge_set_athlete_photo('$q$ || (:'r1'::jsonb->>'athlete_id') || $q$', 'athletes/$q$ || (:'r1'::jsonb->>'athlete_id') || '/' || (:'r1'::jsonb->>'photo_nonce') || $q$.jpg')$q$, 'can''t be added');
RESET ROLE;

-- 4. Registration staff: can register, can't see contacts, can't judge.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
SET ROLE authenticated;
SELECT public.challenge_staff_register(:'cid', jsonb_build_object('display_name','Bea','full_name','Beatrice Jones','email','bea@x.test',
  'division_id', :'women_div', 'acks', :'acks'::jsonb, 'bodyweight_kg', 70, 'check_in', true)) AS r2 \gset
SELECT public.challenge_staff_register(:'cid', jsonb_build_object('display_name','Cal','email','cal@x.test',
  'division_id', :'open_div', 'acks', :'acks'::jsonb, 'bodyweight_kg', 90)) AS r3 \gset
SELECT public.challenge_staff_register(:'cid', jsonb_build_object('display_name','Dee','email','dee@x.test',
  'division_id', :'open_div', 'acks', :'acks'::jsonb, 'show_name', false)) AS r4 \gset
SELECT public.challenge_staff_register(:'cid', jsonb_build_object('display_name','Eve','email','eve@x.test',
  'division_id', :'open_div', 'acks', :'acks'::jsonb)) AS r5 \gset
SELECT public.t_ok((SELECT bool_and(x->'contact' = 'null'::jsonb) FROM jsonb_array_elements(public.challenge_console(:'cid')->'entries') x), 'registrar sees no contacts');
SELECT public.t_fails($q$SELECT public.challenge_participants('$q$ || :'cid' || $q$')$q$, 'contact details');
SELECT public.t_fails($q$SELECT public.challenge_record_attempt('$q$ || (:'r2'::jsonb->>'entry_id') || $q$', 10, 'valid', gen_random_uuid())$q$, 'judges');
SELECT public.t_fails($q$SELECT * FROM public.challenge_entries$q$, 'permission denied');
RESET ROLE;

-- 5. A random signed-in client: nothing.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
SET ROLE authenticated;
SELECT public.t_fails($q$SELECT public.challenge_console('$q$ || :'cid' || $q$')$q$, 'staff');
SELECT public.t_fails($q$SELECT public.challenge_set_status('$q$ || :'cid' || $q$', 'live')$q$, 'Only the owner');
SELECT public.t_ok((SELECT count(*) FROM public.challenges) = 0, 'client reads no challenge rows');
SELECT public.t_fails($q$UPDATE public.challenge_live SET version = 99$q$, 'permission denied');
RESET ROLE;

-- 6. The judge: nothing before it's live; then scores.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
SELECT public.t_fails($q$SELECT public.challenge_record_attempt('$q$ || (:'r2'::jsonb->>'entry_id') || $q$', 10, 'valid', gen_random_uuid())$q$, 'once the challenge is live');
SELECT public.t_fails($q$SELECT public.challenge_set_status('$q$ || :'cid' || $q$', 'live')$q$, 'Only the owner');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
SET ROLE authenticated;
SELECT public.challenge_set_status(:'cid', 'live');
SELECT public.t_fails($q$UPDATE public.challenges SET tiebreak = 'shared' WHERE id = '$q$ || :'cid' || $q$'$q$, 'locked');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
-- Al 18, Cal 18 (bw 90), Bea 18 (bw 70, Women), Dee 12 (hidden name), Eve no-lift
SELECT public.challenge_record_attempt((:'r1'::jsonb->>'entry_id')::uuid, 18, 'valid', '11111111-1111-1111-1111-111111111111') AS a1 \gset
SELECT public.t_ok((:'a1'::jsonb->>'rank')::int = 1, 'first score ranks 1');
SELECT public.t_ok((public.challenge_record_attempt((:'r1'::jsonb->>'entry_id')::uuid, 18, 'valid', '11111111-1111-1111-1111-111111111111')->>'duplicate')::boolean, 'retry is a duplicate, not a second attempt');
SELECT public.t_fails($q$SELECT public.challenge_record_attempt('$q$ || (:'r1'::jsonb->>'entry_id') || $q$', 19, 'valid', gen_random_uuid())$q$, 'attempt(s) are used');
SELECT public.t_fails($q$SELECT public.challenge_record_attempt('$q$ || (:'r3'::jsonb->>'entry_id') || $q$', 18.5, 'valid', gen_random_uuid())$q$, 'whole numbers');
SELECT public.challenge_record_attempt((:'r3'::jsonb->>'entry_id')::uuid, 18, 'valid', gen_random_uuid());
SELECT public.challenge_record_attempt((:'r2'::jsonb->>'entry_id')::uuid, 18, 'valid', gen_random_uuid());
SELECT public.challenge_record_attempt((:'r4'::jsonb->>'entry_id')::uuid, 12, 'valid', gen_random_uuid());
SELECT public.challenge_record_attempt((:'r5'::jsonb->>'entry_id')::uuid, 0, 'no_lift', gen_random_uuid());
RESET ROLE;

-- 7. Ranking: Al has no bodyweight, so the three-way tie at 18 can't be broken -> all 1st, Dee 4th.
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.challenge_board('winnipeg-225') AS b1 \gset
SELECT public.t_ok(jsonb_array_length(:'b1'::jsonb->'rows') = 4, 'four ranked (the no-lift is not on the board)');
SELECT public.t_ok((SELECT bool_and((x->>'rank')::int = 1 AND (x->>'tied')::boolean) FROM jsonb_array_elements(:'b1'::jsonb->'rows') x WHERE (x->>'score')::numeric = 18), 'tie shared when a bodyweight is missing');
SELECT public.t_ok((SELECT (x->>'rank')::int FROM jsonb_array_elements(:'b1'::jsonb->'rows') x WHERE (x->>'score')::numeric = 12) = 4, 'competition ranking skips to 4');
SELECT public.t_ok((SELECT x->>'name' FROM jsonb_array_elements(:'b1'::jsonb->'rows') x WHERE (x->>'score')::numeric = 12) = 'Athlete #4', 'hidden name shows as Athlete #bib');
SELECT public.t_ok((SELECT x->>'handle' FROM jsonb_array_elements(:'b1'::jsonb->'rows') x WHERE (x->>'score')::numeric = 12) IS NULL, 'hidden name has no handle');
SELECT public.t_ok(:'b1'::jsonb::text NOT ILIKE '%@x.test%' AND :'b1'::jsonb::text NOT ILIKE '%Alan Smith%', 'no contact details on the board');
SELECT public.t_ok((SELECT (x->>'division_rank')::int FROM jsonb_array_elements(:'b1'::jsonb->'rows') x WHERE x->>'name' = 'Bea') = 1, 'Bea leads Women');
RESET ROLE;
-- once Al's bodyweight is in, the published tie-break separates them: Bea (70) > Al (80) > Cal (90)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
SET ROLE authenticated;
SELECT public.challenge_update_entry((:'r1'::jsonb->>'entry_id')::uuid, '{"bodyweight_kg": 80}');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.challenge_board('winnipeg-225') AS b2 \gset
SELECT public.t_ok((SELECT string_agg(x->>'name' || ':' || (x->>'rank'), ',' ORDER BY (x->>'rank')::int) FROM jsonb_array_elements(:'b2'::jsonb->'rows') x) = 'Bea:1,Big Al:2,Cal:3,Athlete #4:4', 'bodyweight tie-break applied');
SELECT public.t_ok(public.challenge_result('winnipeg-225', :'r1'::jsonb->>'handle')->>'rank' = '2', 'result page rank');
SELECT public.t_ok(public.challenge_result('winnipeg-225', :'r4'::jsonb->>'handle') IS NULL, 'hidden athlete has no public result page');
RESET ROLE;

-- 8. Corrections are audited; voids need a reason.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
SELECT (x->'attempts'->0->>'id') AS cal_attempt FROM jsonb_array_elements(public.challenge_console(:'cid')->'entries') x WHERE x->>'name' = 'Cal' \gset
SELECT public.t_fails($q$SELECT public.challenge_correct_attempt('$q$ || :'cal_attempt' || $q$', 17, 'valid', '')$q$, 'Say why');
SELECT public.challenge_correct_attempt(:'cal_attempt', 17, 'valid', 'Rep 18 bounced');
SELECT public.t_fails($q$SELECT public.challenge_audit_list('$q$ || :'cid' || $q$')$q$, 'Not allowed');
RESET ROLE;
SELECT public.t_ok((SELECT count(*) FROM public.challenge_audit WHERE challenge_id = :'cid' AND action = 'correct' AND reason = 'Rep 18 bounced'
  AND actor = '00000000-0000-0000-0000-00000000000b') = 1, 'correction audited with reason and judge');

-- 9. Ending and final results.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.t_fails($q$SELECT public.challenge_finalize('$q$ || :'cid' || $q$', 1)$q$, 'End the challenge first');
SELECT public.challenge_set_status(:'cid', 'verifying');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
SELECT public.t_fails($q$SELECT public.challenge_record_attempt('$q$ || (:'r5'::jsonb->>'entry_id') || $q$', 3, 'valid', gen_random_uuid())$q$, 'Submissions are closed');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.t_fails($q$SELECT public.challenge_finalize('$q$ || :'cid' || $q$', 1)$q$, 'standings changed');
SELECT version AS v FROM public.challenge_live WHERE challenge_id = :'cid' \gset
SELECT public.challenge_finalize(:'cid', :'v');
SELECT public.t_ok((SELECT status FROM public.challenges WHERE id = :'cid') = 'completed', 'completed');
SELECT public.t_fails($q$SELECT public.challenge_correct_attempt('$q$ || :'cal_attempt' || $q$', 18, 'valid', 'changed my mind')$q$, 'Results are final');
SELECT public.t_ok(jsonb_array_length(public.challenge_awards_list(:'cid')) = 2, 'two prizes awarded');
SELECT public.t_fails($q$DELETE FROM public.challenges WHERE id = '$q$ || :'cid' || $q$'$q$, 'participants');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.challenge_page('winnipeg-225') AS p \gset
SELECT public.t_ok((SELECT x->>'name' FROM jsonb_array_elements(:'p'::jsonb->'winners') x WHERE (x->>'place')::int = 1) = 'Bea', 'Bea wins');
SELECT public.t_ok(:'p'::jsonb::text NOT ILIKE '%@x.test%', 'no contacts on the page');
SELECT public.t_ok((public.challenge_board('winnipeg-225')->>'final')::boolean, 'board is final');
RESET ROLE;

-- 10. A tie covering a prize place splits it: reopen, give Bea 17, so Al & Cal... (Al 18 alone now) -> make Cal 18 again with same bw as Al
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.challenge_reopen(:'cid', 'Judge review of Cal');
SELECT public.challenge_correct_attempt(:'cal_attempt', 18, 'valid', 'Video review: rep 18 was good');
SELECT public.challenge_update_entry((:'r3'::jsonb->>'entry_id')::uuid, '{"bodyweight_kg": 80}');
SELECT (x->'attempts'->0->>'id') AS bea_attempt FROM jsonb_array_elements(public.challenge_console(:'cid')->'entries') x WHERE x->>'name' = 'Bea' \gset
SELECT public.challenge_correct_attempt(:'bea_attempt', 17, 'valid', 'Rep 18 lost contact with bench');
SELECT version AS v FROM public.challenge_live WHERE challenge_id = :'cid' \gset
SELECT public.challenge_finalize(:'cid', :'v');
SELECT public.t_ok((SELECT string_agg(x->>'name' || ':' || (x->>'place') || ':' || (x->>'share'), ',' ORDER BY x->>'place', x->>'name')
  FROM jsonb_array_elements(public.challenge_awards_list(:'cid')) x) = 'Big Al:1:0.5000,Cal:1:0.5000,Big Al:2:0.5000,Cal:2:0.5000', 'tied 1st split prizes 1 and 2');
RESET ROLE;

-- 11. Analytics: deduped per visitor, staff don't count.
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.challenge_track('winnipeg-225', 'page_view', 'visitor-aaaa-1111', NULL, NULL, 'qr');
SELECT public.challenge_track('winnipeg-225', 'page_view', 'visitor-aaaa-1111', NULL, NULL, 'qr');
SELECT public.challenge_track('winnipeg-225', 'page_view', 'visitor-bbbb-2222', NULL, :'r1'::jsonb->>'handle', 'friend');
SELECT public.challenge_track('winnipeg-225', 'bogus', 'visitor-bbbb-2222');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.challenge_track('winnipeg-225', 'page_view', 'visitor-owner-333');
SELECT public.challenge_stats(:'cid') AS st \gset
SELECT public.t_ok((:'st'::jsonb->'events'->'page_view'->>'total')::int = 2, 'two page views counted');
SELECT public.t_ok((:'st'::jsonb->>'qr_visits')::int = 1, 'one qr visit');
SELECT public.t_ok((:'st'::jsonb->>'referral_visits')::int = 1, 'one referral visit');
SELECT public.t_ok((:'st'::jsonb->>'marketing')::int = 1, 'one marketing opt-in');
RESET ROLE;

-- 12. Claiming: a login confirmed with Al's email takes his profile.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a1', 'al@x.test');
SELECT public.t_ok((SELECT user_id FROM public.challenge_athletes WHERE id = (:'r1'::jsonb->>'athlete_id')::uuid) IS NULL, 'unconfirmed login does not claim');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT public.t_ok((SELECT user_id FROM public.challenge_athletes WHERE id = (:'r1'::jsonb->>'athlete_id')::uuid) = '00000000-0000-0000-0000-0000000000a1', 'confirmed login claims');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
SET ROLE authenticated;
SELECT public.t_ok(public.challenge_me()->>'email' = 'al@x.test', 'Al sees his own contact');
SELECT public.challenge_update_athlete((:'r1'::jsonb->>'athlete_id')::uuid, '{"display_name":"Al the Pal","discoverable":false}');
SELECT public.t_fails($q$SELECT public.challenge_update_athlete('$q$ || (:'r3'::jsonb->>'athlete_id') || $q$', '{"display_name":"hacked"}')$q$, 'Not allowed');
SELECT public.t_fails($q$SELECT public.challenge_correct_attempt('$q$ || :'cal_attempt' || $q$', 1, 'valid', 'sabotage')$q$, 'judges');
SELECT public.t_ok(public.challenge_athlete(:'r1'::jsonb->>'handle')->>'name' = 'Al the Pal', 'profile shows new name');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false) \gset _
SET ROLE anon;
SELECT public.t_ok((public.challenge_athlete(:'r1'::jsonb->>'handle')->>'listed')::boolean = false, 'unlisted profile flagged');
RESET ROLE;

-- 13. A new challenge from this one keeps the setup, not the people.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.challenge_duplicate(:'cid', 'Winnipeg 225 Round Two', 'winnipeg-225-round-two', false) AS c2 \gset
SELECT public.t_ok((SELECT status FROM public.challenges WHERE id = :'c2') = 'draft', 'copy is a draft');
SELECT public.t_ok((SELECT count(*) FROM public.challenge_divisions WHERE challenge_id = :'c2') = 2, 'divisions copied');
SELECT public.t_ok((SELECT count(*) FROM public.challenge_prizes WHERE challenge_id = :'c2') = 2, 'prizes copied');
DELETE FROM public.challenges WHERE id = :'c2';
SELECT public.t_ok(NOT EXISTS (SELECT 1 FROM public.challenges WHERE id = :'c2'), 'empty draft deletes cleanly');
RESET ROLE;

\echo ALL LIVE CHALLENGE TESTS PASSED
