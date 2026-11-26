-- Staff are participants in their own personal DMs, not moderators of other DMs.
CREATE OR REPLACE FUNCTION public.chat_can_see(_group_id uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND coalesce((
    SELECT CASE g.kind
      WHEN 'direct' THEN public.is_group_member(g.id, _uid)
           AND (public.chat_community_ok(_uid) OR public.is_coach_or_admin(_uid))
           AND NOT EXISTS (SELECT 1 FROM public.chat_direct_closed x WHERE x.group_id = g.id AND x.user_id = _uid)
      WHEN 'crew' THEN public.chat_community_ok(_uid) AND public.chat_crew_status(g.id, _uid) IS NOT NULL
      ELSE public.user_is_active(_uid)
           AND (public.is_coach_or_admin(_uid) OR public.is_group_member(g.id, _uid)) END
      FROM public.chat_groups g WHERE g.id = _group_id), false)
$$;

-- Start an ordinary private chat only on Send, from an authorized staff login.
-- No coach assignment, no support ticket, and no bypass of blocks.
CREATE OR REPLACE FUNCTION public.chat_staff_direct_start(_client_id uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  peer uuid;
  v_key text;
  v_body text := btrim(coalesce(_body, ''));
  g public.chat_groups;
  v_msg uuid;
BEGIN
  IF uid IS NULL OR NOT public.is_coach_or_admin(uid) OR NOT (
    public.has_role(uid, 'admin'::public.app_role) OR public.is_assigned_coach_for_client(_client_id)
  ) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT c.user_id INTO peer FROM public.clients c WHERE c.id = _client_id;
  IF peer IS NULL OR peer = uid OR NOT public.chat_community_ok(peer) THEN
    RAISE EXCEPTION 'This account cannot receive messages right now';
  END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Write a message of up to 2,000 characters'; END IF;
  IF EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE
    (b.user_id = uid AND b.blocked_user_id = peer) OR (b.user_id = peer AND b.blocked_user_id = uid)) THEN
    RAISE EXCEPTION 'This conversation is unavailable';
  END IF;
  v_key := least(uid::text, peer::text) || ':' || greatest(uid::text, peer::text);
  INSERT INTO public.chat_groups (name, kind, direct_key, direct_status, requested_by, created_by, accepted_at)
    VALUES ('Direct message', 'direct', v_key, 'active', uid, uid, now())
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO NOTHING;
  SELECT * INTO g FROM public.chat_groups WHERE direct_key = v_key FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.chat_direct_closed x WHERE x.group_id = g.id) THEN
    RAISE EXCEPTION 'This conversation is unavailable';
  END IF;
  INSERT INTO public.chat_group_members (group_id, user_id, role, added_by)
    VALUES (g.id, uid, 'member', uid), (g.id, peer, 'member', uid)
    ON CONFLICT (group_id, user_id) DO NOTHING;
  -- A prior request sent by the recipient can be accepted by replying.
  -- Do not change the recipient's pending request from this staff login.
  IF g.direct_status = 'request' AND g.requested_by = uid THEN
    RAISE EXCEPTION 'This conversation is awaiting a reply';
  END IF;
  INSERT INTO public.group_messages (group_id, sender_id, sender_role, body, attachments)
    VALUES (g.id, uid, 'member', v_body, '[]'::jsonb) RETURNING id INTO v_msg;
  SELECT * INTO g FROM public.chat_groups WHERE id = g.id;
  RETURN jsonb_build_object('route', 'direct', 'group_id', g.id, 'message_id', v_msg, 'status', g.direct_status);
END;
$$;
REVOKE ALL ON FUNCTION public.chat_staff_direct_start(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_staff_direct_start(uuid, text) TO authenticated;
