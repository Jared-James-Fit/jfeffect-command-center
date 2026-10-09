-- Replying to a community post in Messenger, as a message request.
--
--   - Coach's post → goes to your normal chat with your coach.
--   - A coach replying to a client's post → that client's coach chat.
--   - Client to client → a direct chat that starts as a REQUEST: the other
--     person sees the whole thing first and decides. Until they accept:
--       * the sender can add a couple of lines (text only, 3 messages in all)
--       * the sender never sees "Seen" (the reader's last_read_at is held;
--         their real read time goes to a private table)
--     "Delete" and "Block" are silent: the sender is never told, and their
--     side looks exactly like a request that hasn't been answered yet.
--     "Report" blocks and drops a copy of the chat into the reporter's coach
--     chat as an internal note, so the coach can step in.
--
-- Direct chats ride on the group chat tables (same thread UI, reactions,
-- voice notes, realtime, push) as chat_groups.kind = 'direct'. They are
-- private to the two people: coaches don't see them in their group lists or
-- through "View as client", the same way DMs work anywhere else.

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS direct_key text,
  ADD COLUMN IF NOT EXISTS direct_status text,
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

ALTER TABLE public.chat_groups DROP CONSTRAINT IF EXISTS chat_groups_kind_check;
ALTER TABLE public.chat_groups ADD CONSTRAINT chat_groups_kind_check CHECK (kind IN ('group', 'direct'));
ALTER TABLE public.chat_groups DROP CONSTRAINT IF EXISTS chat_groups_direct_shape;
ALTER TABLE public.chat_groups ADD CONSTRAINT chat_groups_direct_shape CHECK (
  (kind = 'group' AND direct_key IS NULL AND direct_status IS NULL)
  OR (kind = 'direct' AND direct_key IS NOT NULL AND direct_status IN ('request', 'active')));
CREATE UNIQUE INDEX IF NOT EXISTS chat_groups_direct_key_idx ON public.chat_groups (direct_key) WHERE direct_key IS NOT NULL;

-- Someone's own "I don't want this chat": declined a request, or blocked.
-- Only they can read their row, so the other person can't tell.
CREATE TABLE IF NOT EXISTS public.chat_direct_closed (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('declined', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
ALTER TABLE public.chat_direct_closed ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.chat_direct_closed TO authenticated;
GRANT ALL ON public.chat_direct_closed TO service_role;
DROP POLICY IF EXISTS "chat_direct_closed_own" ON public.chat_direct_closed;
CREATE POLICY "chat_direct_closed_own" ON public.chat_direct_closed FOR SELECT TO authenticated USING (user_id = auth.uid());

-- When the person asked opens a request, their read time lands here instead
-- of on their membership row (which the sender can read).
CREATE TABLE IF NOT EXISTS public.chat_request_reads (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
ALTER TABLE public.chat_request_reads ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.chat_request_reads TO authenticated;
GRANT ALL ON public.chat_request_reads TO service_role;
DROP POLICY IF EXISTS "chat_request_reads_own" ON public.chat_request_reads;
CREATE POLICY "chat_request_reads_own" ON public.chat_request_reads FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Reports: what was said, kept for the coach.
CREATE TABLE IF NOT EXISTS public.chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.chat_groups(id) ON DELETE SET NULL,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  note_message_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.chat_reports TO authenticated;
GRANT ALL ON public.chat_reports TO service_role;
DROP POLICY IF EXISTS "chat_reports_staff_read" ON public.chat_reports;
CREATE POLICY "chat_reports_staff_read" ON public.chat_reports FOR SELECT TO authenticated USING (public.is_coach_or_admin(auth.uid()));
DROP POLICY IF EXISTS "chat_reports_staff_update" ON public.chat_reports;
CREATE POLICY "chat_reports_staff_update" ON public.chat_reports FOR UPDATE TO authenticated
  USING (public.is_coach_or_admin(auth.uid())) WITH CHECK (public.is_coach_or_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
/** How many messages a request can hold before the other person answers. */
CREATE OR REPLACE FUNCTION public.chat_request_cap()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

CREATE OR REPLACE FUNCTION public.chat_is_direct(_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT g.kind = 'direct' FROM public.chat_groups g WHERE g.id = _group_id), false)
$$;

/** In the community (an active client with app access). */
CREATE OR REPLACE FUNCTION public.chat_community_ok(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.user_id = _uid
       AND coalesce(c.archived, false) = false
       AND c.archived_at IS NULL
       AND coalesce(c.status, '') <> 'Archived'
       AND coalesce(c.portal_access_disabled, false) = false)
$$;

/** Can this person see the chat (and its messages, members, reactions)? */
CREATE OR REPLACE FUNCTION public.chat_can_see(_group_id uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND coalesce((
    SELECT CASE WHEN g.kind = 'direct'
      THEN public.is_group_member(g.id, _uid)
           AND public.chat_community_ok(_uid)
           AND NOT EXISTS (SELECT 1 FROM public.chat_direct_closed x WHERE x.group_id = g.id AND x.user_id = _uid)
      ELSE public.user_is_active(_uid)
           AND (public.is_coach_or_admin(_uid) OR public.is_group_member(g.id, _uid)) END
      FROM public.chat_groups g WHERE g.id = _group_id), false)
$$;

/** Can this person post this message here? (Group rules unchanged.) */
CREATE OR REPLACE FUNCTION public.chat_can_post(_group_id uuid, _uid uuid, _attachments jsonb DEFAULT '[]'::jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.chat_groups;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  SELECT * INTO g FROM public.chat_groups WHERE id = _group_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF g.kind <> 'direct' THEN
    RETURN public.user_is_active(_uid)
       AND (public.is_coach_or_admin(_uid)
            OR (public.is_group_member(g.id, _uid) AND g.archived = false AND g.permission_mode = 'everyone'));
  END IF;
  IF NOT public.chat_can_see(g.id, _uid) THEN RETURN false; END IF;
  -- An accepted chat, or the person asked writing back (which accepts it).
  IF g.direct_status = 'active' OR _uid IS DISTINCT FROM g.requested_by THEN RETURN true; END IF;
  -- Still a request: a few lines of text, no photos or files, until they answer.
  RETURN (jsonb_typeof(_attachments) = 'array' AND jsonb_array_length(_attachments) = 0)
     AND (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.sender_id = _uid) < public.chat_request_cap();
END;
$$;

/** Reactions in a direct chat only once it's accepted (a heart would say "seen"). */
CREATE OR REPLACE FUNCTION public.chat_can_react(_message_id uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT public.chat_can_see(m.group_id, _uid) AND (g.kind <> 'direct' OR g.direct_status = 'active')
      FROM public.group_messages m JOIN public.chat_groups g ON g.id = m.group_id
     WHERE m.id = _message_id), false)
$$;

-- Managing (rename, members, editing others' messages) is for coach-run groups only.
CREATE OR REPLACE FUNCTION public.can_manage_group(_group_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.chat_is_direct(_group_id) AND (
    public.has_role(_user_id, 'admin'::app_role)
    OR public.is_group_admin(_group_id, _user_id)
    OR EXISTS (SELECT 1 FROM public.chat_groups WHERE id = _group_id AND created_by = _user_id)
    OR EXISTS (SELECT 1 FROM public.coaches WHERE user_id = _user_id AND archived = false AND status = 'Active'))
$$;

GRANT EXECUTE ON FUNCTION public.chat_request_cap() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_is_direct(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_community_ok(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_can_see(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_can_post(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_can_react(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row security (groups behave exactly as before; directs are the two people's)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_groups_select" ON public.chat_groups;
CREATE POLICY "chat_groups_select" ON public.chat_groups FOR SELECT TO authenticated
  USING (public.chat_can_see(id, auth.uid()));

DROP POLICY IF EXISTS "chat_groups_insert" ON public.chat_groups;
CREATE POLICY "chat_groups_insert" ON public.chat_groups FOR INSERT TO authenticated
  WITH CHECK (kind = 'group' AND public.is_coach_or_admin(auth.uid()) AND created_by = auth.uid());

-- (update: can_manage_group is false for directs; their state changes go through the functions below)
DROP POLICY IF EXISTS "chat_groups_delete" ON public.chat_groups;
CREATE POLICY "chat_groups_delete" ON public.chat_groups FOR DELETE TO authenticated
  USING (kind = 'group' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "chat_group_members_select" ON public.chat_group_members;
CREATE POLICY "chat_group_members_select" ON public.chat_group_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.chat_can_see(group_id, auth.uid()));

DROP POLICY IF EXISTS "chat_group_members_delete" ON public.chat_group_members;
CREATE POLICY "chat_group_members_delete" ON public.chat_group_members FOR DELETE TO authenticated
  USING (public.can_manage_group(group_id, auth.uid())
         OR (user_id = auth.uid() AND NOT public.chat_is_direct(group_id)));

DROP POLICY IF EXISTS "group_messages_select" ON public.group_messages;
CREATE POLICY "group_messages_select" ON public.group_messages FOR SELECT TO authenticated
  USING (public.chat_can_see(group_id, auth.uid()));

DROP POLICY IF EXISTS "group_messages_insert" ON public.group_messages;
CREATE POLICY "group_messages_insert" ON public.group_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.chat_can_post(group_id, auth.uid(), attachments));

-- No hard deletes in a direct chat ("delete for everyone" is a soft delete),
-- so a request can't be emptied and refilled past its cap.
DROP POLICY IF EXISTS "group_messages_delete" ON public.group_messages;
CREATE POLICY "group_messages_delete" ON public.group_messages FOR DELETE TO authenticated
  USING ((sender_id = auth.uid() AND NOT public.chat_is_direct(group_id))
         OR public.can_manage_group(group_id, auth.uid()));

DROP POLICY IF EXISTS "group_message_reactions_select" ON public.group_message_reactions;
CREATE POLICY "group_message_reactions_select" ON public.group_message_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = message_id AND public.chat_can_see(m.group_id, auth.uid())));

DROP POLICY IF EXISTS "group_message_reactions_insert" ON public.group_message_reactions;
CREATE POLICY "group_message_reactions_insert" ON public.group_message_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.chat_can_react(message_id, auth.uid()));

-- Names + avatars of a chat's members: only for people who can see the chat.
CREATE OR REPLACE FUNCTION public.get_group_member_profiles(_group_id uuid)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.chat_can_see(_group_id, auth.uid()) THEN RETURN; END IF;
  IF public.chat_is_direct(_group_id) THEN
    -- The way the community shows them (first name, community photo).
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
-- Members can only touch their own read marker (not their role: that was a
-- way to make yourself a group admin), and while a request is unanswered the
-- person asked doesn't show as having seen it.
CREATE OR REPLACE FUNCTION public.chat_members_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.chat_groups;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
  NEW.group_id := OLD.group_id;
  NEW.user_id := OLD.user_id;
  IF NOT public.can_manage_group(OLD.group_id, auth.uid()) THEN
    NEW.role := OLD.role;
    NEW.added_by := OLD.added_by;
    NEW.added_at := OLD.added_at;
  END IF;
  SELECT * INTO g FROM public.chat_groups WHERE id = OLD.group_id;
  IF g.kind = 'direct' AND g.direct_status <> 'active' AND OLD.user_id IS DISTINCT FROM g.requested_by
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
DROP TRIGGER IF EXISTS chat_group_members_guard ON public.chat_group_members;
CREATE TRIGGER chat_group_members_guard BEFORE UPDATE ON public.chat_group_members
  FOR EACH ROW EXECUTE FUNCTION public.chat_members_guard();

-- In a direct chat an edit is an edit: no swapping in photos (requests are
-- text only) and no moving messages around. "Delete for everyone" still works.
CREATE OR REPLACE FUNCTION public.chat_direct_message_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR NOT public.chat_is_direct(OLD.group_id) THEN RETURN NEW; END IF;
  NEW.group_id := OLD.group_id;
  NEW.sender_id := OLD.sender_id;
  NEW.sender_role := OLD.sender_role;
  NEW.created_at := OLD.created_at;
  IF NEW.attachments IS DISTINCT FROM OLD.attachments AND NEW.deleted_at IS NULL THEN
    NEW.attachments := OLD.attachments;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS group_messages_direct_guard ON public.group_messages;
CREATE TRIGGER group_messages_direct_guard BEFORE UPDATE ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_direct_message_guard();

-- A new message moves the chat to the top, and the person asked writing
-- back is a yes.
CREATE OR REPLACE FUNCTION public.chat_direct_after_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.chat_groups g
     SET direct_status = CASE WHEN g.direct_status = 'request' AND NEW.sender_id IS NOT NULL
                                   AND NEW.sender_id IS DISTINCT FROM g.requested_by THEN 'active' ELSE g.direct_status END,
         accepted_at = CASE WHEN g.direct_status = 'request' AND NEW.sender_id IS NOT NULL
                                 AND NEW.sender_id IS DISTINCT FROM g.requested_by THEN now() ELSE g.accepted_at END,
         updated_at = now()
   WHERE g.id = NEW.group_id AND g.kind = 'direct';
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS group_messages_direct_after ON public.group_messages;
CREATE TRIGGER group_messages_direct_after AFTER INSERT ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_direct_after_message();

-- ---------------------------------------------------------------------------
-- Reply to a post in Messenger
-- ---------------------------------------------------------------------------
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
  v_key text;
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

  -- A coach answering a client's post: that client's coach chat. (Coaches can
  -- browse from a linked athlete account, so send as whichever of the
  -- person's accounts is the coach one.)
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
  v_key := least(uid::text, p.author_user_id::text) || ':' || greatest(uid::text, p.author_user_id::text);
  INSERT INTO public.chat_groups (name, kind, direct_key, direct_status, requested_by, created_by)
  VALUES ('Direct message', 'direct', v_key, 'request', uid, uid)
  ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO NOTHING;
  SELECT * INTO g FROM public.chat_groups WHERE direct_key = v_key FOR UPDATE;
  INSERT INTO public.chat_group_members (group_id, user_id, role, added_by)
  VALUES (g.id, uid, 'member', uid), (g.id, p.author_user_id, 'member', uid)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  -- Writing to them again undoes your own "delete" or block.
  DELETE FROM public.chat_direct_closed WHERE group_id = g.id AND user_id = uid;

  IF g.direct_status = 'request' AND g.requested_by = uid
     AND (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.sender_id = uid) >= public.chat_request_cap() THEN
    RAISE EXCEPTION 'request_limit';
  END IF;

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
-- Accept / delete / block / report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_direct_respond(_group_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  g public.chat_groups;
  v_other uuid;
  v_report uuid;
  v_snap jsonb;
  v_client uuid;
  v_note uuid;
  v_me_name text;
  v_other_name text;
  v_other_full text;
  v_lines text;
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

  -- Report: keep what was said, and put it in front of the coach.
  v_me_name := coalesce(public.community_author(uid)->>'name', 'They');
  v_other_name := coalesce(public.community_author(v_other)->>'name', 'Someone');
  SELECT coalesce(nullif(btrim(c.full_name), ''), v_other_name) INTO v_other_full
    FROM public.clients c WHERE c.user_id = v_other ORDER BY c.created_at DESC LIMIT 1;
  v_other_full := coalesce(v_other_full, v_other_name, 'Someone');

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) INTO v_snap FROM (
    SELECT jsonb_build_object(
             'at', m.created_at, 'from', m.sender_id,
             'name', CASE WHEN m.sender_id = uid THEN v_me_name ELSE v_other_name END,
             'body', left(m.body, 1000),
             'kinds', coalesce((SELECT jsonb_agg(a->>'kind') FILTER (WHERE a->>'kind' IS NOT NULL)
                                  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) a), '[]'::jsonb),
             'files', (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) a
                        WHERE a->>'kind' IS NULL)) AS x
      FROM public.group_messages m
     WHERE m.group_id = g.id AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 20) s;

  SELECT c.id INTO v_client FROM public.clients c WHERE c.user_id = uid AND coalesce(c.archived, false) = false
   ORDER BY c.created_at DESC LIMIT 1;

  INSERT INTO public.chat_reports (group_id, reporter_id, reported_id, reporter_client_id, reason, snapshot)
  VALUES (g.id, uid, v_other, v_client, nullif(btrim(coalesce(_reason, '')), ''), v_snap)
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
    VALUES (v_client, uid, 'client',
            '🚩 ' || coalesce(v_me_name, 'They') || ' reported a chat with ' || v_other_full || E'.\n'
            || v_other_name || '''s messages won''t reach ' || coalesce(v_me_name, 'them') || ' anymore, and ' || v_other_name || ' wasn''t told.'
            || CASE WHEN nullif(btrim(coalesce(_reason, '')), '') IS NOT NULL THEN E'\n\nWhy: ' || btrim(_reason) ELSE '' END
            || E'\n\nLast ' || jsonb_array_length(v_snap) || CASE WHEN jsonb_array_length(v_snap) = 1 THEN ' message' ELSE ' messages' END
            || E':\n\n' || coalesce(v_lines, '(no messages)'),
            '[]'::jsonb, 'General', true)
    RETURNING id INTO v_note;
    UPDATE public.chat_reports SET note_message_id = v_note WHERE id = v_report;
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', v_report);
END;
$$;
REVOKE ALL ON FUNCTION public.chat_direct_respond(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_direct_respond(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- My direct chats, in one call (the list, requests, unread, the request cap)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_direct_threads()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(t ORDER BY t->>'last_at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'group_id', g.id,
      'status', g.direct_status,
      'incoming', g.direct_status = 'request' AND g.requested_by IS DISTINCT FROM auth.uid(),
      'outgoing', g.direct_status = 'request' AND g.requested_by = auth.uid(),
      'other', public.community_author(o.user_id),
      'last', lm.j,
      'last_at', coalesce(lm.at, g.created_at),
      'read_at', CASE WHEN pr.read_at IS NULL THEN me.last_read_at ELSE greatest(me.last_read_at, pr.read_at) END,
      'left', CASE WHEN g.direct_status = 'request' AND g.requested_by = auth.uid()
                   THEN greatest(0, public.chat_request_cap() - (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.sender_id = auth.uid()))::int END
    ) AS t
    FROM public.chat_groups g
    JOIN public.chat_group_members me ON me.group_id = g.id AND me.user_id = auth.uid()
    JOIN public.chat_group_members o ON o.group_id = g.id AND o.user_id <> auth.uid()
    LEFT JOIN public.chat_request_reads pr ON pr.group_id = g.id AND pr.user_id = auth.uid()
    LEFT JOIN LATERAL (
      SELECT m.created_at AS at,
             jsonb_build_object('body', m.body, 'created_at', m.created_at, 'sender_id', m.sender_id,
                                'card', m.attachments @> '[{"kind":"community_post"}]'::jsonb,
                                'media', jsonb_typeof(m.attachments) = 'array' AND jsonb_array_length(m.attachments) > 0) AS j
        FROM public.group_messages m
       WHERE m.group_id = g.id AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1) lm ON true
    WHERE g.kind = 'direct' AND public.chat_can_see(g.id, auth.uid())
  ) s
$$;
REVOKE ALL ON FUNCTION public.chat_direct_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_direct_threads() TO authenticated, service_role;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_direct_closed;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
