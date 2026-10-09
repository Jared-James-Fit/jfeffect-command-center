-- Group chats members start themselves (chat_groups.kind = 'crew').
--
-- Same idea as message requests (20261015090000_direct_message_requests.sql):
--   - Being added is an INVITE. You see the chat (who's in it, what's been
--     said) before deciding, and looking never shows as "Seen".
--   - Join, or Decline. Declining is silent: to everyone else you still show
--     as "Invited", exactly like someone who hasn't opened it, until the
--     invite runs out (14 days) and drops off for everyone.
--   - Everyone in the chat can see who's in it and who's invited, and anyone
--     who's joined can invite more people (up to 30 in a chat).
--   - Whoever started it can remove people. That's silent too: the chat just
--     disappears from their list, the same as a chat that was deleted. No
--     "you were removed", no message to the others.
--   - Leaving is quiet (you drop off the list). Report leaves, keeps you out
--     of that chat for good, and drops a copy into your coach chat as a
--     staff-only note.
--   - Private to the people in it, like DMs: coaches don't see them.
--
-- Rides on the group chat tables, so it gets the same thread, voice notes,
-- reactions, realtime and pushes.

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_groups DROP CONSTRAINT IF EXISTS chat_groups_kind_check;
ALTER TABLE public.chat_groups ADD CONSTRAINT chat_groups_kind_check CHECK (kind IN ('group', 'direct', 'crew'));
ALTER TABLE public.chat_groups DROP CONSTRAINT IF EXISTS chat_groups_direct_shape;
ALTER TABLE public.chat_groups ADD CONSTRAINT chat_groups_direct_shape CHECK (
  (kind IN ('group', 'crew') AND direct_key IS NULL AND direct_status IS NULL)
  OR (kind = 'direct' AND direct_key IS NOT NULL AND direct_status IN ('request', 'active')));

ALTER TABLE public.chat_group_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'joined',
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz;
ALTER TABLE public.chat_group_members DROP CONSTRAINT IF EXISTS chat_group_members_status_check;
ALTER TABLE public.chat_group_members ADD CONSTRAINT chat_group_members_status_check CHECK (status IN ('invited', 'joined'));

-- (chat_direct_closed also holds a person's own "declined" / "blocked" for a
-- crew: same rule, only they can read their row.)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_crew_invite_days()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 14 $$;

CREATE OR REPLACE FUNCTION public.chat_crew_cap()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 30 $$;

CREATE OR REPLACE FUNCTION public.chat_kind(_group_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.kind FROM public.chat_groups g WHERE g.id = _group_id
$$;

/** Where I stand in a member-made group: 'joined', 'invited' (a live invite I haven't turned down), or null. */
CREATE OR REPLACE FUNCTION public.chat_crew_status(_group_id uuid, _uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.chat_direct_closed x WHERE x.group_id = m.group_id AND x.user_id = m.user_id) THEN NULL
    WHEN m.status = 'joined' THEN 'joined'
    WHEN m.status = 'invited' AND m.invited_at > now() - make_interval(days => public.chat_crew_invite_days()) THEN 'invited'
  END
    FROM public.chat_group_members m
   WHERE m.group_id = _group_id AND m.user_id = _uid
$$;

/** Has `_blocker` blocked `_other` in their 1:1 chat? Their invites then never reach them. */
CREATE OR REPLACE FUNCTION public.chat_has_blocked(_blocker uuid, _other uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_groups g
      JOIN public.chat_direct_closed x ON x.group_id = g.id AND x.user_id = _blocker AND x.reason = 'blocked'
     WHERE g.direct_key = least(_blocker::text, _other::text) || ':' || greatest(_blocker::text, _other::text))
$$;

CREATE OR REPLACE FUNCTION public.chat_can_see(_group_id uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND coalesce((
    SELECT CASE g.kind
      WHEN 'direct' THEN public.is_group_member(g.id, _uid)
           AND public.chat_community_ok(_uid)
           AND NOT EXISTS (SELECT 1 FROM public.chat_direct_closed x WHERE x.group_id = g.id AND x.user_id = _uid)
      WHEN 'crew' THEN public.chat_community_ok(_uid) AND public.chat_crew_status(g.id, _uid) IS NOT NULL
      ELSE public.user_is_active(_uid)
           AND (public.is_coach_or_admin(_uid) OR public.is_group_member(g.id, _uid)) END
      FROM public.chat_groups g WHERE g.id = _group_id), false)
$$;

CREATE OR REPLACE FUNCTION public.chat_can_post(_group_id uuid, _uid uuid, _attachments jsonb DEFAULT '[]'::jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.chat_groups;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  SELECT * INTO g FROM public.chat_groups WHERE id = _group_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF g.kind = 'group' THEN
    RETURN public.user_is_active(_uid)
       AND (public.is_coach_or_admin(_uid)
            OR (public.is_group_member(g.id, _uid) AND g.archived = false AND g.permission_mode = 'everyone'));
  END IF;
  IF g.kind = 'crew' THEN
    -- Joined members only: an invite is look, don't touch.
    RETURN public.chat_community_ok(_uid) AND public.chat_crew_status(g.id, _uid) = 'joined';
  END IF;
  IF NOT public.chat_can_see(g.id, _uid) THEN RETURN false; END IF;
  IF g.direct_status = 'active' OR _uid IS DISTINCT FROM g.requested_by THEN RETURN true; END IF;
  RETURN (jsonb_typeof(_attachments) = 'array' AND jsonb_array_length(_attachments) = 0)
     AND (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.sender_id = _uid) < public.chat_request_cap();
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_can_react(_message_id uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT public.chat_can_see(m.group_id, _uid) AND CASE g.kind
             WHEN 'direct' THEN g.direct_status = 'active'
             WHEN 'crew' THEN public.chat_crew_status(g.id, _uid) = 'joined'
             ELSE true END
      FROM public.group_messages m JOIN public.chat_groups g ON g.id = m.group_id
     WHERE m.id = _message_id), false)
$$;

-- Managing through the tables is for coach-run groups only; member-made chats
-- change through the functions below.
CREATE OR REPLACE FUNCTION public.can_manage_group(_group_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.chat_kind(_group_id), 'group') = 'group' AND (
    public.has_role(_user_id, 'admin'::app_role)
    OR public.is_group_admin(_group_id, _user_id)
    OR EXISTS (SELECT 1 FROM public.chat_groups WHERE id = _group_id AND created_by = _user_id)
    OR EXISTS (SELECT 1 FROM public.coaches WHERE user_id = _user_id AND archived = false AND status = 'Active'))
$$;

GRANT EXECUTE ON FUNCTION public.chat_crew_invite_days() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_crew_cap() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_kind(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_crew_status(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_has_blocked(uuid, uuid) TO authenticated, service_role;

-- Leaving a member-made chat goes through crew_respond (it hands over the chat if you started it).
DROP POLICY IF EXISTS "chat_group_members_delete" ON public.chat_group_members;
CREATE POLICY "chat_group_members_delete" ON public.chat_group_members FOR DELETE TO authenticated
  USING (public.can_manage_group(group_id, auth.uid())
         OR (user_id = auth.uid() AND coalesce(public.chat_kind(group_id), 'group') = 'group'));

-- Names in member-made chats are the community's (first name, community photo).
CREATE OR REPLACE FUNCTION public.get_group_member_profiles(_group_id uuid)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.chat_can_see(_group_id, auth.uid()) THEN RETURN; END IF;
  IF coalesce(public.chat_kind(_group_id), 'group') <> 'group' THEN
    RETURN QUERY
    SELECT gm.user_id, a->>'name', a->>'avatar_url', gm.role::text
      FROM public.chat_group_members gm, LATERAL public.community_author(gm.user_id) a
     WHERE gm.group_id = _group_id;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT gm.user_id,
         COALESCE(p.full_name, c.full_name, co.full_name, 'Member') AS full_name,
         COALESCE(p.avatar_url, c.profile_picture_url) AS avatar_url,
         gm.role::text
    FROM public.chat_group_members gm
    LEFT JOIN public.profiles p ON p.id = gm.user_id
    LEFT JOIN public.clients c ON c.user_id = gm.user_id
    LEFT JOIN public.coaches co ON co.user_id = gm.user_id
   WHERE gm.group_id = _group_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
-- Members only touch their own read marker. Invites and joins only change
-- through the functions below (they set app.chat_rpc). While a DM request
-- or a crew invite is unanswered, the reader's read time is kept privately.
CREATE OR REPLACE FUNCTION public.chat_members_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.chat_groups;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.chat_rpc', true), '') <> 'on' THEN
    NEW.group_id := OLD.group_id;
    NEW.user_id := OLD.user_id;
    NEW.status := OLD.status;
    NEW.invited_by := OLD.invited_by;
    NEW.invited_at := OLD.invited_at;
    NEW.joined_at := OLD.joined_at;
    IF NOT public.can_manage_group(OLD.group_id, auth.uid()) THEN
      NEW.role := OLD.role;
      NEW.added_by := OLD.added_by;
      NEW.added_at := OLD.added_at;
    END IF;
  END IF;
  SELECT * INTO g FROM public.chat_groups WHERE id = OLD.group_id;
  IF ((g.kind = 'direct' AND g.direct_status <> 'active' AND OLD.user_id IS DISTINCT FROM g.requested_by)
      OR (g.kind = 'crew' AND NEW.status = 'invited'))
     AND NEW.last_read_at IS DISTINCT FROM OLD.last_read_at THEN
    IF NEW.last_read_at IS NOT NULL THEN
      INSERT INTO public.chat_request_reads (group_id, user_id, read_at)
      VALUES (OLD.group_id, OLD.user_id, NEW.last_read_at)
      ON CONFLICT (group_id, user_id) DO UPDATE SET read_at = greatest(public.chat_request_reads.read_at, EXCLUDED.read_at);
    END IF;
    NEW.last_read_at := OLD.last_read_at;
  END IF;
  RETURN NEW;
END;
$$;

-- New message: member-made chats move to the top; a DM request answered is a chat.
CREATE OR REPLACE FUNCTION public.chat_direct_after_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.chat_groups g
     SET direct_status = CASE WHEN g.kind = 'direct' AND g.direct_status = 'request' AND NEW.sender_id IS NOT NULL
                                   AND NEW.sender_id IS DISTINCT FROM g.requested_by THEN 'active' ELSE g.direct_status END,
         accepted_at = CASE WHEN g.kind = 'direct' AND g.direct_status = 'request' AND NEW.sender_id IS NOT NULL
                                 AND NEW.sender_id IS DISTINCT FROM g.requested_by THEN now() ELSE g.accepted_at END,
         updated_at = now()
   WHERE g.id = NEW.group_id AND g.kind <> 'group';
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reports (shared by DMs and member-made chats)
-- ---------------------------------------------------------------------------
/** Keep the last 20 messages and put them in the reporter's coach chat as a staff-only note. */
CREATE OR REPLACE FUNCTION public.chat_file_report(_group_id uuid, _reporter uuid, _reported uuid, _reason text, _what text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap jsonb;
  v_client uuid;
  v_report uuid;
  v_note uuid;
  v_me text := coalesce(public.community_author(_reporter)->>'name', 'They');
  v_lines text;
  v_reason text := nullif(btrim(coalesce(_reason, '')), '');
BEGIN
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) INTO v_snap FROM (
    SELECT jsonb_build_object(
             'at', m.created_at, 'from', m.sender_id,
             'name', coalesce(public.community_author(m.sender_id)->>'name', 'Someone'),
             'body', left(m.body, 1000),
             'kinds', coalesce((SELECT jsonb_agg(a->>'kind') FILTER (WHERE a->>'kind' IS NOT NULL)
                                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) a), '[]'::jsonb)) AS x
      FROM public.group_messages m
     WHERE m.group_id = _group_id AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 20) s;

  SELECT c.id INTO v_client FROM public.clients c WHERE c.user_id = _reporter AND coalesce(c.archived, false) = false
   ORDER BY c.created_at DESC LIMIT 1;

  INSERT INTO public.chat_reports (group_id, reporter_id, reported_id, reporter_client_id, reason, snapshot)
  VALUES (_group_id, _reporter, _reported, v_client, v_reason, v_snap)
  RETURNING id INTO v_report;

  IF v_client IS NOT NULL THEN
    SELECT string_agg(
             (x->>'name') || ' · ' || to_char((x->>'at')::timestamptz AT TIME ZONE 'America/Winnipeg', 'Mon FMDD, FMHH12:MI AM') || E'\n'
             || coalesce(nullif(x->>'body', ''),
                         CASE WHEN (x->'kinds') ? 'community_post' THEN '(shared a post)' ELSE '(sent a photo or file)' END),
             E'\n\n' ORDER BY x->>'at')
      INTO v_lines FROM jsonb_array_elements(v_snap) x;
    -- An internal note: only staff see it (and it doesn't count as them writing in).
    INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, is_internal_note)
    VALUES (v_client, _reporter, 'client',
            '🚩 ' || v_me || ' reported ' || _what || E'.\nNobody in it was told.'
            || CASE WHEN v_reason IS NOT NULL THEN E'\n\nWhy: ' || v_reason ELSE '' END
            || E'\n\nLast ' || jsonb_array_length(v_snap) || CASE WHEN jsonb_array_length(v_snap) = 1 THEN ' message' ELSE ' messages' END
            || E':\n\n' || coalesce(v_lines, '(no messages)'),
            '[]'::jsonb, 'General', true)
    RETURNING id INTO v_note;
    UPDATE public.chat_reports SET note_message_id = v_note WHERE id = v_report;
  END IF;
  RETURN v_report;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_file_report(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Member-made chats
-- ---------------------------------------------------------------------------
/** Invite people (internal): skips coaches, people already in it, and anyone past the cap. */
CREATE OR REPLACE FUNCTION public.chat_crew_add_invites(_group_id uuid, _by uuid, _users uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid;
  m public.chat_group_members;
  v_count int;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('app.chat_rpc', 'on', true);
  FOR u IN SELECT DISTINCT x FROM unnest(coalesce(_users, '{}'::uuid[])) x LOOP
    CONTINUE WHEN u IS NULL OR u = _by OR NOT public.chat_community_ok(u)
             OR coalesce((public.community_author(u)->>'is_coach')::boolean, false);
    SELECT count(*) INTO v_count FROM public.chat_group_members gm
     WHERE gm.group_id = _group_id
       AND (gm.status = 'joined' OR gm.invited_at > now() - make_interval(days => public.chat_crew_invite_days()));
    EXIT WHEN v_count >= public.chat_crew_cap();
    SELECT * INTO m FROM public.chat_group_members WHERE group_id = _group_id AND user_id = u;
    IF FOUND THEN
      CONTINUE WHEN m.status = 'joined' OR m.invited_at > now() - make_interval(days => public.chat_crew_invite_days());
      UPDATE public.chat_group_members SET invited_by = _by, invited_at = now() WHERE group_id = _group_id AND user_id = u;
    ELSE
      INSERT INTO public.chat_group_members (group_id, user_id, role, status, invited_by, invited_at, added_by)
      VALUES (_group_id, u, 'member', 'invited', _by, now(), _by);
    END IF;
    -- They blocked the person inviting them: it never reaches them (and
    -- looks like any unanswered invite to everyone else).
    IF public.chat_has_blocked(u, _by) THEN
      INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (_group_id, u, 'declined')
      ON CONFLICT (group_id, user_id) DO NOTHING;
    END IF;
    v_out := v_out || to_jsonb(u);
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_crew_add_invites(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

/** Start a group chat and invite people. No name = their first names. */
CREATE OR REPLACE FUNCTION public.crew_create(_name text, _invite uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(_name, '')), '');
  g public.chat_groups;
  v_inv jsonb;
BEGIN
  IF NOT public.chat_community_ok(uid) OR coalesce((public.community_author(uid)->>'is_coach')::boolean, false) THEN
    RAISE EXCEPTION 'Group chats here are for members' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 60 THEN RAISE EXCEPTION 'Keep the name under 60 characters'; END IF;
  IF coalesce(array_length(_invite, 1), 0) = 0 THEN RAISE EXCEPTION 'Pick at least one person'; END IF;

  INSERT INTO public.chat_groups (name, kind, created_by, permission_mode)
  VALUES (coalesce(v_name, 'Group chat'), 'crew', uid, 'everyone')
  RETURNING * INTO g;
  PERFORM set_config('app.chat_rpc', 'on', true);
  INSERT INTO public.chat_group_members (group_id, user_id, role, status, joined_at, added_by)
  VALUES (g.id, uid, 'member', 'joined', now(), uid);
  v_inv := public.chat_crew_add_invites(g.id, uid, _invite);
  IF jsonb_array_length(v_inv) = 0 THEN RAISE EXCEPTION 'None of them can be added'; END IF;

  -- "Amanda, Dwayne, Vicky +2"
  IF v_name IS NULL THEN
    UPDATE public.chat_groups SET name = left(
      (SELECT string_agg(s.n, ', ' ORDER BY s.o) FROM (
         SELECT public.community_author(uid)->>'name' AS n, 0::bigint AS o
         UNION ALL
         SELECT public.community_author(x.v::uuid)->>'name', x.o
           FROM jsonb_array_elements_text(v_inv) WITH ORDINALITY x(v, o) WHERE x.o <= 2) s)
      || CASE WHEN jsonb_array_length(v_inv) > 2 THEN ' +' || (jsonb_array_length(v_inv) - 2) ELSE '' END, 60)
     WHERE id = g.id;
  END IF;
  RETURN jsonb_build_object('group_id', g.id, 'invited', v_inv);
END;
$$;
REVOKE ALL ON FUNCTION public.crew_create(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_create(text, uuid[]) TO authenticated;

/** Anyone who's joined can invite more people. */
CREATE OR REPLACE FUNCTION public.crew_invite(_group_id uuid, _users uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.chat_kind(_group_id) IS DISTINCT FROM 'crew' OR public.chat_crew_status(_group_id, uid) IS DISTINCT FROM 'joined'
     OR NOT public.chat_community_ok(uid) THEN
    RAISE EXCEPTION 'Chat not found';
  END IF;
  RETURN jsonb_build_object('invited', public.chat_crew_add_invites(_group_id, uid, _users));
END;
$$;
REVOKE ALL ON FUNCTION public.crew_invite(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_invite(uuid, uuid[]) TO authenticated;

/** Hand the chat to whoever's been in it longest; nobody left = it's gone. */
CREATE OR REPLACE FUNCTION public.chat_crew_drop_member(_group_id uuid, _uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next uuid;
BEGIN
  DELETE FROM public.chat_group_members WHERE group_id = _group_id AND user_id = _uid;
  DELETE FROM public.chat_request_reads WHERE group_id = _group_id AND user_id = _uid;
  IF EXISTS (SELECT 1 FROM public.chat_groups WHERE id = _group_id AND created_by = _uid) THEN
    SELECT m.user_id INTO v_next FROM public.chat_group_members m
     WHERE m.group_id = _group_id AND m.status = 'joined'
     ORDER BY m.joined_at NULLS LAST, m.added_at LIMIT 1;
    IF v_next IS NULL THEN
      DELETE FROM public.chat_groups WHERE id = _group_id;
    ELSE
      UPDATE public.chat_groups SET created_by = v_next WHERE id = _group_id;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.chat_group_members m WHERE m.group_id = _group_id AND m.status = 'joined') THEN
    DELETE FROM public.chat_groups WHERE id = _group_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_crew_drop_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

/** join | decline | leave | report. */
CREATE OR REPLACE FUNCTION public.crew_respond(_group_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  g public.chat_groups;
  v_st text;
  v_report uuid;
  v_people int;
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

/** Whoever started it removes someone (or takes back an invite). Silent: it just disappears for them. */
CREATE OR REPLACE FUNCTION public.crew_remove(_group_id uuid, _user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_groups g WHERE g.id = _group_id AND g.kind = 'crew' AND g.created_by = uid)
     OR public.chat_crew_status(_group_id, uid) IS DISTINCT FROM 'joined' THEN
    RAISE EXCEPTION 'Only the person who started this chat can remove people';
  END IF;
  IF _user_id = uid THEN RAISE EXCEPTION 'Use Leave to leave'; END IF;
  DELETE FROM public.chat_group_members WHERE group_id = _group_id AND user_id = _user_id;
  DELETE FROM public.chat_request_reads WHERE group_id = _group_id AND user_id = _user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.crew_remove(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_remove(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crew_rename(_group_id uuid, _name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_name text := nullif(btrim(coalesce(_name, '')), '');
BEGIN
  IF v_name IS NULL OR char_length(v_name) > 60 THEN RAISE EXCEPTION 'Names are 1 to 60 characters'; END IF;
  UPDATE public.chat_groups SET name = v_name
   WHERE id = _group_id AND kind = 'crew' AND created_by = uid AND public.chat_crew_status(_group_id, uid) = 'joined';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the person who started this chat can rename it'; END IF;
  RETURN jsonb_build_object('ok', true, 'name', v_name);
END;
$$;
REVOKE ALL ON FUNCTION public.crew_rename(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_rename(uuid, text) TO authenticated;

/** Who's in it, and who's invited (a declined invite still reads "Invited" until it runs out). */
CREATE OR REPLACE FUNCTION public.crew_people(_group_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(p ORDER BY (p->>'rank')::int, p->>'at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
             'user_id', m.user_id,
             'name', a->>'name',
             'avatar_url', a->>'avatar_url',
             'status', m.status,
             'is_owner', g.created_by = m.user_id,
             'is_me', m.user_id = auth.uid(),
             'invited_by', CASE WHEN m.status = 'invited' THEN public.community_author(m.invited_by)->>'name' END,
             'rank', CASE WHEN g.created_by = m.user_id THEN 0 WHEN m.status = 'joined' THEN 1 ELSE 2 END,
             'at', coalesce(m.joined_at, m.invited_at, m.added_at)) AS p
      FROM public.chat_groups g
      JOIN public.chat_group_members m ON m.group_id = g.id
      CROSS JOIN LATERAL public.community_author(m.user_id) a
     WHERE g.id = _group_id AND g.kind = 'crew' AND public.chat_can_see(g.id, auth.uid())
       AND (m.status = 'joined' OR m.invited_at > now() - make_interval(days => public.chat_crew_invite_days()))) s
$$;
REVOKE ALL ON FUNCTION public.crew_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_people(uuid) TO authenticated;

/** My member-made chats and invites, in one call. */
CREATE OR REPLACE FUNCTION public.chat_crew_threads()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(t ORDER BY t->>'last_at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'group_id', g.id,
      'name', g.name,
      'status', st.v,
      'is_owner', g.created_by = auth.uid(),
      'invited_by', CASE WHEN st.v = 'invited' THEN public.community_author(me.invited_by)->>'name' END,
      'faces', coalesce((SELECT jsonb_agg(f.a) FROM (
                 SELECT public.community_author(m.user_id) AS a FROM public.chat_group_members m
                  WHERE m.group_id = g.id AND m.status = 'joined' AND m.user_id <> auth.uid()
                  ORDER BY m.joined_at NULLS LAST LIMIT 3) f), '[]'::jsonb),
      'joined', (SELECT count(*) FROM public.chat_group_members m WHERE m.group_id = g.id AND m.status = 'joined'),
      'invited', (SELECT count(*) FROM public.chat_group_members m WHERE m.group_id = g.id AND m.status = 'invited'
                    AND m.invited_at > now() - make_interval(days => public.chat_crew_invite_days())),
      'last', lm.j,
      'last_at', coalesce(lm.at, g.created_at),
      'read_at', CASE WHEN pr.read_at IS NULL THEN me.last_read_at ELSE greatest(me.last_read_at, pr.read_at) END
    ) AS t
    FROM public.chat_groups g
    JOIN public.chat_group_members me ON me.group_id = g.id AND me.user_id = auth.uid()
    CROSS JOIN LATERAL (SELECT public.chat_crew_status(g.id, auth.uid()) AS v) st
    LEFT JOIN public.chat_request_reads pr ON pr.group_id = g.id AND pr.user_id = auth.uid()
    LEFT JOIN LATERAL (
      SELECT m.created_at AS at,
             jsonb_build_object('body', m.body, 'created_at', m.created_at, 'sender_id', m.sender_id,
                                'sender_name', public.community_author(m.sender_id)->>'name',
                                'card', m.attachments @> '[{"kind":"community_post"}]'::jsonb,
                                'media', jsonb_typeof(m.attachments) = 'array' AND jsonb_array_length(m.attachments) > 0) AS j
        FROM public.group_messages m
       WHERE m.group_id = g.id AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1) lm ON true
    WHERE g.kind = 'crew' AND st.v IS NOT NULL AND public.chat_community_ok(auth.uid())
  ) s
$$;
REVOKE ALL ON FUNCTION public.chat_crew_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_crew_threads() TO authenticated, service_role;

-- DM reports use the same report helper now.
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
  IF _action = 'block' THEN RETURN jsonb_build_object('ok', true); END IF;

  v_other_name := coalesce(public.community_author(v_other)->>'name', 'Someone');
  SELECT coalesce(nullif(btrim(c.full_name), ''), v_other_name) INTO v_other_full
    FROM public.clients c WHERE c.user_id = v_other ORDER BY c.created_at DESC LIMIT 1;
  v_report := public.chat_file_report(g.id, uid, v_other, _reason,
    'a chat with ' || coalesce(v_other_full, v_other_name) || '. ' || v_other_name || '''s messages won''t reach them anymore');
  RETURN jsonb_build_object('ok', true, 'report_id', v_report);
END;
$$;
