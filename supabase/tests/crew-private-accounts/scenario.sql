-- Crew private accounts, Close Friends, counts, follow requests and DMs, as
-- four people: Pia (private member), Fred (her follower), Stan (a stranger)
-- and Coach Cole, plus Jay (a coach whose athlete login is his main account).
-- Runs in one transaction and rolls back. Needs a database built from every
-- migration (see README). Fails loudly on the first wrong answer.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE SCHEMA t;
CREATE FUNCTION t.as_user(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION t.ok(_c boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _c IS NOT TRUE THEN
    -- psql -v soft=on (SET t.soft = 'on') lists every failure instead of stopping at the first
    IF current_setting('t.soft', true) = 'on' THEN RAISE WARNING 'FAILED: %', _msg; RETURN; END IF;
    RAISE EXCEPTION 'FAILED: %', _msg;
  END IF;
  RAISE NOTICE 'ok  %', _msg;
END $$;
CREATE FUNCTION t.member(_name text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u, lower(_name) || '@crew.test');
  INSERT INTO public.clients (user_id, full_name, first_name, status) VALUES (u, _name || ' Test', _name, 'Active');
  RETURN u;
END $$;
CREATE FUNCTION t.coach(_name text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE u uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u, lower(_name) || '@crew.test');
  INSERT INTO public.user_roles (user_id, role) VALUES (u, 'coach');
  INSERT INTO public.coaches (user_id, full_name, first_name, email, status) VALUES (u, _name || ' Coach', _name, lower(_name) || '@crew.test', 'Active');
  RETURN u;
END $$;
-- post ids in someone's feed (optionally one author's profile grid)
CREATE FUNCTION t.feed(_uid uuid, _author uuid DEFAULT NULL) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_user(_uid);
  r := public.community_feed(30, NULL, NULL, _author);
  RETURN ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(r->'posts') x);
END $$;
CREATE FUNCTION t.can_open(_uid uuid, _post uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(_uid);
  RETURN public.community_post(_post) IS NOT NULL;
EXCEPTION WHEN others THEN RETURN false;
END $$;
CREATE FUNCTION t.vis(_post uuid) RETURNS text LANGUAGE sql AS $$ SELECT visibility FROM public.community_posts WHERE id = _post $$;
-- a finished session for this client (its Pulse posts itself)
CREATE FUNCTION t.session(_client_user uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c uuid; b uuid; w uuid; d uuid; pc uuid;
BEGIN
  SELECT id INTO c FROM public.clients WHERE user_id = _client_user;
  INSERT INTO public.pl_blocks (client_id, name) VALUES (c, 'Block') RETURNING id INTO b;
  INSERT INTO public.pl_weeks (block_id, week_index) VALUES (b, 1) RETURNING id INTO w;
  INSERT INTO public.pl_days (week_id, day_index, title) VALUES (w, 1, 'Squat day') RETURNING id INTO d;
  INSERT INTO public.pl_day_completions (day_id, client_id, completed_at) VALUES (d, c, now()) RETURNING id INTO pc;
  RETURN pc;
END $$;

GRANT USAGE ON SCHEMA t TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

DO $$
DECLARE
  pia uuid := t.member('Pia');
  fred uuid := t.member('Fred');
  stan uuid := t.member('Stan');
  vic uuid := t.member('Vic');
  cole uuid := t.coach('Cole');
  jay uuid := t.coach('Jay');
  jay_athlete uuid := t.member('Jay');
  early uuid; crew uuid; cf uuid; pulse uuid; wpost uuid; vcf uuid; who uuid; i int; s1 uuid; s2 uuid; st jsonb; prof jsonb; g jsonb; n jsonb;
BEGIN
  INSERT INTO public.community_profiles (user_id, same_person_as) VALUES (jay, jay_athlete);

  -- ── Pia posts publicly, then goes private ─────────────────────────────
  PERFORM t.as_user(pia);
  early := (public.community_create_post('first post, still public', NULL, 'community')->>'id')::uuid;
  PERFORM t.ok(t.vis(early) = 'community', 'a public account''s crew post is community');
  PERFORM t.ok(early = ANY (t.feed(stan)), 'stranger sees a public account''s post');

  PERFORM t.as_user(pia);
  st := public.community_set_private(true);
  PERFORM t.ok((st->>'is_private')::boolean, 'Pia is private');
  PERFORM t.ok(t.vis(early) = 'followers', 'going private re-stamps old crew posts to followers');
  PERFORM t.ok(NOT early = ANY (t.feed(stan)), 'stranger loses the old post');

  PERFORM t.as_user(pia);
  crew := (public.community_create_post('for my followers', NULL, 'community')->>'id')::uuid;
  cf := (public.community_create_post('close friends only', NULL, 'close_friends')->>'id')::uuid;
  PERFORM t.ok(t.vis(crew) = 'followers', 'private account: the crew choice is stored as followers');
  PERFORM t.ok(t.vis(cf) = 'close_friends', 'close friends stays close friends');

  s1 := t.session(pia);
  SELECT id INTO pulse FROM public.community_posts WHERE completion_id = s1;
  PERFORM t.ok(pulse IS NOT NULL AND t.vis(pulse) = 'community', 'a private account''s automatic Pulse stays crew-wide');

  -- ── Stranger and would-be follower before any approval ────────────────
  PERFORM t.ok(pulse = ANY (t.feed(stan)) AND NOT crew = ANY (t.feed(stan)) AND NOT cf = ANY (t.feed(stan)), 'stranger: Pulse only');
  PERFORM t.ok(NOT t.can_open(stan, crew) AND NOT t.can_open(stan, cf) AND t.can_open(stan, pulse), 'stranger can''t open followers / CF posts by id');
  PERFORM t.as_user(stan);
  prof := public.community_profile(pia);
  PERFORM t.ok((prof->>'is_private')::boolean AND NOT (prof->>'can_see')::boolean, 'stranger: profile says private, can''t see');
  PERFORM t.ok(public.community_follow_list(pia, 'followers') = '[]'::jsonb, 'stranger: follower list hidden');
  BEGIN PERFORM public.community_react(crew, 'fire'); PERFORM t.ok(false, 'stranger reacted to a followers post');
  EXCEPTION WHEN raise_exception THEN PERFORM t.ok(true, 'stranger can''t react to a followers post'); END;
  BEGIN PERFORM public.community_add_comment(cf, 'hey', NULL, NULL); PERFORM t.ok(false, 'stranger commented on a CF post');
  EXCEPTION WHEN raise_exception THEN PERFORM t.ok(true, 'stranger can''t comment on a CF post'); END;

  -- RLS on the table itself (PostgREST reads as 'authenticated')
  PERFORM t.as_user(stan);
  SET LOCAL ROLE authenticated;
  PERFORM t.ok((SELECT count(*) FROM public.community_posts WHERE author_user_id = pia) = 1, 'RLS: stranger reads only the Pulse');
  RESET ROLE;

  -- ── Follow → request → bell → confirm ─────────────────────────────────
  PERFORM t.as_user(fred);
  st := public.community_follow(pia, true);
  PERFORM t.ok(st->'requested' ? pia::text AND NOT st->'following' ? pia::text, 'Fred''s follow is a request');
  PERFORM t.ok(NOT crew = ANY (t.feed(fred)), 'a pending request sees nothing new');
  PERFORM t.as_user(pia);
  st := public.community_follow_state();
  PERFORM t.ok(st->'requests' ? fred::text, 'Pia sees Fred''s request');
  n := public.community_my_notifications();
  PERFORM t.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(n) x WHERE x->>'kind' = 'follow_request' AND x->>'anchor' = fred::text), 'bell/Activity: Fred requested to follow you');
  PERFORM t.as_user(fred);
  PERFORM public.community_follow(pia, false);
  PERFORM t.as_user(pia);
  PERFORM t.ok(NOT public.community_follow_state()->'requests' ? fred::text, 'cancelling a request takes it away');
  PERFORM t.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.community_my_notifications()) x WHERE x->>'kind' = 'follow_request'), '... and its bell line');
  PERFORM t.as_user(fred);
  PERFORM public.community_follow(pia, true);
  PERFORM t.as_user(pia);
  st := public.community_follow_respond(fred, true);
  PERFORM t.ok(st->'followers' ? fred::text AND NOT st->'requests' ? fred::text, 'Pia confirms Fred');
  PERFORM t.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.community_my_notifications()) x WHERE x->>'kind' = 'follow_request'), 'the request line leaves the bell once answered');

  PERFORM t.ok(crew = ANY (t.feed(fred)) AND early = ANY (t.feed(fred)) AND NOT cf = ANY (t.feed(fred)), 'follower: followers posts, not CF');
  PERFORM t.ok(crew = ANY (t.feed(fred, pia)), 'follower: profile grid has them');
  PERFORM t.ok(NOT crew = ANY (t.feed(stan, pia)) AND pulse = ANY (t.feed(stan, pia)), 'stranger: profile grid is the Pulse only');
  PERFORM t.ok(crew = ANY (t.feed(cole)) AND cf = ANY (t.feed(cole)) AND pulse = ANY (t.feed(cole)), 'coach sees every client post (followers + CF)');

  -- Delete is silent and Stan can ask again
  PERFORM t.as_user(stan);
  PERFORM public.community_follow(pia, true);
  PERFORM t.as_user(pia);
  PERFORM public.community_follow_respond(stan, false);
  PERFORM t.as_user(stan);
  st := public.community_follow_state();
  PERFORM t.ok(NOT st->'requested' ? pia::text AND NOT st->'following' ? pia::text, 'a deleted request just goes back to Follow');
  PERFORM t.ok(NOT EXISTS (SELECT 1 FROM public.community_notifications WHERE recipient_user_id = stan), 'Stan is never told');

  -- ── Close Friends ──────────────────────────────────────────────────────
  PERFORM t.as_user(pia);
  st := public.community_set_close_friend(fred, true);
  PERFORM t.ok(st->'close_friends' ? fred::text, 'Fred on Pia''s Close Friends');
  PERFORM t.ok(cf = ANY (t.feed(fred)) AND t.can_open(fred, cf), 'close friend sees the CF post');
  PERFORM t.ok(NOT cf = ANY (t.feed(stan)), 'stranger still doesn''t');
  PERFORM t.as_user(fred);
  PERFORM public.community_react(cf, 'fire');
  PERFORM t.ok(EXISTS (SELECT 1 FROM public.community_reactions WHERE post_id = cf AND user_id = fred), 'close friend can react');

  -- a public account's Close Friends: the list is enough, a block ends it
  PERFORM t.as_user(vic);
  vcf := (public.community_create_post('vic close friends', NULL, 'close_friends')->>'id')::uuid;
  PERFORM public.community_set_close_friend(stan, true);
  PERFORM t.ok(vcf = ANY (t.feed(stan)), 'public account: a close friend who doesn''t follow still sees it');
  PERFORM t.ok(NOT vcf = ANY (t.feed(fred)), '... nobody else does');
  PERFORM t.as_user(vic);
  PERFORM public.chat_block_person(stan, true);
  PERFORM t.ok(NOT vcf = ANY (t.feed(stan)), 'public account: blocking a close friend cuts it');
  PERFORM t.as_user(vic);
  PERFORM public.chat_block_person(stan, false);

  -- ── Counts and lists ───────────────────────────────────────────────────
  PERFORM t.as_user(stan);
  prof := public.community_profile(pia);
  PERFORM t.ok((prof->>'followers')::int = 1 AND (prof->>'following')::int = 0, 'counts show on a private profile (1 follower, 0 following)');
  PERFORM t.as_user(fred);
  prof := public.community_profile(pia);
  PERFORM t.ok((prof->>'can_see')::boolean, 'follower can see the private profile');
  PERFORM t.ok(jsonb_array_length(public.community_follow_list(pia, 'followers')) = 1
               AND public.community_follow_list(pia, 'followers')->0->>'user_id' = fred::text, 'follower opens the followers list');
  PERFORM t.as_user(fred);
  PERFORM t.ok(jsonb_array_length(public.community_follow_list(fred, 'following')) = 1, 'own following list');

  -- ── DMs and story replies ─────────────────────────────────────────────
  -- Pia writes to Fred: Fred follows Pia, so it opens straight away
  PERFORM t.as_user(pia);
  g := public.chat_direct_start(fred, 'hey Fred');
  PERFORM t.ok(g->>'status' = 'active', 'DM to someone who follows you opens a chat');
  -- Fred replies to Pia's story: Pia doesn't follow Fred, so it's a request
  PERFORM t.as_user(fred);
  g := public.community_message_author(early, 'nice', true);
  PERFORM t.ok(g->>'status' = 'active', 'Fred''s reply lands in the chat Pia already opened with him');
  -- Stan replies to Pia's (public) Pulse: a request
  PERFORM t.as_user(stan);
  g := public.community_message_author(pulse, 'big session', true);
  PERFORM t.ok(g->>'status' = 'request', 'a stranger''s story reply is a request');
  -- Vic is someone Pia follows: his story reply opens a chat straight away
  PERFORM t.as_user(pia);
  PERFORM public.community_follow(vic, true);
  PERFORM t.as_user(vic);
  g := public.community_message_author(pulse, 'lets go', true);
  PERFORM t.ok(g->>'status' = 'active', 'a story reply from someone you follow opens a chat');

  -- ── Remove follower, block ────────────────────────────────────────────
  PERFORM t.as_user(pia);
  st := public.community_remove_follower(fred);
  PERFORM t.ok(NOT st->'followers' ? fred::text, 'Pia removes Fred');
  PERFORM t.ok(NOT crew = ANY (t.feed(fred)), 'a removed follower loses followers posts');
  PERFORM t.ok(NOT cf = ANY (t.feed(fred)), 'a removed follower loses CF posts on a private account (still on the list)');
  PERFORM t.as_user(fred);
  PERFORM public.community_follow(pia, true);
  PERFORM t.ok(public.community_follow_state()->'requested' ? pia::text, 'a removed follower can ask again');
  PERFORM t.as_user(pia);
  PERFORM public.community_follow_respond(fred, true);
  PERFORM t.ok(crew = ANY (t.feed(fred)), 'approved again');
  PERFORM t.as_user(pia);
  PERFORM public.chat_block_person(fred, true);
  PERFORM t.ok(NOT crew = ANY (t.feed(fred)) AND NOT cf = ANY (t.feed(fred)), 'blocking a follower cuts their access');
  PERFORM t.as_user(pia);
  PERFORM public.chat_block_person(fred, false);
  PERFORM t.ok(crew = ANY (t.feed(fred)), 'unblocking gives it back');

  -- ── League points: a private account sharing a workout still earns ────
  s2 := t.session(pia);
  PERFORM t.as_user(pia);
  PERFORM public.community_save_post(s2, 'heavy day', 'community');
  PERFORM t.ok((SELECT visibility FROM public.community_posts WHERE completion_id = s2) = 'followers', 'shared session stored for followers');
  PERFORM t.ok(EXISTS (SELECT 1 FROM public.athlete_xp_events e JOIN public.clients c ON c.id = e.client_id
                        WHERE c.user_id = pia AND e.event_type = 'community_post'), 'private account earns the day''s post points');

  -- ── Edit / archive keep the right audience ────────────────────────────
  SELECT id INTO wpost FROM public.community_posts WHERE completion_id = s2;
  PERFORM t.as_user(pia);
  PERFORM public.community_edit_post(wpost, 'heavy day', 'close_friends', NULL);
  PERFORM t.ok(t.vis(wpost) = 'close_friends', 'edit a workout post to Close friends');
  PERFORM public.community_edit_post(wpost, 'heavy day', 'community', NULL);
  PERFORM t.ok(t.vis(wpost) = 'followers', 'edit back to the crew choice stores followers');
  PERFORM public.community_archive_post(early, true);
  PERFORM t.ok(t.vis(early) = 'private' AND (SELECT archived_from FROM public.community_posts WHERE id = early) = 'followers', 'archived (remembers followers)');

  -- ── Coaches stay public ───────────────────────────────────────────────
  PERFORM t.as_user(cole);
  BEGIN PERFORM public.community_set_private(true); PERFORM t.ok(false, 'a coach went private');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t.ok(true, 'a coach can''t go private'); END;
  PERFORM t.as_user(jay_athlete);
  BEGIN PERFORM public.community_set_private(true); PERFORM t.ok(false, 'a coach''s linked athlete login went private');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t.ok(true, 'a coach''s linked athlete login can''t go private either'); END;

  -- ── The daily request cap only counts real requests ───────────────────
  FOR i IN 1..11 LOOP
    who := t.member('Fan' || i);
    PERFORM t.as_user(who);
    PERFORM public.community_follow(pia, true);
    PERFORM t.as_user(pia);
    PERFORM public.community_follow_respond(who, true);
    g := public.chat_direct_start(who, 'thanks for the follow');
  END LOOP;
  PERFORM t.ok(g->>'status' = 'active', 'eleven new chats to followers in a day: no requests, no daily cap');
  BEGIN
    FOR i IN 1..11 LOOP
      who := t.member('Cold' || i);
      PERFORM t.as_user(stan);
      PERFORM public.chat_direct_start(who, 'hi');
    END LOOP;
    PERFORM t.ok(false, 'cold requests went past the daily cap');
  EXCEPTION WHEN raise_exception THEN PERFORM t.ok(SQLERRM = 'request_daily_limit', 'cold requests still stop at the daily cap');
  END;

  -- ── A coach's posts stay crew-wide even if the flag were ever set ─────
  UPDATE public.community_profiles SET is_private = true WHERE user_id = jay_athlete;
  IF NOT FOUND THEN INSERT INTO public.community_profiles (user_id, is_private) VALUES (jay_athlete, true); END IF;
  PERFORM t.as_user(jay_athlete);
  who := (public.community_create_post('coach jay', NULL, 'community')->>'id')::uuid;
  PERFORM t.ok(t.vis(who) = 'community', 'a coach''s linked login never posts followers-only');

  -- ── Private → public ──────────────────────────────────────────────────
  PERFORM t.as_user(stan);
  PERFORM public.community_follow(pia, false);
  PERFORM public.community_follow(pia, true);
  PERFORM t.as_user(pia);
  st := public.community_set_private(false);
  PERFORM t.ok(NOT (st->>'is_private')::boolean, 'Pia is public again');
  PERFORM t.ok(t.vis(crew) = 'community' AND t.vis(wpost) = 'community', 'followers posts flip back to community');
  PERFORM t.ok(t.vis(pulse) = 'community', 'the Pulse never moved');
  PERFORM t.ok((SELECT archived_from FROM public.community_posts WHERE id = early) = 'community', 'an archived post''s audience flips too');
  PERFORM t.ok(t.vis(cf) = 'close_friends', 'Close Friends posts stay Close Friends');
  PERFORM t.ok(st->'followers' ? stan::text AND NOT st->'requests' ? stan::text, 'going public approves the waiting request');
  PERFORM t.ok(NOT EXISTS (SELECT 1 FROM public.community_notifications WHERE recipient_user_id = pia AND kind = 'follow_request'), '... and clears its bell line');
  PERFORM t.ok(crew = ANY (t.feed(stan)), 'Stan sees the old followers post as a crew post');
  PERFORM t.as_user(pia);
  PERFORM public.community_archive_post(early, false);
  PERFORM t.ok(t.vis(early) = 'community', 'restoring an archived post lands on the crew');

  RAISE NOTICE 'ALL CREW PRIVATE-ACCOUNT CHECKS PASSED';
END $$;
ROLLBACK;
