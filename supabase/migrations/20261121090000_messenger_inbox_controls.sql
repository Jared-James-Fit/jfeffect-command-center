-- Messenger, iMessage style: pins, Hide Alerts, Mark as Unread, Delete, a
-- real Block, and "New message" to someone in the community.
--
--   * chat_thread_prefs: your own settings for a chat. Only you can read or
--     write your rows, so nobody can tell you pinned, muted or deleted their
--     chat. thread_key is the chat's id (chat_groups.id), or 'coach' for a
--     client's chat with their coach (always first; it can't be muted or
--     deleted, only marked unread).
--       pinned_at  pinned (up to 8, under the coach)
--       muted      Hide Alerts: no pushes from this chat
--       hidden_at  Delete: off your list until someone writes again
--       unread_at  Mark as Unread: shows as new until you open it. It never
--                  touches your read marker, so the other side's "Seen"
--                  doesn't change.
--   * chat_user_blocks: Block is about the person, not one chat. Their 1:1
--     messages and group chat invites never reach you, and they're never
--     told: their side keeps looking like a request that hasn't been
--     answered (20261015090000_direct_message_requests.sql).
--   * chat_direct_start: "New message" to someone in the community. Exactly
--     the rules of replying to their post: it's a message request they can
--     read without you knowing, text only, 3 lines until they answer. A
--     person can open at most 10 new requests a day (post replies count
--     too), so nobody can cold-message the whole community.
--
-- Request and block state still only changes inside SECURITY DEFINER
-- functions (chat_direct_respond, community_message_author, chat_direct_start,
-- chat_block_person, crew_*), never through the tables.

-- ---------------------------------------------------------------------------
-- Your own chat settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_thread_prefs (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_key text NOT NULL CHECK (char_length(thread_key) BETWEEN 1 AND 64),
  pinned_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  hidden_at timestamptz,
  unread_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_key)
);
ALTER TABLE public.chat_thread_prefs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_thread_prefs TO authenticated;
GRANT ALL ON public.chat_thread_prefs TO service_role;
DROP POLICY IF EXISTS "chat_thread_prefs_own" ON public.chat_thread_prefs;
CREATE POLICY "chat_thread_prefs_own" ON public.chat_thread_prefs FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- Pins: 8 of your own under the coach (9 in all, like iMessage).
CREATE OR REPLACE FUNCTION public.chat_thread_prefs_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.thread_key = 'coach' THEN
    NEW.pinned_at := NULL;
    NEW.muted := false;
    NEW.hidden_at := NULL;
  END IF;
  IF NEW.pinned_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.pinned_at IS NULL)
     AND (SELECT count(*) FROM public.chat_thread_prefs p
           WHERE p.user_id = NEW.user_id AND p.pinned_at IS NOT NULL AND p.thread_key <> NEW.thread_key) >= 8 THEN
    RAISE EXCEPTION 'pin_limit';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_thread_prefs_guard ON public.chat_thread_prefs;
CREATE TRIGGER chat_thread_prefs_guard BEFORE INSERT OR UPDATE ON public.chat_thread_prefs
  FOR EACH ROW EXECUTE FUNCTION public.chat_thread_prefs_guard();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_thread_prefs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Block the person
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_user_blocks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_user_id),
  CHECK (user_id <> blocked_user_id)
);
ALTER TABLE public.chat_user_blocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.chat_user_blocks TO authenticated;
GRANT ALL ON public.chat_user_blocks TO service_role;
DROP POLICY IF EXISTS "chat_user_blocks_own" ON public.chat_user_blocks;
CREATE POLICY "chat_user_blocks_own" ON public.chat_user_blocks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Everyone already blocked in a 1:1 is blocked as a person.
INSERT INTO public.chat_user_blocks (user_id, blocked_user_id, created_at)
SELECT x.user_id, o.user_id, x.created_at
  FROM public.chat_direct_closed x
  JOIN public.chat_groups g ON g.id = x.group_id AND g.kind = 'direct'
  JOIN public.chat_group_members o ON o.group_id = g.id AND o.user_id <> x.user_id
 WHERE x.reason = 'blocked'
ON CONFLICT (user_id, blocked_user_id) DO NOTHING;

/** Has `_blocker` blocked `_other`? (Their invites, messages and community pings never reach them.) */
CREATE OR REPLACE FUNCTION public.chat_has_blocked(_blocker uuid, _other uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE b.user_id = _blocker AND b.blocked_user_id = _other)
      OR EXISTS (
        SELECT 1 FROM public.chat_groups g
          JOIN public.chat_direct_closed x ON x.group_id = g.id AND x.user_id = _blocker AND x.reason = 'blocked'
         WHERE g.direct_key = least(_blocker::text, _other::text) || ':' || greatest(_blocker::text, _other::text))
$$;

/** (internal) Block or unblock someone, silently. */
CREATE OR REPLACE FUNCTION public.chat_set_person_block(_me uuid, _other uuid, _on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dm uuid;
BEGIN
  IF _me IS NULL OR _other IS NULL OR _me = _other THEN RETURN; END IF;
  SELECT g.id INTO v_dm FROM public.chat_groups g
   WHERE g.direct_key = least(_me::text, _other::text) || ':' || greatest(_me::text, _other::text);
  IF _on THEN
    INSERT INTO public.chat_user_blocks (user_id, blocked_user_id) VALUES (_me, _other)
    ON CONFLICT (user_id, blocked_user_id) DO NOTHING;
    IF v_dm IS NOT NULL THEN
      INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (v_dm, _me, 'blocked')
      ON CONFLICT (group_id, user_id) DO UPDATE SET reason = 'blocked', created_at = now();
    END IF;
    -- Any group chat invite from them goes too (it reads "Invited" to them, as always).
    INSERT INTO public.chat_direct_closed (group_id, user_id, reason)
    SELECT m.group_id, _me, 'declined' FROM public.chat_group_members m
     WHERE m.user_id = _me AND m.status = 'invited' AND m.invited_by = _other
    ON CONFLICT (group_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.chat_user_blocks WHERE user_id = _me AND blocked_user_id = _other;
    IF v_dm IS NOT NULL THEN
      DELETE FROM public.chat_direct_closed WHERE group_id = v_dm AND user_id = _me AND reason = 'blocked';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_set_person_block(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

/** Block (or unblock) someone in the community. They're never told. */
CREATE OR REPLACE FUNCTION public.chat_block_person(_user_id uuid, _blocked boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR _user_id IS NULL OR _user_id = uid THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(_blocked, true) AND coalesce((public.community_author(_user_id)->>'is_coach')::boolean, false) THEN
    RAISE EXCEPTION 'Coaches can''t be blocked here. Tell your coach if something''s wrong.';
  END IF;
  PERFORM public.chat_set_person_block(uid, _user_id, coalesce(_blocked, true));
  RETURN jsonb_build_object('ok', true, 'blocked', coalesce(_blocked, true));
END;
$$;
REVOKE ALL ON FUNCTION public.chat_block_person(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_block_person(uuid, boolean) TO authenticated;

/** The people I've blocked (names the way the community shows them). */
CREATE OR REPLACE FUNCTION public.chat_blocked_people()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(public.community_author(b.blocked_user_id) || jsonb_build_object('blocked_at', b.created_at)
                            ORDER BY b.created_at DESC), '[]'::jsonb)
    FROM public.chat_user_blocks b
   WHERE b.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.chat_blocked_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_blocked_people() TO authenticated;

-- ---------------------------------------------------------------------------
-- Opening a 1:1 (shared by post replies and "New message")
-- ---------------------------------------------------------------------------
/** New people a person can start a request with in a day. */
CREATE OR REPLACE FUNCTION public.chat_request_daily_cap()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;
GRANT EXECUTE ON FUNCTION public.chat_request_daily_cap() TO authenticated, service_role;

/** (internal) The pair's chat, made as a request if it's new. Blocks apply silently. */
CREATE OR REPLACE FUNCTION public.chat_direct_open(_me uuid, _other uuid)
RETURNS public.chat_groups LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := least(_me::text, _other::text) || ':' || greatest(_me::text, _other::text);
  g public.chat_groups;
BEGIN
  SELECT * INTO g FROM public.chat_groups WHERE direct_key = v_key;
  IF NOT FOUND THEN
    IF (SELECT count(*) FROM public.chat_groups x
         WHERE x.kind = 'direct' AND x.requested_by = _me AND x.created_at > now() - interval '1 day') >= public.chat_request_daily_cap() THEN
      RAISE EXCEPTION 'request_daily_limit';
    END IF;
    INSERT INTO public.chat_groups (name, kind, direct_key, direct_status, requested_by, created_by)
    VALUES ('Direct message', 'direct', v_key, 'request', _me, _me)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO NOTHING;
  END IF;
  SELECT * INTO g FROM public.chat_groups WHERE direct_key = v_key FOR UPDATE;
  INSERT INTO public.chat_group_members (group_id, user_id, role, added_by)
  VALUES (g.id, _me, 'member', _me), (g.id, _other, 'member', _me)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  -- Writing to them again undoes your own "delete" or block.
  DELETE FROM public.chat_direct_closed WHERE group_id = g.id AND user_id = _me;
  DELETE FROM public.chat_user_blocks WHERE user_id = _me AND blocked_user_id = _other;
  -- They blocked you: it never reaches them, and looks like any unanswered request.
  IF EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE b.user_id = _other AND b.blocked_user_id = _me) THEN
    INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, _other, 'blocked')
    ON CONFLICT (group_id, user_id) DO UPDATE SET reason = 'blocked';
  END IF;

  IF g.direct_status = 'request' AND g.requested_by = _me
     AND (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.sender_id = _me) >= public.chat_request_cap() THEN
    RAISE EXCEPTION 'request_limit';
  END IF;
  RETURN g;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_direct_open(uuid, uuid) FROM PUBLIC, anon, authenticated;

/** "New message" to someone in the community: a request until they answer. */
CREATE OR REPLACE FUNCTION public.chat_direct_start(_user_id uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_body text := btrim(coalesce(_body, ''));
  g public.chat_groups;
  v_msg uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() OR NOT public.chat_community_ok(uid) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL OR _user_id = uid THEN RAISE EXCEPTION 'Pick someone to message'; END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'Write a message first'; END IF;
  IF char_length(v_body) > 2000 THEN RAISE EXCEPTION 'That message is too long'; END IF;
  IF coalesce((public.community_author(uid)->>'is_coach')::boolean, false) THEN
    RAISE EXCEPTION 'Message clients from your inbox';
  END IF;
  IF coalesce((public.community_author(_user_id)->>'is_coach')::boolean, false) THEN
    RAISE EXCEPTION 'Message your coach in your coach chat';
  END IF;
  IF NOT public.chat_community_ok(_user_id) THEN RAISE EXCEPTION 'They can''t get messages right now'; END IF;

  g := public.chat_direct_open(uid, _user_id);
  INSERT INTO public.group_messages (group_id, sender_id, sender_role, body, attachments)
  VALUES (g.id, uid, 'member', v_body, '[]'::jsonb)
  RETURNING id INTO v_msg;

  SELECT * INTO g FROM public.chat_groups WHERE id = g.id;
  RETURN jsonb_build_object('route', 'direct', 'group_id', g.id, 'message_id', v_msg, 'status', g.direct_status);
END;
$$;
REVOKE ALL ON FUNCTION public.chat_direct_start(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_direct_start(uuid, text) TO authenticated;

-- Reply to a post in Messenger: unchanged routing; the member-to-member part
-- now shares chat_direct_open (daily cap + person blocks).
CREATE OR REPLACE FUNCTION public.community_message_author(_post_id uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_body text := btrim(coalesce(_body, ''));
  p public.community_posts;
  v_author jsonb;
  v_me jsonb;
  v_card jsonb;
  v_client uuid;
  v_staff uuid;
  g public.chat_groups;
  v_msg uuid;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'Write a message first'; END IF;
  IF char_length(v_body) > 2000 THEN RAISE EXCEPTION 'That message is too long'; END IF;

  SELECT * INTO p FROM public.community_posts cp
   WHERE cp.id = _post_id AND cp.archived_at IS NULL
     AND public.community_post_visible(cp.visibility, cp.author_user_id, cp.client_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found'; END IF;

  v_author := public.community_author(p.author_user_id);
  v_me := public.community_author(uid);
  IF (v_author->>'user_id') = (v_me->>'user_id') THEN RAISE EXCEPTION 'That''s your own post'; END IF;

  -- The post rides along as a card that opens it.
  v_card := jsonb_build_object(
    'type', 'link', 'kind', 'community_post', 'post_id', p.id, 'reply', true,
    'url', '/portal/community#post=' || p.id,
    'name', v_author->>'name',
    'title', (v_author->>'name') || '''s post',
    'request_note', nullif(left(split_part(btrim(coalesce(p.caption, p.quote, '')), E'\n', 1), 140), ''),
    'thumb_path', coalesce(p.media_thumb_path, CASE WHEN p.media_type = 'image' THEN p.media_path END));

  IF (v_author->>'is_coach')::boolean AND (v_me->>'is_coach')::boolean THEN
    RAISE EXCEPTION 'You''re both coaches. Message them in team chat.';
  END IF;

  -- A coach's post: it goes to your own chat with your coach.
  IF (v_author->>'is_coach')::boolean THEN
    SELECT c.id INTO v_client FROM public.clients c
     WHERE c.user_id = uid AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_client IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, read_by_client_at)
    VALUES (v_client, uid, 'client', v_body, jsonb_build_array(v_card), 'General', now())
    RETURNING id INTO v_msg;
    RETURN jsonb_build_object('route', 'coach', 'message_id', v_msg, 'client_id', v_client);
  END IF;

  -- A coach answering a client's post: that client's coach chat.
  IF (v_me->>'is_coach')::boolean THEN
    SELECT a.id INTO v_staff FROM (
      SELECT uid AS id
      UNION SELECT public.community_main_account(uid)
      UNION SELECT cp.user_id FROM public.community_profiles cp WHERE cp.same_person_as = public.community_main_account(uid)
    ) a WHERE public.has_role(a.id, 'admin') OR public.has_role(a.id, 'coach')
    ORDER BY (a.id = uid) DESC LIMIT 1;
    v_client := coalesce(p.client_id, (SELECT c.id FROM public.clients c WHERE c.user_id = p.author_user_id ORDER BY c.created_at DESC LIMIT 1));
    IF v_staff IS NULL OR v_client IS NULL OR NOT (
         public.has_role(v_staff, 'admin')
         OR EXISTS (SELECT 1 FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
                     WHERE c.id = v_client AND co.user_id = v_staff AND co.archived = false AND co.status = 'Active')) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, read_by_admin_at)
    VALUES (v_client, v_staff, 'admin', v_body, jsonb_build_array(v_card), 'General', now())
    RETURNING id INTO v_msg;
    RETURN jsonb_build_object('route', 'client', 'message_id', v_msg, 'client_id', v_client);
  END IF;

  -- Client to client: a direct chat, starting as a request.
  IF NOT public.chat_community_ok(uid) OR NOT public.chat_community_ok(p.author_user_id) THEN
    RAISE EXCEPTION 'They can''t get messages right now';
  END IF;
  g := public.chat_direct_open(uid, p.author_user_id);

  INSERT INTO public.group_messages (group_id, sender_id, sender_role, body, attachments)
  VALUES (g.id, uid, 'member', v_body, jsonb_build_array(v_card))
  RETURNING id INTO v_msg;

  SELECT * INTO g FROM public.chat_groups WHERE id = g.id;
  RETURN jsonb_build_object('route', 'direct', 'group_id', g.id, 'message_id', v_msg, 'status', g.direct_status);
END;
$$;
REVOKE ALL ON FUNCTION public.community_message_author(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_message_author(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Accept / delete / block / report: Block and Report now block the person.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_direct_respond(_group_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  g public.chat_groups;
  v_other uuid;
  v_report uuid;
  v_other_name text;
  v_other_full text;
BEGIN
  SELECT * INTO g FROM public.chat_groups WHERE id = _group_id AND kind = 'direct' FOR UPDATE;
  IF NOT FOUND OR uid IS NULL OR NOT public.is_group_member(g.id, uid) THEN RAISE EXCEPTION 'Chat not found'; END IF;
  SELECT m.user_id INTO v_other FROM public.chat_group_members m WHERE m.group_id = g.id AND m.user_id <> uid LIMIT 1;

  IF _action = 'accept' THEN
    IF g.direct_status = 'request' AND g.requested_by IS DISTINCT FROM uid THEN
      UPDATE public.chat_groups SET direct_status = 'active', accepted_at = now() WHERE id = g.id;
    END IF;
    DELETE FROM public.chat_direct_closed WHERE group_id = g.id AND user_id = uid;
    DELETE FROM public.chat_user_blocks WHERE user_id = uid AND blocked_user_id = v_other;
    UPDATE public.chat_group_members SET last_read_at = now() WHERE group_id = g.id AND user_id = uid;
    RETURN jsonb_build_object('ok', true, 'status', 'active');
  END IF;

  IF _action = 'decline' THEN
    IF g.direct_status <> 'request' OR g.requested_by = uid THEN RAISE EXCEPTION 'There''s no request to delete'; END IF;
    INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'declined')
    ON CONFLICT (group_id, user_id) DO NOTHING;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF _action NOT IN ('block', 'report') THEN RAISE EXCEPTION 'Unknown action'; END IF;

  INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'blocked')
  ON CONFLICT (group_id, user_id) DO UPDATE SET reason = 'blocked', created_at = now();
  PERFORM public.chat_set_person_block(uid, v_other, true);
  IF _action = 'block' THEN RETURN jsonb_build_object('ok', true); END IF;

  v_other_name := coalesce(public.community_author(v_other)->>'name', 'Someone');
  SELECT coalesce(nullif(btrim(c.full_name), ''), v_other_name) INTO v_other_full
    FROM public.clients c WHERE c.user_id = v_other ORDER BY c.created_at DESC LIMIT 1;
  v_report := public.chat_file_report(g.id, uid, v_other, _reason,
    'a chat with ' || coalesce(v_other_full, v_other_name) || '. ' || v_other_name || '''s messages won''t reach them anymore');
  RETURN jsonb_build_object('ok', true, 'report_id', v_report);
END;
$$;
REVOKE ALL ON FUNCTION public.chat_direct_respond(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_direct_respond(uuid, text, text) TO authenticated, service_role;

-- Group chat invites: Block turns the invite down and blocks whoever sent it.
CREATE OR REPLACE FUNCTION public.crew_respond(_group_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  g public.chat_groups;
  v_st text;
  v_report uuid;
  v_people int;
  v_inviter uuid;
BEGIN
  SELECT * INTO g FROM public.chat_groups WHERE id = _group_id AND kind = 'crew' FOR UPDATE;
  v_st := public.chat_crew_status(_group_id, uid);
  IF g.id IS NULL OR uid IS NULL OR v_st IS NULL THEN RAISE EXCEPTION 'Chat not found'; END IF;
  PERFORM set_config('app.chat_rpc', 'on', true);

  IF _action = 'join' THEN
    IF v_st = 'invited' THEN
      UPDATE public.chat_group_members SET status = 'joined', joined_at = now(), last_read_at = now()
       WHERE group_id = g.id AND user_id = uid;
      DELETE FROM public.chat_request_reads WHERE group_id = g.id AND user_id = uid;
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 'joined');
  END IF;

  IF _action = 'decline' THEN
    IF v_st <> 'invited' THEN RAISE EXCEPTION 'There''s no invite to decline'; END IF;
    INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'declined')
    ON CONFLICT (group_id, user_id) DO NOTHING;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF _action = 'block' THEN
    IF v_st <> 'invited' THEN RAISE EXCEPTION 'There''s no invite to decline'; END IF;
    SELECT m.invited_by INTO v_inviter FROM public.chat_group_members m WHERE m.group_id = g.id AND m.user_id = uid;
    INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'declined')
    ON CONFLICT (group_id, user_id) DO NOTHING;
    IF v_inviter IS NOT NULL AND v_inviter <> uid
       AND NOT coalesce((public.community_author(v_inviter)->>'is_coach')::boolean, false) THEN
      PERFORM public.chat_set_person_block(uid, v_inviter, true);
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF _action = 'leave' THEN
    IF v_st <> 'joined' THEN RAISE EXCEPTION 'You''re not in this chat'; END IF;
    PERFORM public.chat_crew_drop_member(g.id, uid);
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF _action = 'report' THEN
    SELECT count(*) INTO v_people FROM public.chat_group_members WHERE group_id = g.id AND status = 'joined';
    v_report := public.chat_file_report(g.id, uid, NULL, _reason,
      'the group chat “' || g.name || '” (' || v_people || CASE WHEN v_people = 1 THEN ' person' ELSE ' people' END || ')'
      || CASE WHEN v_st = 'joined' THEN ' and left it' ELSE ' they were invited to' END);
    -- Out for good: a re-invite to this chat never reaches them.
    INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'blocked')
    ON CONFLICT (group_id, user_id) DO UPDATE SET reason = 'blocked', created_at = now();
    -- (an invite they reported stays "Invited" to the others until it runs out)
    IF v_st = 'joined' THEN PERFORM public.chat_crew_drop_member(g.id, uid); END IF;
    RETURN jsonb_build_object('ok', true, 'report_id', v_report);
  END IF;

  RAISE EXCEPTION 'Unknown action';
END;
$$;
REVOKE ALL ON FUNCTION public.crew_respond(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_respond(uuid, text, text) TO authenticated;

SELECT public.rls_evaluate_once('chat_thread_prefs');
SELECT public.rls_evaluate_once('chat_user_blocks');
