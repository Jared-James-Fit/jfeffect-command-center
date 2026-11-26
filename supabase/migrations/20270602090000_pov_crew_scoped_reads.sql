-- Reuse the live Crew read functions under an authorized, transaction-local
-- target identity. No client credentials, token minting, arbitrary SQL, write
-- dispatch, or change to the caller's real authentication session.
-- This migration must pass a database parity and isolation test before release.
CREATE OR REPLACE FUNCTION public.admin_pov_crew_read(
  _session uuid, _read text, _args jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_auth_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  v_target uuid;
  v_client uuid;
  v_old_claims text := current_setting('request.jwt.claims', true);
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_auth_session IS NULL THEN
    RAISE EXCEPTION 'Account view unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT s.target_user_id, s.client_id INTO v_target, v_client
    FROM public.admin_pov_sessions s
    JOIN public.clients c ON c.id = s.client_id AND c.user_id = s.target_user_id
   WHERE s.id = _session AND s.staff_user_id = v_actor
     AND s.auth_session_id = v_auth_session
     AND s.ended_at IS NULL AND s.expires_at > now() AND s.max_until > now()
     AND (public.has_role(v_actor, 'admin') OR
       (public.has_role(v_actor, 'coach') AND s.client_id IN (SELECT public.coached_client_ids())));
  -- Mixed staff/personal logins cannot safely use the normal client RPCs: those
  -- functions would still resolve staff privileges. Fail closed, not staff data.
  IF v_target IS NULL OR EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = v_target
      AND r.role::text IN ('admin', 'coach', 'finance', 'media_manager')
  ) THEN
    RAISE EXCEPTION 'Client account preview unavailable' USING ERRCODE = '42501';
  END IF;
  IF _read IS NULL OR _read NOT IN ('feed', 'ranked', 'profile', 'post', 'follows', 'activity', 'crew_notices', 'follow_list', 'archived', 'saved_albums', 'saved_posts', 'reposts', 'direct_threads', 'crew_threads', 'chat_prefs', 'nav_data')
     OR jsonb_typeof(_args) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Unknown account view read' USING ERRCODE = '22023';
  END IF;
  -- Replace only in this fixed, read-only call. Never copy staff metadata, MFA
  -- state or session credentials to the target. Restore on success; PL/pgSQL
  -- exception subtransactions also restore settings on errors.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_target, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_target::text, true);
  CASE _read
    WHEN 'feed' THEN
      v_result := public.community_feed(
        coalesce((_args->>'_limit')::integer, 10),
        (_args->>'_before_at')::timestamptz, (_args->>'_before_id')::uuid,
        (_args->>'_author_user_id')::uuid);
    WHEN 'ranked' THEN
      v_result := public.community_feed_ranked(
        coalesce((_args->>'_limit')::integer, 5), _args->'_cursor',
        (_args->>'_seen_before')::timestamptz, coalesce((_args->>'_following')::boolean, false));
    WHEN 'profile' THEN v_result := public.community_profile((_args->>'_user_id')::uuid);
    WHEN 'post' THEN v_result := public.community_post((_args->>'_post_id')::uuid);
    WHEN 'follows' THEN v_result := public.community_follow_state();
    WHEN 'activity' THEN v_result := public.community_activity();
    WHEN 'follow_list' THEN v_result := public.community_follow_list((_args->>'_user_id')::uuid, _args->>'_kind');
    WHEN 'archived' THEN v_result := public.community_my_archived();
    WHEN 'saved_albums' THEN v_result := public.community_saved_albums((_args->>'_post_id')::uuid);
    WHEN 'saved_posts' THEN v_result := public.community_saved_posts(
      (_args->>'_album_id')::uuid, coalesce((_args->>'_limit')::integer, 24),
      (_args->>'_before_at')::timestamptz, (_args->>'_before_id')::uuid);
    WHEN 'reposts' THEN v_result := public.community_user_reposts(
      (_args->>'_user_id')::uuid, coalesce((_args->>'_limit')::integer, 24),
      (_args->>'_before_at')::timestamptz, (_args->>'_before_id')::uuid);
    WHEN 'direct_threads' THEN v_result := public.chat_direct_threads();
    WHEN 'crew_threads' THEN v_result := public.chat_crew_threads();
    WHEN 'chat_prefs' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_result FROM (
        SELECT thread_key, pinned_at, muted, hidden_at, unread_at
          FROM public.chat_thread_prefs WHERE user_id=v_target
      ) p;
    WHEN 'nav_data' THEN
      -- Same inputs and caps as useClientNavBadges; every table is explicitly
      -- constrained to the authorized client or that person's group membership.
      WITH memberships AS (
        SELECT m.group_id, m.last_read_at FROM public.chat_group_members m
        JOIN public.chat_groups g ON g.id=m.group_id
        WHERE m.user_id=v_target AND g.kind='group' AND NOT coalesce(g.archived,false)
      )
      SELECT jsonb_build_object(
        'client', (SELECT to_jsonb(c) FROM (SELECT id,last_program_update FROM public.clients WHERE id=v_client) c),
        'msgs', (SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) FROM (
          SELECT created_at FROM public.messages WHERE client_id=v_client
            AND sender_role='admin' AND is_internal_note=false AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 50) m),
        'state', (SELECT to_jsonb(st) FROM (SELECT client_last_read_at FROM public.conversation_state WHERE client_id=v_client LIMIT 1) st),
        'nut', (SELECT coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) FROM (
          SELECT updated_at,last_updated_at FROM public.nutrition_targets WHERE client_id=v_client ORDER BY updated_at DESC LIMIT 5) n),
        'groupMemberships', (SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) FROM memberships m),
        'groupMsgs', (SELECT coalesce(jsonb_agg(to_jsonb(gm)), '[]'::jsonb) FROM (
          SELECT group_id,sender_id,created_at FROM public.group_messages WHERE group_id IN (SELECT group_id FROM memberships)
            AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200) gm),
        'supportUnread', coalesce((SELECT unread_for_member FROM public.member_support_threads
          WHERE id IN (SELECT public.support_own_thread_ids()) OR member_id=public.current_member_id() LIMIT 1),0)
      ) INTO v_result;
    WHEN 'crew_notices' THEN
      SELECT coalesce(jsonb_agg(n || jsonb_build_object('unread',
        NOT EXISTS (SELECT 1 FROM public.notification_state st
          WHERE st.user_id = v_target AND st.kind = 'community'
            AND st.source_id = n->>'anchor' AND st.read_at >= (n->>'at')::timestamptz))), '[]'::jsonb)
      INTO v_result
      FROM jsonb_array_elements(coalesce(public.community_my_notifications(), '[]'::jsonb)) AS n;
  END CASE;
  PERFORM set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_old_sub, ''), true);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pov_crew_read(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pov_crew_read(uuid,text,jsonb) TO authenticated;
