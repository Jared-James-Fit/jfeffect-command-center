-- Comments grow up: like a comment, reply to one (one level deep, "@name"),
-- reply with a photo or video, and hold any comment for options (reply,
-- like, share it as a post, copy, hide, delete). Who can do what:
--
--   delete  the commenter, the post's owner, and staff. Nobody else.
--   hide    the post's owner and staff, on other people's comments. A hidden
--           comment (and its replies) stops showing to everyone except the
--           person who wrote it (nothing tells them), the post's owner and
--           staff. Unhide puts it back.
--   share   anyone who can see the comment, from community posts only. The
--           new post shows the comment live: hide it and the share says it's gone
--           (except to its writer); delete it and the share goes with it.
--
-- Live: comments and comment likes stream to the app (realtime), read
-- through the same rules as the list.

-- ── Shape ──────────────────────────────────────────────────────────────────
ALTER TABLE public.community_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reply_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_thumb_path text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_width int,
  ADD COLUMN IF NOT EXISTS media_height int,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by uuid;
-- words, a photo/video, or both
ALTER TABLE public.community_comments DROP CONSTRAINT IF EXISTS community_comments_body_check;
ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_body_check
  CHECK (char_length(body) <= 300 AND (char_length(btrim(body)) >= 1 OR media_path IS NOT NULL));
ALTER TABLE public.community_comments DROP CONSTRAINT IF EXISTS community_comments_media_check;
ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_media_check
  CHECK ((media_path IS NULL) = (media_type IS NULL) AND (media_type IS NULL OR media_type IN ('image', 'video')));
CREATE INDEX IF NOT EXISTS community_comments_post_created ON public.community_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS community_comments_parent ON public.community_comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_comments_media ON public.community_comments (media_path) WHERE media_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_comments_media_thumb ON public.community_comments (media_thumb_path) WHERE media_thumb_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.community_comment_likes (
  comment_id uuid NOT NULL REFERENCES public.community_comments(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_comment_likes_post ON public.community_comment_likes (post_id);
ALTER TABLE public.community_comment_likes ENABLE ROW LEVEL SECURITY;

-- A comment shared as its own post. Deleting the comment removes the share.
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS shared_comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS community_posts_one_share_each ON public.community_posts (author_user_id, shared_comment_id) WHERE shared_comment_id IS NOT NULL;

-- ── Who can see a comment ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_comment_readable(_post_id uuid, _author uuid, _hidden_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_community() AND EXISTS (
    SELECT 1 FROM public.community_posts p
     WHERE p.id = _post_id
       AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)
       AND (_hidden_at IS NULL
            OR public.community_main_account(_author) = public.community_main_account(auth.uid())
            OR p.author_user_id = public.community_main_account(auth.uid())
            OR public.is_community_staff()))
$$;
REVOKE ALL ON FUNCTION public.community_comment_readable(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_comment_readable(uuid, uuid, timestamptz) TO authenticated;

-- Read access (it's what lets new comments and likes stream in live).
-- Writes still only go through the functions below. Whether a comment was
-- hidden (and by whom) isn't readable, so its writer can't tell.
GRANT SELECT (id, post_id, author_user_id, body, created_at, parent_id, reply_to_user_id,
              media_path, media_thumb_path, media_type, media_width, media_height)
  ON public.community_comments TO authenticated;
GRANT SELECT ON public.community_comment_likes TO authenticated;
DROP POLICY IF EXISTS "community comments read" ON public.community_comments;
CREATE POLICY "community comments read" ON public.community_comments
  FOR SELECT TO authenticated USING (public.community_comment_readable(post_id, author_user_id, hidden_at));
DROP POLICY IF EXISTS "community comment likes read" ON public.community_comment_likes;
CREATE POLICY "community comment likes read" ON public.community_comment_likes
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.community_comments c WHERE c.id = comment_id));

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.community_comments;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.community_comment_likes;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- Photos and videos in comments are readable by whoever can see the comment.
DROP POLICY IF EXISTS "community media read" ON storage.objects;
CREATE POLICY "community media read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'community-media' AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR EXISTS (SELECT 1 FROM public.community_posts p
                WHERE (p.media_path = objects.name OR p.media_thumb_path = objects.name)
                  AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id))
    OR EXISTS (SELECT 1 FROM public.community_comments c
                WHERE (c.media_path = objects.name OR c.media_thumb_path = objects.name)
                  AND public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at))));

-- ── One comment, as the app gets it ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_comment_json(c public.community_comments, _viewer uuid, _owner uuid, _staff boolean, _shareable boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'parent_id', c.parent_id, 'body', c.body, 'created_at', c.created_at,
    'author', public.community_author(c.author_user_id),
    'reply_to', CASE WHEN c.reply_to_user_id IS NOT NULL
                      AND public.community_main_account(c.reply_to_user_id) <> public.community_main_account(c.author_user_id)
                     THEN public.community_author(c.reply_to_user_id)->>'name' END,
    'media', CASE WHEN c.media_path IS NOT NULL THEN jsonb_build_object(
               'path', c.media_path, 'thumb', c.media_thumb_path, 'type', c.media_type,
               'width', c.media_width, 'height', c.media_height) END,
    'likes', (SELECT count(*) FROM public.community_comment_likes l WHERE l.comment_id = c.id),
    'liked', EXISTS (SELECT 1 FROM public.community_comment_likes l WHERE l.comment_id = c.id AND l.user_id = _viewer),
    -- only the people who can hide it are told it's hidden
    'hidden', c.hidden_at IS NOT NULL AND (_owner = public.community_main_account(_viewer) OR _staff),
    'is_mine', public.community_main_account(c.author_user_id) = public.community_main_account(_viewer),
    'can_delete', public.community_main_account(c.author_user_id) = public.community_main_account(_viewer)
                  OR _owner = public.community_main_account(_viewer) OR _staff,
    'can_hide', (_owner = public.community_main_account(_viewer) OR _staff)
                AND public.community_main_account(c.author_user_id) <> public.community_main_account(_viewer),
    'can_share', _shareable AND c.hidden_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.community_comment_json(public.community_comments, uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- ── The thread: every comment and reply on a post, oldest first ───────────
CREATE OR REPLACE FUNCTION public.community_comments(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_staff boolean := public.is_community_staff();
  v_owner uuid;
  v_vis text;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT p.author_user_id, p.visibility INTO v_owner, v_vis FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_comment_json(cc, uid, v_owner, v_staff, v_vis = 'community') ORDER BY cc.created_at)
      FROM public.community_comments cc
     WHERE cc.id IN (
       SELECT c.id FROM public.community_comments c
        WHERE c.post_id = _post_id
          -- hidden ones (and replies under a hidden one) only for the writer, the post's owner and staff
          AND (v_owner = v_me OR v_staff OR (
                (c.hidden_at IS NULL OR public.community_main_account(c.author_user_id) = v_me)
                AND (c.parent_id IS NULL OR EXISTS (
                      SELECT 1 FROM public.community_comments pc WHERE pc.id = c.parent_id
                         AND (pc.hidden_at IS NULL OR public.community_main_account(pc.author_user_id) = v_me)))))
        ORDER BY c.created_at
        LIMIT 300)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_comments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_comments(uuid) TO authenticated;

-- ── Comment / reply, with words, a photo or video, or both ────────────────
DROP FUNCTION IF EXISTS public.community_add_comment(uuid, text);
CREATE OR REPLACE FUNCTION public.community_add_comment(_post_id uuid, _body text, _parent_id uuid DEFAULT NULL, _media jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_body text := btrim(coalesce(_body, ''));
  v_path text := nullif(btrim(coalesce(_media->>'path', '')), '');
  v_thumb text := nullif(btrim(coalesce(_media->>'thumb', '')), '');
  v_type text := _media->>'type';
  v_owner uuid;
  v_vis text;
  v_parent public.community_comments;
  v_top uuid;
  v_reply_to uuid;
  r public.community_comments;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(v_body) > 300 THEN RAISE EXCEPTION 'Keep it under 300 characters'; END IF;
  IF v_body = '' AND v_path IS NULL THEN RAISE EXCEPTION 'Write something or add a photo'; END IF;
  IF v_path IS NOT NULL THEN
    IF v_type IS NULL OR v_type NOT IN ('image', 'video') THEN RAISE EXCEPTION 'Photos and videos only'; END IF;
    -- only your own uploads
    IF split_part(v_path, '/', 1) <> uid::text OR (v_thumb IS NOT NULL AND split_part(v_thumb, '/', 1) <> uid::text) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT p.author_user_id, p.visibility INTO v_owner, v_vis FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Post not found'; END IF;
  -- replies hang off the top comment (one level), "@" whoever you answered
  IF _parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.community_comments c WHERE c.id = _parent_id AND c.post_id = _post_id;
    IF v_parent.id IS NULL OR NOT public.community_comment_readable(v_parent.post_id, v_parent.author_user_id, v_parent.hidden_at) THEN
      RAISE EXCEPTION 'That comment is gone';
    END IF;
    v_top := coalesce(v_parent.parent_id, v_parent.id);
    v_reply_to := v_parent.author_user_id;
  END IF;
  INSERT INTO public.community_comments (post_id, author_user_id, body, parent_id, reply_to_user_id,
                                         media_path, media_thumb_path, media_type, media_width, media_height)
  VALUES (_post_id, uid, v_body, v_top, v_reply_to, v_path, CASE WHEN v_path IS NOT NULL THEN v_thumb END,
          CASE WHEN v_path IS NOT NULL THEN v_type END,
          CASE WHEN v_path IS NOT NULL THEN nullif(_media->>'width', '')::numeric::int END,
          CASE WHEN v_path IS NOT NULL THEN nullif(_media->>'height', '')::numeric::int END)
  RETURNING * INTO r;
  RETURN public.community_comment_json(r, uid, v_owner, public.is_community_staff(), v_vis = 'community');
END;
$$;
REVOKE ALL ON FUNCTION public.community_add_comment(uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_add_comment(uuid, text, uuid, jsonb) TO authenticated;

-- ── Delete: the commenter, the post's owner, staff ─────────────────────────
CREATE OR REPLACE FUNCTION public.community_delete_comment(_comment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_comments WHERE id = _comment_id) THEN RETURN; END IF; -- already gone
  DELETE FROM public.community_comments c
   WHERE c.id = _comment_id
     AND (public.community_main_account(c.author_user_id) = v_me
       OR public.is_community_staff()
       OR EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = c.post_id AND p.author_user_id = v_me));
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only delete your own comments' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_delete_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_delete_comment(uuid) TO authenticated;

-- ── Hide / unhide: the post's owner and staff, on other people's comments ──
CREATE OR REPLACE FUNCTION public.community_hide_comment(_comment_id uuid, _hidden boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.community_main_account(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.community_comments c
     SET hidden_at = CASE WHEN coalesce(_hidden, true) THEN now() END,
         hidden_by = CASE WHEN coalesce(_hidden, true) THEN auth.uid() END
   WHERE c.id = _comment_id
     AND public.community_main_account(c.author_user_id) <> v_me
     AND (public.is_community_staff()
       OR EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = c.post_id AND p.author_user_id = v_me));
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the post''s owner can hide comments' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_hide_comment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_hide_comment(uuid, boolean) TO authenticated;

-- ── Like / unlike a comment ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_like_comment(_comment_id uuid, _liked boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  c public.community_comments;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.community_comments WHERE id = _comment_id;
  IF c.id IS NULL OR NOT public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at) THEN
    RAISE EXCEPTION 'That comment is gone';
  END IF;
  IF coalesce(_liked, true) THEN
    INSERT INTO public.community_comment_likes (comment_id, post_id, user_id) VALUES (c.id, c.post_id, uid) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.community_comment_likes WHERE comment_id = c.id AND user_id = uid;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_like_comment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_like_comment(uuid, boolean) TO authenticated;

-- ── Share a comment as a post ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_share_comment(_comment_id uuid, _caption text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_me uuid := public.community_main_account(auth.uid());
  v_caption text := nullif(btrim(coalesce(_caption, '')), '');
  c public.community_comments;
  v_id uuid;
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(v_caption) > 1200 THEN RAISE EXCEPTION 'Keep it under 1200 characters'; END IF;
  SELECT * INTO c FROM public.community_comments WHERE id = _comment_id;
  IF c.id IS NULL OR c.hidden_at IS NOT NULL OR NOT public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at) THEN
    RAISE EXCEPTION 'That comment is gone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = c.post_id AND p.visibility = 'community') THEN
    RAISE EXCEPTION 'Only comments on community posts can be shared';
  END IF;
  -- shared it already: that's the post
  SELECT p.id INTO v_id FROM public.community_posts p WHERE p.author_user_id = v_me AND p.shared_comment_id = c.id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.community_posts (author_user_id, client_id, kind, visibility, caption, shared_comment_id)
  VALUES (v_me, (SELECT cl.id FROM public.clients cl WHERE cl.user_id = v_me LIMIT 1), 'note', 'community', v_caption, c.id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_share_comment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_share_comment(uuid, text) TO authenticated;

-- ── The post as the app gets it: + the shared comment, hidden ones uncounted ──
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
    'kind', n.kind,
    'series', n.series,
    'quote', n.quote,
    'quote_author', n.quote_author,
    'quote_source', n.quote_source,
    'series_data', CASE WHEN n.series IS NULL OR n.series IN ('wednesday_wins', 'sunday_recap') THEN n.series_data END,
    'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit') THEN n.series_data END,
    -- a comment someone shared as this post: live, so a deleted or hidden comment disappears from it too
    'shared_comment', CASE WHEN n.shared_comment_id IS NOT NULL THEN coalesce((
      SELECT jsonb_build_object('id', c.id, 'post_id', c.post_id, 'body', c.body, 'created_at', c.created_at,
                                'author', public.community_author(c.author_user_id),
                                'post_author', public.community_author(op.author_user_id)->>'name',
                                'media', CASE WHEN c.media_path IS NOT NULL THEN jsonb_build_object(
                                  'path', c.media_path, 'thumb', c.media_thumb_path, 'type', c.media_type,
                                  'width', c.media_width, 'height', c.media_height) END)
        FROM public.community_comments c JOIN public.community_posts op ON op.id = c.post_id
       WHERE c.id = n.shared_comment_id AND op.visibility = 'community'
         AND public.community_comment_readable(c.post_id, c.author_user_id, c.hidden_at)),
      jsonb_build_object('gone', true)) END,
    'edited_at', n.edited_at,
    'archived_at', n.archived_at,
    'archived_from', n.archived_from,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'reaction_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = n.id),
    'reactors', coalesce((SELECT jsonb_agg(x.j ORDER BY x.coach DESC, x.at DESC)
                            FROM (SELECT public.community_author(r.user_id)
                                         || jsonb_build_object('is_me', public.community_main_account(r.user_id) = public.community_main_account(_viewer)) AS j,
                                         public.community_is_coach(r.user_id) AS coach, r.created_at AS at
                                    FROM public.community_reactions r WHERE r.post_id = n.id
                                   ORDER BY public.community_is_coach(r.user_id) DESC, r.created_at DESC LIMIT 3) x), '[]'::jsonb),
    'coach_reactions', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                    'name', public.community_author(r.user_id)->>'name', 'emoji', r.emoji)
                                    ORDER BY r.created_at)
                                   FROM public.community_reactions r
                                  WHERE r.post_id = n.id
                                    AND public.community_is_coach(r.user_id)), '[]'::jsonb),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id AND c.hidden_at IS NULL),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$$;

