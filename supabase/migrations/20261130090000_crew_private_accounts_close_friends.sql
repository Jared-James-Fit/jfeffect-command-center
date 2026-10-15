-- Crew: private accounts, Close Friends, follower counts, story replies.
--
-- Instagram-style follow, on top of community_follows (approved follows only):
--
--   * Private account (community_profiles.is_private, members only, never
--     staff): a follow becomes a request the person confirms or deletes
--     (community_follow_requests). Their own posts and stories that would go
--     to the whole crew are stored as visibility 'followers' (a trigger does
--     it, so every save path agrees) and reach approved followers only.
--     Automatic workout stories (auto_shared Pulses) stay 'community' for
--     everyone. Going private keeps existing followers; going public turns
--     every 'followers' post back to 'community' and confirms every request.
--   * Close Friends (community_close_friends): a list the author picks; a
--     'close_friends' post or story reaches only them (green ring).
--   * Coaches and admins still see every client post, 'followers' and
--     'close_friends' included (moderation), the same as 'community'.
--   * Counts + lists: profiles show followers / following; the lists are open
--     on a public account and only to approved followers on a private one.
--   * A new 1:1 opens straight away (no request, no daily cap) when the person
--     you're writing to follows you, as Instagram does for story replies.
--
-- One rule still decides who sees a post: community_post_visible().

-- ── Shape ───────────────────────────────────────────────────────────────────
ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.community_follow_requests (
  requester_id uuid NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CONSTRAINT community_follow_requests_not_self CHECK (requester_id <> target_id)
);
CREATE INDEX IF NOT EXISTS community_follow_requests_target_idx ON public.community_follow_requests (target_id, created_at DESC);
ALTER TABLE public.community_follow_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_follow_requests FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.community_close_friends (
  owner_id uuid NOT NULL,
  friend_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, friend_id),
  CONSTRAINT community_close_friends_not_self CHECK (owner_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS community_close_friends_friend_idx ON public.community_close_friends (friend_id);
ALTER TABLE public.community_close_friends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_close_friends FROM anon, authenticated;

ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_visibility_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_visibility_check
  CHECK (visibility IN ('community', 'followers', 'close_friends', 'coach', 'private'));

ALTER TABLE public.community_notifications DROP CONSTRAINT IF EXISTS community_notifications_kind_check;
ALTER TABLE public.community_notifications ADD CONSTRAINT community_notifications_kind_check
  CHECK (kind = ANY (ARRAY['reaction'::text, 'comment'::text, 'reply'::text, 'comment_like'::text, 'follow'::text, 'follow_request'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS community_notifications_follow_request_uq
  ON public.community_notifications (recipient_user_id, actor_user_id) WHERE kind = 'follow_request';

-- ── Helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_is_private(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT cp.is_private FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(_user_id)), false)
$$;

CREATE OR REPLACE FUNCTION public.community_is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role IN ('admin', 'coach'))
$$;

/** Does _follower (any login) follow _followee? Approved follows only. */
CREATE OR REPLACE FUNCTION public.community_follows_user(_follower uuid, _followee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_follows f
                  WHERE f.follower_id = public.community_main_account(_follower)
                    AND f.followee_id = public.community_main_account(_followee))
$$;

REVOKE ALL ON FUNCTION public.community_is_private(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_is_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_follows_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_is_private(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_is_staff(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_follows_user(uuid, uuid) TO service_role;

-- ── The one visibility rule ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_post_visible(_visibility text, _author uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    _author = auth.uid()
    OR (_visibility = 'community' AND public.can_view_community())
    OR (_visibility = 'coach' AND (public.has_role(auth.uid(), 'admin') OR public.is_assigned_coach_for_client(_client)))
    OR (_visibility = 'followers' AND public.can_view_community()
        AND (public.community_is_staff(auth.uid()) OR public.community_follows_user(auth.uid(), _author)))
    OR (_visibility = 'close_friends' AND public.can_view_community()
        AND (public.community_is_staff(auth.uid())
             OR EXISTS (SELECT 1 FROM public.community_close_friends cf
                         WHERE cf.owner_id = public.community_main_account(_author)
                           AND cf.friend_id = public.community_main_account(auth.uid())))))
$$;
REVOKE ALL ON FUNCTION public.community_post_visible(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_visible(text, uuid, uuid) TO authenticated, service_role;

-- A private account's crew posts are followers-only; automatic workout stories stay crew-wide.
CREATE OR REPLACE FUNCTION public.community_posts_private_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.visibility IN ('community', 'followers') THEN
    NEW.visibility := CASE WHEN NOT coalesce(NEW.auto_shared, false) AND public.community_is_private(NEW.author_user_id)
                           THEN 'followers' ELSE 'community' END;
  END IF;
  IF NEW.archived_from IN ('community', 'followers') THEN
    NEW.archived_from := CASE WHEN public.community_is_private(NEW.author_user_id) THEN 'followers' ELSE 'community' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS community_posts_private_audience ON public.community_posts;
CREATE TRIGGER community_posts_private_audience BEFORE INSERT OR UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.community_posts_private_audience();

-- ── Feed, badge, posting, League ───────────────────────────────────────────
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_feed(integer, timestamptz, uuid, uuid)'::regprocedure);
  v_anchor text := '            OR (p.visibility = ''coach'' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))';
BEGIN
  IF position('close_friends' in v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'community_feed: anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_anchor || '
            OR (p.visibility IN (''followers'', ''close_friends'') AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))');
END $$;

DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_activity()'::regprocedure);
  v_anchor text := '(p.visibility = ''community'' OR (p.visibility = ''coach'' AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)))';
BEGIN
  IF position('close_friends' in v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'community_activity: anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor,
    '(p.visibility = ''community'' OR (p.visibility IN (''coach'', ''followers'', ''close_friends'') AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)))');
END $$;

-- Posting / editing / sharing a workout take Close Friends ('followers' is the stored form of the crew choice).
DO $$
DECLARE
  r record;
  v_def text;
  v_patched int := 0;
  a1 text := 'IF _visibility NOT IN (''community'', ''coach'', ''private'')';
  b1 text := 'IF _visibility NOT IN (''community'', ''followers'', ''close_friends'', ''coach'', ''private'')';
  a2 text := 'IF _visibility = ''community'' AND NOT public.can_view_community()';
  b2 text := 'IF _visibility IN (''community'', ''followers'', ''close_friends'') AND NOT public.can_view_community()';
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('community_create_post', 'community_edit_post', 'community_save_post') LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position(b1 in v_def) > 0 THEN v_patched := v_patched + 1; CONTINUE; END IF;
    IF position(a1 in v_def) = 0 OR position(a2 in v_def) = 0 THEN CONTINUE; END IF;
    EXECUTE replace(replace(v_def, a1, b1), a2, b2);
    v_patched := v_patched + 1;
  END LOOP;
  IF v_patched < 3 THEN RAISE EXCEPTION 'audiences: expected create/edit/save post to take them, patched %', v_patched; END IF;
END $$;

-- A private account sharing a workout with its followers still earns the day's League points.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_post_xp_sync(uuid, date)'::regprocedure);
  v_anchor text := 'and cp.visibility = ''community''';
BEGIN
  IF position('''followers''' in v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'community_post_xp_sync: anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor, 'and cp.visibility in (''community'', ''followers'')');
END $$;

-- ── Follow, requests, Close Friends ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_follow_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN
    RETURN jsonb_build_object('following', '[]'::jsonb, 'followers', '[]'::jsonb, 'requested', '[]'::jsonb,
                              'requests', '[]'::jsonb, 'close_friends', '[]'::jsonb, 'is_private', false);
  END IF;
  RETURN jsonb_build_object(
    'following', coalesce((SELECT jsonb_agg(f.followee_id ORDER BY f.created_at DESC) FROM public.community_follows f
                            WHERE f.follower_id = v_me AND public.community_is_member(f.followee_id)), '[]'::jsonb),
    'followers', coalesce((SELECT jsonb_agg(f.follower_id ORDER BY f.created_at DESC) FROM public.community_follows f
                            WHERE f.followee_id = v_me AND public.community_is_member(f.follower_id)
                              AND NOT public.chat_has_blocked(v_me, f.follower_id)), '[]'::jsonb),
    -- my requests still waiting on a private account
    'requested', coalesce((SELECT jsonb_agg(r.target_id ORDER BY r.created_at DESC) FROM public.community_follow_requests r
                            WHERE r.requester_id = v_me AND public.community_is_member(r.target_id)), '[]'::jsonb),
    -- people asking to follow me
    'requests', coalesce((SELECT jsonb_agg(r.requester_id ORDER BY r.created_at DESC) FROM public.community_follow_requests r
                           WHERE r.target_id = v_me AND public.community_is_member(r.requester_id)
                             AND NOT public.chat_has_blocked(v_me, r.requester_id)), '[]'::jsonb),
    'close_friends', coalesce((SELECT jsonb_agg(c.friend_id ORDER BY c.created_at DESC) FROM public.community_close_friends c
                                WHERE c.owner_id = v_me AND public.community_is_member(c.friend_id)), '[]'::jsonb),
    'is_private', public.community_is_private(v_me));
END;
$$;

-- Follow (true) / unfollow or cancel a request (false). A private account
-- (unless you're staff) gets a request instead, with one "requested to follow
-- you" in their bell while it waits. Never reveals a block.
CREATE OR REPLACE FUNCTION public.community_follow(_user_id uuid, _on boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_them uuid := public.community_main_account(_user_id);
  v_rows int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_them IS NULL OR v_them = v_me OR NOT public.community_is_member(v_them) THEN
    RAISE EXCEPTION 'That account isn''t in the crew' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(_on, true) THEN
    DELETE FROM public.community_follows WHERE follower_id = v_me AND followee_id = v_them;
    DELETE FROM public.community_follow_requests WHERE requester_id = v_me AND target_id = v_them;
    DELETE FROM public.community_notifications WHERE kind = 'follow_request' AND recipient_user_id = v_them AND actor_user_id = v_me;
    RETURN public.community_follow_state();
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = v_me AND f.followee_id = v_them) THEN
    RETURN public.community_follow_state();
  END IF;
  IF public.community_is_private(v_them) AND NOT public.community_is_staff(auth.uid()) THEN
    INSERT INTO public.community_follow_requests (requester_id, target_id) VALUES (v_me, v_them) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      DELETE FROM public.community_notifications WHERE kind = 'follow_request' AND recipient_user_id = v_them AND actor_user_id = v_me;
      PERFORM public.community_notify(v_them, v_me, 'follow_request', NULL, NULL, NULL);
    END IF;
    RETURN public.community_follow_state();
  END IF;
  INSERT INTO public.community_follows (follower_id, followee_id) VALUES (v_me, v_them) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 AND NOT EXISTS (SELECT 1 FROM public.community_notifications n
                                 WHERE n.kind = 'follow' AND n.recipient_user_id = v_them AND n.actor_user_id = v_me) THEN
    PERFORM public.community_notify(v_them, v_me, 'follow', NULL, NULL, NULL);
  END IF;
  RETURN public.community_follow_state();
END;
$$;

/** Confirm (true) or delete (false) someone's request to follow me. Deleting is silent. */
CREATE OR REPLACE FUNCTION public.community_follow_respond(_user_id uuid, _approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_them uuid := public.community_main_account(_user_id);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.community_follow_requests WHERE requester_id = v_them AND target_id = v_me;
  IF NOT FOUND THEN RETURN public.community_follow_state(); END IF;
  DELETE FROM public.community_notifications WHERE kind = 'follow_request' AND recipient_user_id = v_me AND actor_user_id = v_them;
  IF coalesce(_approve, false) AND public.community_is_member(v_them) THEN
    INSERT INTO public.community_follows (follower_id, followee_id) VALUES (v_them, v_me) ON CONFLICT DO NOTHING;
  END IF;
  RETURN public.community_follow_state();
END;
$$;

/** Take someone off my followers (they aren't told; they can ask again). */
CREATE OR REPLACE FUNCTION public.community_remove_follower(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.community_follows
   WHERE follower_id = public.community_main_account(_user_id) AND followee_id = public.community_main_account(auth.uid());
  RETURN public.community_follow_state();
END;
$$;

/** Private account on / off. Members only (a coach's posts stay crew-wide). */
CREATE OR REPLACE FUNCTION public.community_set_private(_on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF public.community_is_staff(auth.uid()) OR public.community_is_staff(v_me) THEN
    RAISE EXCEPTION 'Coach accounts stay public' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.community_profiles (user_id, is_private) VALUES (v_me, coalesce(_on, false))
  ON CONFLICT (user_id) DO UPDATE SET is_private = EXCLUDED.is_private, updated_at = now();
  -- the trigger re-decides 'community' / 'followers' on every one of my crew posts
  UPDATE public.community_posts SET visibility = visibility, archived_from = archived_from
   WHERE author_user_id = v_me AND (visibility IN ('community', 'followers') OR archived_from IN ('community', 'followers'));
  IF NOT coalesce(_on, false) THEN
    INSERT INTO public.community_follows (follower_id, followee_id)
    SELECT r.requester_id, r.target_id FROM public.community_follow_requests r WHERE r.target_id = v_me
    ON CONFLICT DO NOTHING;
    DELETE FROM public.community_follow_requests WHERE target_id = v_me;
    DELETE FROM public.community_notifications WHERE kind = 'follow_request' AND recipient_user_id = v_me;
  END IF;
  RETURN public.community_follow_state();
END;
$$;

/** Add (true) / remove (false) someone on my Close Friends list. They're never told. */
CREATE OR REPLACE FUNCTION public.community_set_close_friend(_user_id uuid, _on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_them uuid := public.community_main_account(_user_id);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(_on, false) THEN
    IF v_them IS NULL OR v_them = v_me OR NOT public.community_is_member(v_them) THEN
      RAISE EXCEPTION 'That account isn''t in the crew' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.community_close_friends (owner_id, friend_id) VALUES (v_me, v_them) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.community_close_friends WHERE owner_id = v_me AND friend_id = v_them;
  END IF;
  RETURN public.community_follow_state();
END;
$$;

/** Can the signed-in person see this account's posts, lists and counts? */
CREATE OR REPLACE FUNCTION public.community_can_see_account(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.community_main_account(_user_id) = public.community_main_account(auth.uid())
      OR NOT public.community_is_private(_user_id)
      OR public.community_is_staff(auth.uid())
      OR public.community_follows_user(auth.uid(), _user_id)
$$;
REVOKE ALL ON FUNCTION public.community_can_see_account(uuid) FROM PUBLIC, anon, authenticated;

/** Someone's followers or following ('followers' | 'following'), newest first. Hidden on a private account you don't follow. */
CREATE OR REPLACE FUNCTION public.community_follow_list(_user_id uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_them uuid := public.community_main_account(_user_id);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _kind NOT IN ('followers', 'following') THEN RAISE EXCEPTION 'Invalid list'; END IF;
  IF NOT public.community_can_see_account(v_them) THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_author(x.id) ORDER BY x.at DESC)
      FROM (SELECT CASE WHEN _kind = 'followers' THEN f.follower_id ELSE f.followee_id END AS id, f.created_at AS at
              FROM public.community_follows f
             WHERE (_kind = 'followers' AND f.followee_id = v_them) OR (_kind = 'following' AND f.follower_id = v_them)) x
     WHERE public.community_is_member(x.id)
       AND NOT public.chat_has_blocked(public.community_main_account(auth.uid()), x.id)), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.community_follow_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_follow(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_follow_respond(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_remove_follower(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_set_private(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_set_close_friend(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_follow_list(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_follow_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_follow(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_follow_respond(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_remove_follower(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_set_private(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_set_close_friend(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_follow_list(uuid, text) TO authenticated;

-- ── Profile: + counts, private, can_see ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_profile(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_them uuid := public.community_main_account(_user_id);
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'author', public.community_author(_user_id),
    'bio', (SELECT cp.bio FROM public.community_profiles cp WHERE cp.user_id = _user_id),
    'is_me', _user_id = uid,
    'posts', (SELECT count(*) FROM public.community_posts p
               WHERE (p.author_user_id = _user_id OR _user_id = ANY (public.community_post_collab_ids(p.id)))
                 AND p.archived_at IS NULL
                 AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)),
    'archived', CASE WHEN _user_id = uid OR _user_id = public.community_main_account(uid)
                     THEN (SELECT count(*) FROM public.community_posts p WHERE p.author_user_id = _user_id AND p.archived_at IS NOT NULL) END,
    'training_since', (SELECT min(pc.completed_at) FROM public.pl_day_completions pc
                         JOIN public.clients c ON c.id = pc.client_id
                        WHERE c.user_id = _user_id AND pc.completed_at IS NOT NULL),
    'is_private', public.community_is_private(v_them),
    'can_see', public.community_can_see_account(v_them),
    'followers', (SELECT count(*) FROM public.community_follows f WHERE f.followee_id = v_them AND public.community_is_member(f.follower_id)),
    'following', (SELECT count(*) FROM public.community_follows f WHERE f.follower_id = v_them AND public.community_is_member(f.followee_id)));
END;
$$;

-- ── The bell: "X requested to follow you" (while it waits) ─────────────────
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_my_notifications()'::regprocedure);
  a1 text := $r$WHEN 'follow' THEN 'f:' || n.actor_user_id$r$;
  a2 text := $r$WHEN n.kind = 'follow' THEN n.actor_user_id$r$;
  a3 text := $r$(CASE WHEN n.kind = 'follow'
                 THEN public.community_is_member(n.actor_user_id) AND NOT public.chat_has_blocked(v_me, n.actor_user_id)$r$;
BEGIN
  IF position('follow_request' in v_def) > 0 THEN RETURN; END IF;
  IF position(a1 in v_def) = 0 OR position(a2 in v_def) = 0 OR position(a3 in v_def) = 0 THEN
    RAISE EXCEPTION 'community_my_notifications: follow anchors not found';
  END IF;
  v_def := replace(v_def, a1, $r$WHEN 'follow_request' THEN 'q:' || n.actor_user_id WHEN 'follow' THEN 'f:' || n.actor_user_id$r$);
  v_def := replace(v_def, a2, $r$WHEN n.kind IN ('follow', 'follow_request') THEN n.actor_user_id$r$);
  v_def := replace(v_def, a3, $r$(CASE WHEN n.kind IN ('follow', 'follow_request')
                 THEN public.community_is_member(n.actor_user_id) AND NOT public.chat_has_blocked(v_me, n.actor_user_id)
                      AND (n.kind = 'follow' OR EXISTS (SELECT 1 FROM public.community_follow_requests fr
                                                          WHERE fr.requester_id = n.actor_user_id AND fr.target_id = v_me))$r$);
  EXECUTE v_def;
END $$;

-- ── Direct messages: someone who follows you can write straight in ─────────
/** (internal) The pair's chat, made as a request if it's new, unless _other follows _me (then it opens straight away). Blocks apply silently. */
CREATE OR REPLACE FUNCTION public.chat_direct_open(_me uuid, _other uuid)
RETURNS public.chat_groups LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := least(_me::text, _other::text) || ':' || greatest(_me::text, _other::text);
  v_open boolean;
  g public.chat_groups;
BEGIN
  SELECT * INTO g FROM public.chat_groups WHERE direct_key = v_key;
  IF NOT FOUND THEN
    v_open := public.community_follows_user(_other, _me)
              AND NOT EXISTS (SELECT 1 FROM public.chat_user_blocks b
                               WHERE (b.user_id = _me AND b.blocked_user_id = _other) OR (b.user_id = _other AND b.blocked_user_id = _me));
    IF NOT v_open AND (SELECT count(*) FROM public.chat_groups x
         WHERE x.kind = 'direct' AND x.requested_by = _me AND x.created_at > now() - interval '1 day'
           -- a chat that opened straight away (accepted the moment it was made) was never a request
           AND x.accepted_at IS DISTINCT FROM x.created_at) >= public.chat_request_daily_cap() THEN
      RAISE EXCEPTION 'request_daily_limit';
    END IF;
    INSERT INTO public.chat_groups (name, kind, direct_key, direct_status, requested_by, created_by, accepted_at)
    VALUES ('Direct message', 'direct', v_key, CASE WHEN v_open THEN 'active' ELSE 'request' END, _me, _me,
            CASE WHEN v_open THEN now() END)
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
