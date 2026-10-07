-- Who sees a post: JF crew (everyone in the community), Just my coach, or
-- Only me, plus "Hide my weights".
--
--   * 'coach': the author, admins, and the client's assigned coach. Never
--     other athletes. Coach recognition still works on these posts.
--   * hide_loads: every load (top set, PR loads, exercise bests, tonnage) is
--     removed server-side for everyone but the author, so hidden numbers
--     never reach another device. Reps, sets, time and PR badges stay.
--   * One rule, community_post_visible(), used by RLS, storage, the feed,
--     the detail, reactions, comments, the "new" badge and profile counts,
--     so the checks can't drift apart.

ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_visibility_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_visibility_check
  CHECK (visibility IN ('community', 'coach', 'private'));
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS hide_loads boolean NOT NULL DEFAULT false;

-- ── The one visibility rule ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_post_visible(_visibility text, _author uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    _author = auth.uid()
    OR (_visibility = 'community' AND public.can_view_community())
    OR (_visibility = 'coach' AND (public.has_role(auth.uid(), 'admin') OR public.is_assigned_coach_for_client(_client))))
$$;
REVOKE ALL ON FUNCTION public.community_post_visible(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_visible(text, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS community_posts_select ON public.community_posts;
CREATE POLICY community_posts_select ON public.community_posts FOR SELECT TO authenticated
  USING (public.community_post_visible(visibility, author_user_id, client_id));

DROP POLICY IF EXISTS "community media read" ON storage.objects;
CREATE POLICY "community media read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'community-media'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
            SELECT 1 FROM public.community_posts p
             WHERE (p.media_path = name OR p.media_thumb_path = name)
               AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
    ));

-- ── Hide my weights ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_hide_loads(_s jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _s IS NULL THEN NULL ELSE
    _s || jsonb_build_object(
      'tonnage_kg', 0,
      'top_lift', CASE WHEN jsonb_typeof(_s->'top_lift') = 'object'
                       THEN (_s->'top_lift') || '{"load_kg": null}'::jsonb ELSE _s->'top_lift' END,
      'prs', coalesce((SELECT jsonb_agg(x || '{"load_kg": null}'::jsonb) FROM jsonb_array_elements(coalesce(_s->'prs', '[]'::jsonb)) x), '[]'::jsonb))
  END
$$;
REVOKE ALL ON FUNCTION public.community_hide_loads(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_hide_exercise_loads(_e jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce((SELECT jsonb_agg(
           x || jsonb_build_object('best_load_kg', null,
                                   'max_reps', CASE WHEN jsonb_typeof(x->'max_reps') = 'number' THEN x->'max_reps' ELSE x->'best_reps' END))
           FROM jsonb_array_elements(coalesce(_e, '[]'::jsonb)) x), '[]'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.community_hide_exercise_loads(jsonb) FROM PUBLIC, anon, authenticated;

-- ── Save: new audience + hide_loads (NULL keeps the current setting) ───────
DROP FUNCTION IF EXISTS public.community_save_post(uuid, text, text, text, text, text, text, int, int);
CREATE OR REPLACE FUNCTION public.community_save_post(
  _completion_id uuid,
  _caption text DEFAULT NULL,
  _visibility text DEFAULT 'community',
  _media_action text DEFAULT 'keep',
  _media_path text DEFAULT NULL,
  _media_thumb_path text DEFAULT NULL,
  _media_type text DEFAULT NULL,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL,
  _hide_loads boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_client uuid;
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  v_id uuid;
  v_done boolean;
  v_prefix text := uid::text || '/';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF _media_action NOT IN ('keep', 'set', 'remove') THEN RAISE EXCEPTION 'Invalid media action'; END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 280 THEN RAISE EXCEPTION 'Caption too long'; END IF;

  -- Author and client come from the completion, never from the caller. A
  -- session that has started (lock-in) or finished qualifies; an untouched
  -- draft row doesn't.
  SELECT pc.client_id, pc.completed_at IS NOT NULL INTO v_client, v_done
    FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
   WHERE pc.id = _completion_id AND c.user_id = uid
     AND (pc.completed_at IS NOT NULL OR pc.started_at IS NOT NULL OR pc.in_progress_at IS NOT NULL);
  IF v_client IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility = 'community' AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;

  IF _media_action = 'set' THEN
    IF _media_type NOT IN ('image', 'video') OR _media_path IS NULL
       OR left(_media_path, length(v_prefix)) <> v_prefix
       OR (_media_thumb_path IS NOT NULL AND left(_media_thumb_path, length(v_prefix)) <> v_prefix) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;

  INSERT INTO public.community_posts AS p (
    author_user_id, client_id, completion_id, caption, visibility,
    media_path, media_thumb_path, media_type, media_width, media_height, locked_in_at, hide_loads)
  VALUES (
    uid, v_client, _completion_id, v_cap, _visibility,
    CASE WHEN _media_action = 'set' THEN _media_path END,
    CASE WHEN _media_action = 'set' THEN _media_thumb_path END,
    CASE WHEN _media_action = 'set' THEN _media_type END,
    CASE WHEN _media_action = 'set' THEN _media_width END,
    CASE WHEN _media_action = 'set' THEN _media_height END,
    CASE WHEN v_done THEN NULL ELSE now() END,
    coalesce(_hide_loads, false))
  ON CONFLICT ON CONSTRAINT community_posts_one_per_completion DO UPDATE SET
    caption = EXCLUDED.caption,
    visibility = EXCLUDED.visibility,
    media_path = CASE _media_action WHEN 'keep' THEN p.media_path ELSE EXCLUDED.media_path END,
    media_thumb_path = CASE _media_action WHEN 'keep' THEN p.media_thumb_path ELSE EXCLUDED.media_thumb_path END,
    media_type = CASE _media_action WHEN 'keep' THEN p.media_type ELSE EXCLUDED.media_type END,
    media_width = CASE _media_action WHEN 'keep' THEN p.media_width ELSE EXCLUDED.media_width END,
    media_height = CASE _media_action WHEN 'keep' THEN p.media_height ELSE EXCLUDED.media_height END,
    hide_loads = coalesce(_hide_loads, p.hide_loads),
    updated_at = now()
  RETURNING p.id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, int, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, int, int, boolean) TO authenticated;

-- ── Read paths ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_post_json(_post_id uuid, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', n.id,
    'created_at', n.created_at,
    'visibility', n.visibility,
    'caption', n.caption,
    'media_path', n.media_path,
    'media_thumb_path', n.media_thumb_path,
    'media_type', n.media_type,
    'media_width', n.media_width,
    'media_height', n.media_height,
    'completion_id', n.completion_id,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', pc.completed_at IS NULL,
    'session_title', coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout'),
    'is_mine', n.author_user_id = _viewer,
    'author', public.community_author(n.author_user_id),
    -- "Hide my weights": loads are removed for everyone but the author.
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                    ORDER BY r.created_at)
                                   FROM public.community_reactions r
                                  WHERE r.post_id = n.id
                                    AND (public.has_role(r.user_id, 'admin') OR public.has_role(r.user_id, 'coach'))), '[]'::jsonb),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND (public.has_role(c.author_user_id, 'admin') OR public.has_role(c.author_user_id, 'coach'))))
  FROM public.community_posts n
  JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_post_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.community_feed(
  _limit int DEFAULT 10,
  _before_at timestamptz DEFAULT NULL,
  _before_id uuid DEFAULT NULL,
  _author_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(_limit, 10), 1), 30);
  result jsonb;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  WITH page AS (
    SELECT p.id, p.created_at FROM public.community_posts p
     WHERE (p.visibility = 'community'
            OR (p.visibility = 'coach' AND p.author_user_id <> uid AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
            OR (p.author_user_id = uid AND _author_user_id = uid))
       AND (_author_user_id IS NULL OR p.author_user_id = _author_user_id)
       AND (_before_at IS NULL OR (p.created_at, p.id) < (_before_at, coalesce(_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT lim + 1
  ),
  numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.created_at DESC, page.id DESC) rn FROM page)
  SELECT jsonb_build_object(
           'posts', coalesce((SELECT jsonb_agg(public.community_post_json(n.id, uid) ORDER BY n.rn) FROM numbered n WHERE n.rn <= lim), '[]'::jsonb),
           'has_more', (SELECT count(*) FROM page) > lim)
    INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.community_feed(int, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_feed(int, timestamptz, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_post(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_completion uuid;
  v_hide boolean;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.completion_id, p.hide_loads AND p.author_user_id <> uid INTO v_completion, v_hide FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF v_completion IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN public.community_post_json(_post_id, uid)
         || jsonb_build_object('exercises', CASE WHEN v_hide THEN public.community_hide_exercise_loads(public.community_workout_exercises(v_completion))
                                                ELSE public.community_workout_exercises(v_completion) END);
END;
$$;
REVOKE ALL ON FUNCTION public.community_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_react(_post_id uuid, _emoji text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF _emoji IS NULL OR _emoji = '' THEN
    DELETE FROM public.community_reactions WHERE post_id = _post_id AND user_id = uid;
  ELSE
    IF _emoji NOT IN ('fire', 'muscle', 'clap', 'heart') THEN RAISE EXCEPTION 'Invalid reaction'; END IF;
    INSERT INTO public.community_reactions (post_id, user_id, emoji) VALUES (_post_id, uid, _emoji)
    ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_react(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_react(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_comments(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.author_user_id INTO v_owner FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', c.id, 'body', c.body, 'created_at', c.created_at,
             'author', public.community_author(c.author_user_id),
             'can_delete', (c.author_user_id = uid OR v_owner = uid OR public.is_community_staff()))
           ORDER BY c.created_at)
      FROM (SELECT * FROM public.community_comments WHERE post_id = _post_id ORDER BY created_at LIMIT 100) c
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_comments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_comments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_add_comment(_post_id uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_body text := btrim(coalesce(_body, ''));
  v_id uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_body = '' OR char_length(v_body) > 300 THEN RAISE EXCEPTION 'Comment must be 1–300 characters'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p
                  WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)) THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  INSERT INTO public.community_comments (post_id, author_user_id, body) VALUES (_post_id, uid, v_body) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_add_comment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_add_comment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_activity()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_seen timestamptz;
BEGIN
  IF NOT public.can_view_community() THEN RETURN jsonb_build_object('unseen', 0, 'seen_at', null, 'enabled', false); END IF;
  SELECT s.seen_at INTO v_seen FROM public.community_seen s WHERE s.user_id = uid;
  RETURN jsonb_build_object(
    'enabled', true,
    'seen_at', v_seen,
    'unseen', (SELECT count(*) FROM (
                 SELECT 1 FROM public.community_posts p
                  WHERE (p.visibility = 'community' OR (p.visibility = 'coach' AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)))
                    AND p.author_user_id <> uid
                    AND p.created_at > coalesce(v_seen, now() - interval '7 days')
                  LIMIT 99) x));
END;
$$;
REVOKE ALL ON FUNCTION public.community_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_activity() TO authenticated;

CREATE OR REPLACE FUNCTION public.community_profile(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'author', public.community_author(_user_id),
    'bio', (SELECT cp.bio FROM public.community_profiles cp WHERE cp.user_id = _user_id),
    'is_me', _user_id = uid,
    'posts', (SELECT count(*) FROM public.community_posts p
               WHERE p.author_user_id = _user_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)),
    'training_since', (SELECT min(pc.completed_at) FROM public.pl_day_completions pc
                         JOIN public.clients c ON c.id = pc.client_id
                        WHERE c.user_id = _user_id AND pc.completed_at IS NOT NULL));
END;
$$;
REVOKE ALL ON FUNCTION public.community_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_profile(uuid) TO authenticated;
