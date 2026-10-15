-- Crew: Training partners.
--
-- Two people who follow each other are training partners. Follow stays
-- one-way, private and count-free; a partnership is the only thing it unlocks,
-- because a one-way follow needs nobody's say-so and so can't gate anything
-- personal. Partners get:
--
--   * 'partners' posts: a fourth audience next to JF crew / My coach / Only me.
--     Seen by the author and their current partners only (not staff, unless a
--     coach is a partner, same as member-made chats). Unfollowing, or a block
--     either way, ends the partnership and the posts drop out of view at once:
--     nothing is copied, it's all one rule in community_post_visible().
--   * Direct messages that open straight away: a new 1:1 between partners
--     starts 'active' (no request, no daily request cap). Both people chose to
--     follow each other, so it can't be a cold message. An older pending
--     request between them stays a request (a silent decline stays silent).
--   * "Training partner" next to their name (follow state returns 'partners').
--
-- Partners posts earn no League points, never push, and never feed Wins,
-- Recap or tags (those all check visibility = 'community' and are untouched).

-- ── Who's a partner ─────────────────────────────────────────────────────────
-- Main accounts in, both in the crew, both follow each other, no block either way.
CREATE OR REPLACE FUNCTION public.community_are_partners(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b
     AND EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = _a AND f.followee_id = _b)
     AND EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = _b AND f.followee_id = _a)
     AND NOT EXISTS (SELECT 1 FROM public.chat_user_blocks b
                      WHERE (b.user_id = _a AND b.blocked_user_id = _b) OR (b.user_id = _b AND b.blocked_user_id = _a))
     AND NOT public.chat_has_blocked(_a, _b) AND NOT public.chat_has_blocked(_b, _a)
     AND public.community_is_member(_a) AND public.community_is_member(_b)
$$;

-- The signed-in person's partners, as a set (for `author IN (SELECT ...)`, checked once per query).
CREATE OR REPLACE FUNCTION public.community_partner_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT f.followee_id FROM public.community_follows f
   WHERE f.follower_id = public.community_main_account(auth.uid())
     AND public.community_are_partners(f.follower_id, f.followee_id)
$$;

REVOKE ALL ON FUNCTION public.community_are_partners(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_partner_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_are_partners(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_partner_ids() TO service_role;

-- ── The audience ────────────────────────────────────────────────────────────
ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_visibility_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_visibility_check
  CHECK (visibility IN ('community', 'coach', 'partners', 'private'));

-- The one visibility rule (RLS, storage, detail, reactions, comments, bell).
CREATE OR REPLACE FUNCTION public.community_post_visible(_visibility text, _author uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    _author = auth.uid()
    OR (_visibility = 'community' AND public.can_view_community())
    OR (_visibility = 'coach' AND (public.has_role(auth.uid(), 'admin') OR public.is_assigned_coach_for_client(_client)))
    OR (_visibility = 'partners' AND public.can_view_community()
        AND public.community_are_partners(public.community_main_account(auth.uid()), public.community_main_account(_author))))
$$;
REVOKE ALL ON FUNCTION public.community_post_visible(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_visible(text, uuid, uuid) TO authenticated, service_role;

-- Feed + profile grid: partners posts from my partners, and my own.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_feed(integer, timestamptz, uuid, uuid)'::regprocedure);
  v_anchor text := '            OR (p.visibility = ''coach'' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))';
BEGIN
  IF position('''partners''' in v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'community_feed: anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_anchor || '
            OR (p.visibility = ''partners'' AND (p.author_user_id = uid OR p.author_user_id IN (SELECT public.community_partner_ids())))');
END $$;

-- Crew's "N new" badge counts a partner's new post like any other.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.community_activity()'::regprocedure);
  v_anchor text := '(p.visibility = ''community'' OR (p.visibility = ''coach'' AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)))';
BEGIN
  IF position('''partners''' in v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'community_activity: anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, v_anchor,
    '(p.visibility = ''community'' OR (p.visibility = ''coach'' AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))'
    || ' OR (p.visibility = ''partners'' AND p.author_user_id IN (SELECT public.community_partner_ids())))');
END $$;

-- Posting / editing / sharing a workout accept 'partners' (crew access required, like JF crew).
DO $$
DECLARE
  r record;
  v_def text;
  v_patched int := 0;
  a1 text := 'IF _visibility NOT IN (''community'', ''coach'', ''private'')';
  b1 text := 'IF _visibility NOT IN (''community'', ''coach'', ''partners'', ''private'')';
  a2 text := 'IF _visibility = ''community'' AND NOT public.can_view_community()';
  b2 text := 'IF _visibility IN (''community'', ''partners'') AND NOT public.can_view_community()';
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('community_create_post', 'community_edit_post', 'community_save_post') LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position(b1 in v_def) > 0 THEN v_patched := v_patched + 1; CONTINUE; END IF;
    IF position(a1 in v_def) = 0 OR position(a2 in v_def) = 0 THEN CONTINUE; END IF;
    EXECUTE replace(replace(v_def, a1, b1), a2, b2);
    v_patched := v_patched + 1;
  END LOOP;
  IF v_patched < 3 THEN RAISE EXCEPTION 'partners audience: expected create/edit/save post to take it, patched %', v_patched; END IF;
END $$;

-- ── Follow state: + partners ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_follow_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN
    RETURN jsonb_build_object('following', '[]'::jsonb, 'followers', '[]'::jsonb, 'partners', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'following', coalesce((SELECT jsonb_agg(f.followee_id ORDER BY f.created_at DESC) FROM public.community_follows f
                            WHERE f.follower_id = v_me AND public.community_is_member(f.followee_id)), '[]'::jsonb),
    'followers', coalesce((SELECT jsonb_agg(f.follower_id ORDER BY f.created_at DESC) FROM public.community_follows f
                            WHERE f.followee_id = v_me AND public.community_is_member(f.follower_id)
                              AND NOT public.chat_has_blocked(v_me, f.follower_id)), '[]'::jsonb),
    'partners', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM public.community_partner_ids() x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.community_follow_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_follow_state() TO authenticated;

-- ── Direct messages: partners skip the request ──────────────────────────────
/** (internal) The pair's chat, made as a request if it's new (open straight away between partners). Blocks apply silently. */
CREATE OR REPLACE FUNCTION public.chat_direct_open(_me uuid, _other uuid)
RETURNS public.chat_groups LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := least(_me::text, _other::text) || ':' || greatest(_me::text, _other::text);
  v_partners boolean;
  g public.chat_groups;
BEGIN
  SELECT * INTO g FROM public.chat_groups WHERE direct_key = v_key;
  IF NOT FOUND THEN
    v_partners := public.community_are_partners(public.community_main_account(_me), public.community_main_account(_other));
    IF NOT v_partners AND (SELECT count(*) FROM public.chat_groups x
         WHERE x.kind = 'direct' AND x.requested_by = _me AND x.created_at > now() - interval '1 day'
           -- a partner chat opened active (accepted the moment it was made) was never a request
           AND x.accepted_at IS DISTINCT FROM x.created_at) >= public.chat_request_daily_cap() THEN
      RAISE EXCEPTION 'request_daily_limit';
    END IF;
    INSERT INTO public.chat_groups (name, kind, direct_key, direct_status, requested_by, created_by, accepted_at)
    VALUES ('Direct message', 'direct', v_key, CASE WHEN v_partners THEN 'active' ELSE 'request' END, _me, _me,
            CASE WHEN v_partners THEN now() END)
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
