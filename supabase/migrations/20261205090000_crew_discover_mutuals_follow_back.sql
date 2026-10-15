-- Find athletes, round two (Instagram's "Discover people" in our own way):
--
--   1. Mutuals on every person card: up to 3 faces + how many people you
--      follow also follow them, so "Followed by Nicole + 2 more" comes with
--      their photos. Rides on community_person_json, so search, suggestions
--      and Follow back all get it.
--   2. Follow back: everyone who follows you that you don't follow back, newest
--      first, in its own section (not mixed into suggestions).
--   3. "Hide" on the feed's suggestion row: off the feed for 30 days, kept on
--      the account (every device), and Find athletes still shows everyone.

-- ── 1. Mutuals ──────────────────────────────────────────────────────────────
-- People the viewer follows who also follow them: members only, never the
-- two of them, nobody blocked either way. Faces are the 3 most recent.
CREATE OR REPLACE FUNCTION public.community_mutuals(_viewer uuid, _them uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH m AS (
    SELECT f2.follower_id AS id, f2.created_at AS at
      FROM public.community_follows f1
      JOIN public.community_follows f2 ON f2.follower_id = f1.followee_id
     WHERE f1.follower_id = _viewer AND f2.followee_id = _them
       AND f2.follower_id NOT IN (_viewer, _them)
       AND public.community_is_member(f2.follower_id)
       AND NOT public.chat_has_blocked(_viewer, f2.follower_id)
       AND NOT public.chat_has_blocked(f2.follower_id, _viewer)
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM m),
    'faces', coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', a->>'user_id', 'name', a->>'name', 'avatar_url', a->>'avatar_url') ORDER BY t.at DESC)
                         FROM (SELECT m.id, m.at FROM m ORDER BY m.at DESC LIMIT 3) t
                         CROSS JOIN LATERAL (SELECT public.community_author(t.id) AS a) x), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.community_mutuals(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_mutuals(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.community_person_json(_user_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.community_author(_user_id) || jsonb_build_object(
    'username', cp.username::text,
    'is_private', coalesce(cp.is_private, false),
    'disciplines', coalesce(to_jsonb(cp.disciplines), '[]'::jsonb),
    'follows_you', EXISTS (SELECT 1 FROM public.community_follows f WHERE f.follower_id = _user_id AND f.followee_id = _viewer),
    'mutuals', public.community_mutuals(_viewer, _user_id))
  FROM (SELECT 1) one
  LEFT JOIN public.community_profiles cp ON cp.user_id = _user_id
$$;
REVOKE ALL ON FUNCTION public.community_person_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_person_json(uuid, uuid) TO service_role;

-- ── 2. Follow back ──────────────────────────────────────────────────────────
-- Same findable set as search (no blocks either way, no linked logins), so a
-- follower who hid their account from suggestions still shows: they follow you.
-- A × (community_hide_suggestion) takes someone off this list too.
CREATE OR REPLACE FUNCTION public.community_follow_back(_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_person_json(x.user_id, v_me) || jsonb_build_object('followed_at', x.at) ORDER BY x.at DESC, x.user_id)
      FROM (SELECT p.user_id, f.created_at AS at
              FROM public.community_findable_people(v_me) p
              JOIN public.community_follows f ON f.follower_id = p.user_id AND f.followee_id = v_me
             WHERE NOT EXISTS (SELECT 1 FROM public.community_follows m WHERE m.follower_id = v_me AND m.followee_id = p.user_id)
               AND NOT EXISTS (SELECT 1 FROM public.community_follow_requests r WHERE r.requester_id = v_me AND r.target_id = p.user_id)
               AND NOT EXISTS (SELECT 1 FROM public.community_suggestion_hides h WHERE h.user_id = v_me AND h.hidden_user_id = p.user_id)
             ORDER BY f.created_at DESC, p.user_id
             LIMIT greatest(1, least(coalesce(_limit, 30), 100))) x), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_follow_back(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_follow_back(integer) TO authenticated;

-- ── 3. Hide suggestions from the feed ───────────────────────────────────────
ALTER TABLE public.community_profiles ADD COLUMN IF NOT EXISTS feed_suggestions_hidden_until timestamptz;

CREATE OR REPLACE FUNCTION public.community_hide_feed_suggestions(_hide boolean DEFAULT true)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.community_main_account(auth.uid());
  v_until timestamptz := CASE WHEN coalesce(_hide, true) THEN now() + interval '30 days' END;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.community_profiles (user_id, feed_suggestions_hidden_until) VALUES (v_me, v_until)
  ON CONFLICT (user_id) DO UPDATE SET feed_suggestions_hidden_until = EXCLUDED.feed_suggestions_hidden_until, updated_at = now();
  RETURN v_until;
END;
$$;
REVOKE ALL ON FUNCTION public.community_hide_feed_suggestions(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_hide_feed_suggestions(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_my_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'auto_share_workouts', coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = auth.uid()), true),
    'private_views', coalesce((SELECT cp.private_views FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), false),
    'discoverable', coalesce((SELECT cp.discoverable FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), true),
    'username', (SELECT cp.username::text FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())),
    'disciplines', coalesce((SELECT to_jsonb(cp.disciplines) FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())), '[]'::jsonb),
    'home_gym', (SELECT cp.home_gym FROM public.community_profiles cp WHERE cp.user_id = public.community_main_account(auth.uid())),
    'feed_suggestions_hidden_until', (SELECT cp.feed_suggestions_hidden_until FROM public.community_profiles cp
                                       WHERE cp.user_id = public.community_main_account(auth.uid()) AND cp.feed_suggestions_hidden_until > now()))
  WHERE auth.uid() IS NOT NULL;
$$;
