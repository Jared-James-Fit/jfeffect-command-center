-- Lock-in posts: "I showed up." A post can now be made the moment a session
-- starts (photo from the gym, before or between sets), not only after it's
-- finished. It is the SAME post as the finished-workout share: one post per
-- completion (pl_day_completions.id), so when the athlete finishes, the
-- lock-in post fills in with the real numbers on read. No second post, no
-- trigger, nothing copied.
--
--   * locked_in_at: when the post was first made while the session was still
--     open. Never changes afterwards (edits keep it). NULL for posts made
--     after finishing.
--   * Locking in starts the session through the normal startWorkout path
--     (the client calls it first); this RPC only accepts a completion that
--     has started or finished, owned by the caller.
--   * community_post_json adds `live` (session not finished yet),
--     `locked_in_at` and `session_title` so a live post can show what's being
--     trained before any numbers exist. Stats stay NULL until finished
--     (community_workout_stats already requires completed_at).

ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS locked_in_at timestamptz;

-- ── Save: started or finished sessions ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_save_post(
  _completion_id uuid,
  _caption text DEFAULT NULL,
  _visibility text DEFAULT 'community',
  _media_action text DEFAULT 'keep',
  _media_path text DEFAULT NULL,
  _media_thumb_path text DEFAULT NULL,
  _media_type text DEFAULT NULL,
  _media_width int DEFAULT NULL,
  _media_height int DEFAULT NULL
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
  IF _visibility NOT IN ('community', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
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
    media_path, media_thumb_path, media_type, media_width, media_height, locked_in_at)
  VALUES (
    uid, v_client, _completion_id, v_cap, _visibility,
    CASE WHEN _media_action = 'set' THEN _media_path END,
    CASE WHEN _media_action = 'set' THEN _media_thumb_path END,
    CASE WHEN _media_action = 'set' THEN _media_type END,
    CASE WHEN _media_action = 'set' THEN _media_width END,
    CASE WHEN _media_action = 'set' THEN _media_height END,
    CASE WHEN v_done THEN NULL ELSE now() END)
  ON CONFLICT ON CONSTRAINT community_posts_one_per_completion DO UPDATE SET
    caption = EXCLUDED.caption,
    visibility = EXCLUDED.visibility,
    media_path = CASE _media_action WHEN 'keep' THEN p.media_path ELSE EXCLUDED.media_path END,
    media_thumb_path = CASE _media_action WHEN 'keep' THEN p.media_thumb_path ELSE EXCLUDED.media_thumb_path END,
    media_type = CASE _media_action WHEN 'keep' THEN p.media_type ELSE EXCLUDED.media_type END,
    media_width = CASE _media_action WHEN 'keep' THEN p.media_width ELSE EXCLUDED.media_width END,
    media_height = CASE _media_action WHEN 'keep' THEN p.media_height ELSE EXCLUDED.media_height END,
    updated_at = now()
  RETURNING p.id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, int, int) TO authenticated;

-- ── One post, shaped for the client ────────────────────────────────────────
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
    'live', pc.completed_at IS NULL,
    'session_title', coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout'),
    'is_mine', n.author_user_id = _viewer,
    'author', public.community_author(n.author_user_id),
    'stats', public.community_workout_stats(n.completion_id),
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
