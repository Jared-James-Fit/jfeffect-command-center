-- Share sheet: send a post to the people you talk to most (Nov 13 2026).
--
-- The coach wanted a post's ✈️ to work like Instagram's: the people you're
-- most likely to send it to on top (a smart guess from who you actually talk
-- to and send posts to), pick one or several, add a message, Send; then every
-- other way out (copy link, Messages, WhatsApp, ...) underneath.
--
--   community_share_targets(post, q, limit)  who it can go to, best guess
--                                           first (or matching a search)
--   community_share_post(post, to[], body)   sends it to each, in one call
--
-- A target is a key: 'p:<user>' a 1:1 (member to member, through
-- chat_direct_open, so a new chat is a request unless they follow you and
-- blocks stay silent), 'g:<group>' a group chat you can post in, 'coach' a
-- coaching client's coach chat, 'c:<client>' a client's coach chat (staff).
-- Only someone who can see the post gets it: a crew-wide post goes anywhere,
-- a private account's followers-only post only to its followers (never a
-- group), Close Friends / coach-only / private posts only to your own coach
-- chat. Every send is kept in community_post_sends (server only), which is
-- what "who you send posts to" reads next time.

CREATE TABLE IF NOT EXISTS public.community_post_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  target text NOT NULL,
  target_user_id uuid,
  group_id uuid,
  client_id uuid,
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_post_sends_sender_idx ON public.community_post_sends (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS community_post_sends_post_idx ON public.community_post_sends (post_id);
ALTER TABLE public.community_post_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_post_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_post_sends TO service_role;

/** (internal) The signed-in person's own coaching client record (their coach chat), or null. */
CREATE OR REPLACE FUNCTION public.community_share_my_client(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id FROM public.clients c
   WHERE c.user_id = _uid AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
     AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false
     AND c.service_tier = 'coaching'
   ORDER BY c.created_at DESC LIMIT 1
$$;

/** (internal) Is _uid a coach or admin here (themselves or a linked login), like community_message_author reads it? */
CREATE OR REPLACE FUNCTION public.community_share_is_staff(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((public.community_author(_uid)->>'is_coach')::boolean, false)
$$;

/**
 * Why this post can't go to this target from _uid (a key: 'p:<user>',
 * 'g:<group>', 'coach', 'c:<client>'), or null when it can. The sender's own
 * view of the post is checked by the callers (community_post_visible).
 */
CREATE OR REPLACE FUNCTION public.community_share_refusal(_post_id uuid, _target text, _uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  p public.community_posts;
  v_kind text := split_part(coalesce(_target, ''), ':', 1);
  v_me uuid := public.community_main_account(_uid);
  v_author uuid;
  v_staff boolean;
  v_id uuid;
  v_other uuid;
BEGIN
  IF _uid IS NULL THEN RETURN 'Not allowed'; END IF;
  SELECT * INTO p FROM public.community_posts cp WHERE cp.id = _post_id AND cp.archived_at IS NULL;
  IF NOT FOUND THEN RETURN 'Post not found'; END IF;
  v_author := public.community_main_account(p.author_user_id);
  v_staff := public.community_share_is_staff(_uid);
  IF v_kind IN ('p', 'g', 'c') THEN
    BEGIN
      v_id := split_part(_target, ':', 2)::uuid;
    EXCEPTION WHEN others THEN
      RETURN 'Not found';
    END;
  ELSIF v_kind <> 'coach' THEN
    RETURN 'Not found';
  END IF;

  IF v_kind = 'p' THEN
    -- coaches answer people in their coach chat, never a 1:1
    IF v_staff THEN RETURN 'Not found'; END IF;
    v_other := public.community_main_account(v_id);
    IF v_other IS NULL OR v_other = v_me THEN RETURN 'Not found'; END IF;
    -- a coach is your coach chat, not a 1:1
    IF public.community_share_is_staff(v_other) THEN RETURN 'Not found'; END IF;
    IF NOT public.chat_community_ok(_uid) OR NOT public.chat_community_ok(v_other) THEN
      RETURN 'They can''t get messages right now';
    END IF;
    IF public.chat_has_blocked(v_me, v_other) OR public.chat_has_blocked(v_other, v_me)
       OR v_other IN (SELECT public.community_blocked_authors()) THEN
      RETURN 'Not found';
    END IF;
    -- they have to be able to see it: a block between them and the author hides it
    IF public.chat_has_blocked(v_author, v_other) OR public.chat_has_blocked(v_other, v_author) THEN
      RETURN 'They can''t see this post';
    END IF;
    IF p.visibility = 'community' THEN RETURN NULL; END IF;
    IF p.visibility = 'followers'
       AND (v_other = v_author OR public.community_follows_user(v_other, p.author_user_id)) THEN
      RETURN NULL;
    END IF;
    RETURN 'They can''t see this post';
  END IF;

  IF v_kind = 'g' THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_groups g WHERE g.id = v_id AND g.kind IN ('crew', 'group'))
       OR NOT public.is_group_member(v_id, _uid)
       OR NOT public.chat_can_post(v_id, _uid, '[]'::jsonb) THEN
      RETURN 'Not found';
    END IF;
    IF p.visibility <> 'community' THEN RETURN 'Only posts shared with the whole crew can go to a group'; END IF;
    RETURN NULL;
  END IF;

  IF v_kind = 'coach' THEN
    IF v_staff OR public.community_share_my_client(_uid) IS NULL THEN RETURN 'Not found'; END IF;
    -- your coach sees every post but a private one
    IF p.visibility = 'private' THEN RETURN 'Only you can see this post'; END IF;
    RETURN NULL;
  END IF;

  -- 'c': a client's coach chat, from their coach or an admin
  IF NOT v_staff THEN RETURN 'Not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = v_id AND c.user_id IS NOT NULL AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
       AND c.service_tier = 'coaching'
       AND (public.has_role(_uid, 'admin') OR c.id IN (SELECT public.coached_client_ids()))) THEN
    RETURN 'Not found';
  END IF;
  IF p.visibility = 'community' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_id AND public.community_main_account(c.user_id) = v_author)
     AND p.visibility <> 'private' THEN
    RETURN NULL;
  END IF;
  RETURN 'They can''t see this post';
END;
$$;

/**
 * Who this post can go to, best guess first: the people (and group chats,
 * and your coach chat) you've sent posts to and talked to most lately, then
 * the people you like and comment on, who do the same on yours, and who you
 * follow. With _q, everyone it can go to whose name or @username matches.
 * Each: { key, kind ('person' | 'group' | 'coach' | 'client'), name,
 * avatar_url, username?, user_id?, group_id?, client_id?, faces? }.
 */
CREATE OR REPLACE FUNCTION public.community_share_targets(_post_id uuid DEFAULT NULL, _q text DEFAULT NULL, _limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_q text := left(lower(btrim(regexp_replace(coalesce(_q, ''), '^\s*@+', ''))), 40);
  lim int := least(greatest(coalesce(_limit, 30), 1), 60);
  v_staff boolean;
  v_client uuid;
  v_coach uuid;
  v_out jsonb;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _post_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.community_posts p
        WHERE p.id = _post_id AND p.archived_at IS NULL
          AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RETURN '[]'::jsonb;
  END IF;
  v_staff := public.community_share_is_staff(uid);

  IF v_staff THEN
    -- a coach sends to clients' coach chats (theirs, or everyone's for an admin) and their group chats
    WITH cl AS (
      SELECT c.id, c.user_id, public.community_author(c.user_id) AS a
        FROM public.clients c
       WHERE c.user_id IS NOT NULL AND coalesce(c.archived, false) = false AND c.archived_at IS NULL
         AND coalesce(c.status, '') <> 'Archived' AND c.service_tier = 'coaching'
         AND (public.has_role(uid, 'admin') OR c.id IN (SELECT public.coached_client_ids()))
    ), talk AS (
      SELECT m.client_id, count(*) AS n, max(m.created_at) AS last_at
        FROM public.messages m
       WHERE m.client_id IN (SELECT id FROM cl) AND m.created_at > now() - interval '30 days'
         AND NOT coalesce(m.is_internal_note, false)
       GROUP BY m.client_id
    ), sent AS (
      SELECT s.target, count(*) AS n, max(s.created_at) AS last_at
        FROM public.community_post_sends s
       WHERE s.sender_id = uid AND s.created_at > now() - interval '120 days'
       GROUP BY s.target
    ), grp AS (
      SELECT g.id, g.name,
             (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.deleted_at IS NULL
                AND m.created_at > now() - interval '30 days') AS n,
             (SELECT max(m.created_at) FROM public.group_messages m WHERE m.group_id = g.id AND m.deleted_at IS NULL) AS last_at
        FROM public.chat_group_members mine
        JOIN public.chat_groups g ON g.id = mine.group_id AND g.kind IN ('crew', 'group')
       WHERE mine.user_id = uid AND public.chat_can_post(g.id, uid, '[]'::jsonb)
    ), cand AS (
      SELECT 'c:' || cl.id AS key, 'client' AS kind, cl.a->>'name' AS name, cl.a->>'username' AS username,
             cl.a || jsonb_build_object('client_id', cl.id) AS j,
             3 * ln(1 + coalesce(t.n, 0))
               + CASE WHEN t.last_at > now() - interval '3 days' THEN 3 WHEN t.last_at > now() - interval '14 days' THEN 1.5 ELSE 0 END
               + 2.5 * ln(1 + coalesce(s.n, 0)) + CASE WHEN s.last_at > now() - interval '14 days' THEN 2 ELSE 0 END AS score
        FROM cl
        LEFT JOIN talk t ON t.client_id = cl.id
        LEFT JOIN sent s ON s.target = 'c:' || cl.id
      UNION ALL
      SELECT 'g:' || grp.id, 'group', coalesce(nullif(btrim(grp.name), ''), 'Group'), NULL,
             jsonb_build_object('group_id', grp.id, 'name', coalesce(nullif(btrim(grp.name), ''), 'Group')),
             2.5 * ln(1 + grp.n)
               + CASE WHEN grp.last_at > now() - interval '7 days' THEN 2 WHEN grp.last_at > now() - interval '30 days' THEN 1 ELSE 0 END
               + 2.5 * ln(1 + coalesce(s.n, 0))
        FROM grp
        LEFT JOIN sent s ON s.target = 'g:' || grp.id
    ), pick AS (
      SELECT cand.*,
             CASE WHEN v_q = '' THEN 0
                  WHEN starts_with(lower(coalesce(cand.username, '')), v_q) THEN 0
                  WHEN starts_with(lower(coalesce(cand.name, '')), v_q) THEN 1
                  WHEN position(' ' || v_q IN ' ' || lower(coalesce(cand.name, ''))) > 0 THEN 2
                  ELSE 3 END AS rank
        FROM cand
       WHERE (v_q = '' OR position(v_q IN lower(coalesce(cand.name, ''))) > 0
                       OR position(v_q IN lower(coalesce(cand.username, ''))) > 0)
         AND (_post_id IS NULL OR public.community_share_refusal(_post_id, cand.key, uid) IS NULL)
       ORDER BY 7, cand.score DESC, lower(cand.name)
       LIMIT lim
    )
    SELECT coalesce(jsonb_agg(pick.j || jsonb_build_object('key', pick.key, 'kind', pick.kind)
                              || CASE WHEN pick.kind = 'group' THEN jsonb_build_object('faces', public.community_share_faces(pick.key, uid)) ELSE '{}'::jsonb END
                              ORDER BY pick.rank, pick.score DESC, lower(pick.name)), '[]'::jsonb)
      INTO v_out FROM pick;
    RETURN v_out;
  END IF;

  -- a member or a coaching client
  v_client := public.community_share_my_client(uid);
  IF v_client IS NOT NULL THEN
    SELECT co.user_id INTO v_coach
      FROM public.clients c JOIN public.coaches co ON co.id = c.assigned_coach_id
     WHERE c.id = v_client AND co.user_id IS NOT NULL LIMIT 1;
  END IF;

  WITH dm AS (
    -- my 1:1s (live ones, and requests I sent): how much we've talked lately
    SELECT public.community_main_account(o.user_id) AS person,
           (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.deleted_at IS NULL
              AND m.created_at > now() - interval '60 days') AS n,
           (SELECT max(m.created_at) FROM public.group_messages m WHERE m.group_id = g.id AND m.deleted_at IS NULL) AS last_at
      FROM public.chat_group_members mine
      JOIN public.chat_groups g ON g.id = mine.group_id AND g.kind = 'direct'
      JOIN public.chat_group_members o ON o.group_id = g.id AND o.user_id <> mine.user_id
     WHERE mine.user_id = uid
       AND (g.direct_status = 'active' OR g.requested_by = uid)
       AND NOT EXISTS (SELECT 1 FROM public.chat_direct_closed x WHERE x.group_id = g.id AND x.user_id = uid)
  ), sent AS (
    SELECT s.target, count(*) AS n, max(s.created_at) AS last_at
      FROM public.community_post_sends s
     WHERE s.sender_id = uid AND s.created_at > now() - interval '120 days'
     GROUP BY s.target
  ), gave AS (
    -- my likes and comments on their posts lately
    SELECT public.community_main_account(p.author_user_id) AS person, count(*) AS n
      FROM (SELECT r.post_id FROM public.community_reactions r
             WHERE r.user_id IN (uid, v_me) AND r.created_at > now() - interval '60 days'
            UNION ALL
            SELECT c.post_id FROM public.community_comments c
             WHERE c.author_user_id IN (uid, v_me) AND c.created_at > now() - interval '60 days') x
      JOIN public.community_posts p ON p.id = x.post_id
     GROUP BY 1
  ), got AS (
    -- theirs on mine
    SELECT public.community_main_account(x.person) AS person, count(*) AS n
      FROM (SELECT r.user_id AS person FROM public.community_reactions r
              JOIN public.community_posts p ON p.id = r.post_id
             WHERE p.author_user_id IN (uid, v_me) AND r.created_at > now() - interval '60 days'
            UNION ALL
            SELECT c.author_user_id FROM public.community_comments c
              JOIN public.community_posts p ON p.id = c.post_id
             WHERE p.author_user_id IN (uid, v_me) AND c.created_at > now() - interval '60 days') x
     GROUP BY 1
  ), fol AS (
    SELECT x.person, bool_or(x.i_follow) AS i_follow, bool_or(x.follows_me) AS follows_me FROM (
      SELECT f.followee_id AS person, true AS i_follow, false AS follows_me FROM public.community_follows f WHERE f.follower_id = v_me
      UNION ALL
      SELECT f.follower_id, false, true FROM public.community_follows f WHERE f.followee_id = v_me) x
     GROUP BY x.person
  ), findable AS (
    SELECT fp.user_id, fp.name, fp.username, fp.connected, fp.suggestable
      FROM public.community_findable_people(v_me) fp
     WHERE fp.user_id NOT IN (SELECT st FROM public.community_staff_people() st WHERE st IS NOT NULL)
       AND fp.user_id NOT IN (SELECT public.community_blocked_authors())
  ), people AS (
    SELECT f.user_id, f.name, f.username,
           3 * ln(1 + coalesce(dm.n, 0))
             + CASE WHEN dm.last_at > now() - interval '7 days' THEN 3 WHEN dm.last_at > now() - interval '30 days' THEN 1.5
                    WHEN dm.last_at IS NOT NULL THEN 0.5 ELSE 0 END
             + 2.5 * ln(1 + coalesce(s.n, 0)) + CASE WHEN s.last_at > now() - interval '14 days' THEN 2 ELSE 0 END
             + 1.2 * ln(1 + coalesce(gave.n, 0)) + 0.8 * ln(1 + coalesce(got.n, 0))
             + CASE WHEN fol.i_follow AND fol.follows_me THEN 1.5 WHEN fol.i_follow THEN 0.8 WHEN fol.follows_me THEN 0.4 ELSE 0 END
             AS score,
           (dm.person IS NOT NULL OR s.target IS NOT NULL OR gave.person IS NOT NULL OR got.person IS NOT NULL OR fol.person IS NOT NULL) AS known,
           (SELECT count(*) FROM public.community_follows ff WHERE ff.followee_id = f.user_id) AS followers
      FROM findable f
      LEFT JOIN (SELECT person, sum(n) AS n, max(last_at) AS last_at FROM dm GROUP BY person) dm ON dm.person = f.user_id
      LEFT JOIN sent s ON s.target = 'p:' || f.user_id
      LEFT JOIN gave ON gave.person = f.user_id
      LEFT JOIN got ON got.person = f.user_id
      LEFT JOIN fol ON fol.person = f.user_id
     WHERE (f.suggestable OR f.connected)
  ), grp AS (
    SELECT g.id, g.name,
           (SELECT count(*) FROM public.group_messages m WHERE m.group_id = g.id AND m.deleted_at IS NULL
              AND m.created_at > now() - interval '30 days') AS n,
           (SELECT max(m.created_at) FROM public.group_messages m WHERE m.group_id = g.id AND m.deleted_at IS NULL) AS last_at
      FROM public.chat_group_members mine
      JOIN public.chat_groups g ON g.id = mine.group_id AND g.kind IN ('crew', 'group')
     WHERE mine.user_id = uid AND public.chat_can_post(g.id, uid, '[]'::jsonb)
  ), coach AS (
    SELECT (SELECT count(*) FROM public.messages m WHERE m.client_id = v_client AND m.created_at > now() - interval '60 days'
              AND NOT coalesce(m.is_internal_note, false)) AS n,
           (SELECT max(m.created_at) FROM public.messages m WHERE m.client_id = v_client AND NOT coalesce(m.is_internal_note, false)) AS last_at,
           public.community_author(v_coach) AS a
     WHERE v_client IS NOT NULL AND v_coach IS NOT NULL
  ), cand AS (
    SELECT 'p:' || p.user_id AS key, 'person' AS kind, p.name, p.username,
           public.community_author(p.user_id) AS j, p.score, p.known, p.followers
      FROM people p
     WHERE v_q <> '' OR p.known
    UNION ALL
    -- nobody yet (a new account): the crew's best-followed, so the grid is never empty
    SELECT 'p:' || p.user_id, 'person', p.name, p.username, public.community_author(p.user_id), p.score, p.known, p.followers
      FROM people p
     WHERE v_q = '' AND NOT p.known AND p.user_id IN (
             SELECT p2.user_id FROM people p2 WHERE NOT p2.known ORDER BY p2.followers DESC, lower(p2.name) LIMIT 12)
    UNION ALL
    SELECT 'g:' || grp.id, 'group', coalesce(nullif(btrim(grp.name), ''), 'Group'), NULL,
           jsonb_build_object('group_id', grp.id, 'name', coalesce(nullif(btrim(grp.name), ''), 'Group')),
           2.5 * ln(1 + grp.n)
             + CASE WHEN grp.last_at > now() - interval '7 days' THEN 2 WHEN grp.last_at > now() - interval '30 days' THEN 1 ELSE 0 END
             + 2.5 * ln(1 + coalesce(s.n, 0)),
           true, 0
      FROM grp LEFT JOIN sent s ON s.target = 'g:' || grp.id
    UNION ALL
    -- your coach chat: where most of a client's messages go
    SELECT 'coach', 'coach', coach.a->>'name', coach.a->>'username', coach.a,
           3 + 2 * ln(1 + coach.n)
             + CASE WHEN coach.last_at > now() - interval '7 days' THEN 2 ELSE 0 END
             + 2.5 * ln(1 + coalesce(s.n, 0)),
           true, 0
      FROM coach LEFT JOIN sent s ON s.target = 'coach'
  ), pick AS (
    SELECT cand.*,
           CASE WHEN v_q = '' THEN 0
                WHEN starts_with(lower(coalesce(cand.username, '')), v_q) THEN 0
                WHEN starts_with(lower(coalesce(cand.name, '')), v_q) THEN 1
                WHEN position(' ' || v_q IN ' ' || lower(coalesce(cand.name, ''))) > 0 THEN 2
                ELSE 3 END AS rank
      FROM cand
     WHERE (v_q = '' OR position(v_q IN lower(coalesce(cand.name, ''))) > 0
                     OR position(v_q IN lower(coalesce(cand.username, ''))) > 0
                     OR (cand.kind = 'coach' AND position(v_q IN 'coach') = 1))
       AND (_post_id IS NULL OR public.community_share_refusal(_post_id, cand.key, uid) IS NULL)
     ORDER BY 9, cand.known DESC, cand.score DESC, cand.followers DESC, lower(cand.name)
     LIMIT lim
  )
  SELECT coalesce(jsonb_agg(pick.j || jsonb_build_object('key', pick.key, 'kind', pick.kind)
                            || CASE WHEN pick.kind = 'group' THEN jsonb_build_object('faces', public.community_share_faces(pick.key, uid)) ELSE '{}'::jsonb END
                            ORDER BY pick.rank, pick.known DESC, pick.score DESC, pick.followers DESC, lower(pick.name)), '[]'::jsonb)
    INTO v_out FROM pick;
  RETURN v_out;
END;
$$;

/** (internal) Up to two faces for a group chat's circle: its other members' Crew photos, most recent first. */
CREATE OR REPLACE FUNCTION public.community_share_faces(_key text, _uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(f.a ORDER BY f.added_at DESC), '[]'::jsonb) FROM (
    SELECT public.community_avatar(m.user_id) AS a, m.added_at
      FROM public.chat_group_members m
     WHERE _key LIKE 'g:%' AND m.group_id = nullif(split_part(_key, ':', 2), '')::uuid
       AND m.user_id <> _uid
     ORDER BY (public.community_avatar(m.user_id) IS NULL), m.added_at DESC
     LIMIT 2) f
$$;

/**
 * Send a post to each target, with an optional message (up to 20 at a time,
 * 200 a day). Each one goes on its own (a 1:1, a group, a coach chat) and
 * says how it went: { results: [{ key, ok, route?, status?, group_id?,
 * client_id?, message_id?, error? }] }. The same post to the same chat within
 * a minute is one send (a double tap).
 */
CREATE OR REPLACE FUNCTION public.community_share_post(_post_id uuid, _to text[], _body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  v_body text := btrim(coalesce(_body, ''));
  v_keys text[];
  v_key text;
  v_why text;
  v_id uuid;
  v_msg uuid;
  v_status text;
  v_client uuid;
  v_staff_id uuid;
  v_author jsonb;
  v_card jsonb;
  v_out jsonb := '[]'::jsonb;
  p public.community_posts;
  g public.chat_groups;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT array_agg(DISTINCT k) INTO v_keys FROM unnest(coalesce(_to, '{}'::text[])) k WHERE btrim(coalesce(k, '')) <> '';
  IF v_keys IS NULL THEN RAISE EXCEPTION 'Pick who to send it to'; END IF;
  IF cardinality(v_keys) > 20 THEN RAISE EXCEPTION 'Send it to up to 20 at a time'; END IF;
  IF char_length(v_body) > 2000 THEN RAISE EXCEPTION 'That message is too long'; END IF;
  SELECT * INTO p FROM public.community_posts cp
   WHERE cp.id = _post_id AND cp.archived_at IS NULL
     AND public.community_post_visible(cp.visibility, cp.author_user_id, cp.client_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found'; END IF;
  IF (SELECT count(*) FROM public.community_post_sends s WHERE s.sender_id = uid AND s.created_at > now() - interval '1 day')
       + cardinality(v_keys) > 200 THEN
    RAISE EXCEPTION 'That''s a lot of sends today. Try again tomorrow.';
  END IF;

  v_author := public.community_author(p.author_user_id);
  v_card := jsonb_build_object(
    'type', 'link', 'kind', 'community_post', 'post_id', p.id, 'shared', true, 'story', coalesce(p.story_only, false),
    'url', '/portal/community#post=' || p.id,
    'name', v_author->>'name',
    'author_avatar', v_author->>'avatar_url',
    'title', (v_author->>'name') || CASE WHEN coalesce(p.story_only, false) THEN '''s story' ELSE '''s post' END,
    'request_note', nullif(left(split_part(btrim(coalesce(p.caption, p.quote, '')), E'\n', 1), 140), ''),
    'thumb_path', coalesce(p.media_thumb_path, CASE WHEN p.media_type = 'image' THEN p.media_path END));

  FOREACH v_key IN ARRAY v_keys LOOP
    BEGIN
      -- a double tap: the same post to the same chat a moment ago is that send
      SELECT s.message_id INTO v_msg FROM public.community_post_sends s
       WHERE s.sender_id = uid AND s.post_id = p.id AND s.target = v_key AND s.created_at > now() - interval '1 minute'
       ORDER BY s.created_at DESC LIMIT 1;
      IF FOUND THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', true, 'repeat', true, 'message_id', v_msg));
        CONTINUE;
      END IF;
      v_why := public.community_share_refusal(p.id, v_key, uid);
      IF v_why IS NOT NULL THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', false, 'error', v_why));
        CONTINUE;
      END IF;
      v_id := NULL; v_client := NULL; v_msg := NULL; v_status := NULL; g := NULL;
      IF v_key LIKE 'p:%' THEN
        v_id := public.community_main_account(split_part(v_key, ':', 2)::uuid);
        g := public.chat_direct_open(uid, v_id);
        INSERT INTO public.group_messages (group_id, sender_id, sender_role, body, attachments)
        VALUES (g.id, uid, 'member', v_body, jsonb_build_array(v_card))
        RETURNING id INTO v_msg;
        SELECT cg.direct_status INTO v_status FROM public.chat_groups cg WHERE cg.id = g.id;
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', true, 'route', 'direct',
                   'group_id', g.id, 'message_id', v_msg, 'status', v_status));
      ELSIF v_key LIKE 'g:%' THEN
        v_id := split_part(v_key, ':', 2)::uuid;
        INSERT INTO public.group_messages (group_id, sender_id, sender_role, body, attachments)
        VALUES (v_id, uid, CASE WHEN public.is_coach_or_admin(uid) THEN 'admin' ELSE 'member' END, v_body, jsonb_build_array(v_card))
        RETURNING id INTO v_msg;
        UPDATE public.chat_groups SET updated_at = now() WHERE id = v_id;
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', true, 'route', 'group',
                   'group_id', v_id, 'message_id', v_msg));
      ELSIF v_key = 'coach' THEN
        v_client := public.community_share_my_client(uid);
        INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, read_by_client_at)
        VALUES (v_client, uid, 'client', v_body, jsonb_build_array(v_card), 'General', now())
        RETURNING id INTO v_msg;
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', true, 'route', 'coach',
                   'client_id', v_client, 'message_id', v_msg));
      ELSE
        v_client := split_part(v_key, ':', 2)::uuid;
        -- the staff login among this person's accounts sends it (like community_message_author)
        SELECT a.id INTO v_staff_id FROM (
          SELECT uid AS id
          UNION SELECT public.community_main_account(uid)
          UNION SELECT cp.user_id FROM public.community_profiles cp WHERE cp.same_person_as = public.community_main_account(uid)
        ) a WHERE public.has_role(a.id, 'admin') OR public.has_role(a.id, 'coach')
        ORDER BY (a.id = uid) DESC LIMIT 1;
        IF v_staff_id IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
        INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, read_by_admin_at)
        VALUES (v_client, v_staff_id, 'admin', v_body, jsonb_build_array(v_card), 'General', now())
        RETURNING id INTO v_msg;
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', true, 'route', 'client',
                   'client_id', v_client, 'message_id', v_msg));
      END IF;
      INSERT INTO public.community_post_sends (sender_id, post_id, target, target_user_id, group_id, client_id, message_id)
      VALUES (uid, p.id, v_key, CASE WHEN v_key LIKE 'p:%' THEN v_id END,
              CASE WHEN v_key LIKE 'p:%' THEN g.id WHEN v_key LIKE 'g:%' THEN v_id END, v_client, v_msg);
    EXCEPTION WHEN others THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', false, 'error', SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object('results', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.community_share_my_client(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_share_is_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_share_refusal(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_share_faces(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_share_my_client(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_share_is_staff(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_share_refusal(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_share_faces(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.community_share_targets(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_share_post(uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_share_targets(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_share_post(uuid, text[], text) TO authenticated, service_role;
