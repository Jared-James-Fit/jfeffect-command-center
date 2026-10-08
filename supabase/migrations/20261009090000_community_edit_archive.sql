-- Instagram-style post controls for whoever posted it:
--   * Edit: caption, who it's for, hide weights (the photo stays, like IG).
--     A caption change marks the post "Edited". Re-saving from the share
--     editor now marks it too.
--   * Archive: the post disappears for everyone else (it becomes "only me",
--     so every existing visibility check hides it) and out of your own feed
--     and grid; it lives in Archived on your profile, with its fire and
--     comments kept, until you restore it to exactly who it was for.
--   * Delete stays as it was (gone for good).

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_from text;

-- Who may manage a post: its author, from either of their linked accounts.
CREATE OR REPLACE FUNCTION public.community_is_post_author(_post_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.community_posts p
     WHERE p.id = _post_id
       AND (p.author_user_id = auth.uid() OR p.author_user_id = public.community_main_account(auth.uid())))
$$;
REVOKE ALL ON FUNCTION public.community_is_post_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_is_post_author(uuid) TO authenticated;

-- Edit a workout post (notes keep community_update_note).
CREATE OR REPLACE FUNCTION public.community_edit_post(_post_id uuid, _caption text, _visibility text, _hide_loads boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  p record;
BEGIN
  IF NOT public.community_is_post_author(_post_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 280 THEN RAISE EXCEPTION 'Caption too long'; END IF;
  IF _visibility = 'community' AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.community_posts WHERE id = _post_id;
  IF p.kind <> 'workout' THEN RAISE EXCEPTION 'Use the note editor for this post'; END IF;
  UPDATE public.community_posts SET
    caption = v_cap,
    -- an archived post stays archived; the new audience applies when it's restored
    visibility = CASE WHEN p.archived_at IS NOT NULL THEN 'private' ELSE _visibility END,
    archived_from = CASE WHEN p.archived_at IS NOT NULL THEN _visibility ELSE archived_from END,
    hide_loads = coalesce(_hide_loads, hide_loads),
    edited_at = CASE WHEN p.caption IS DISTINCT FROM v_cap THEN now() ELSE edited_at END,
    updated_at = now()
   WHERE id = _post_id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_edit_post(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_edit_post(uuid, text, text, boolean) TO authenticated;

-- Archive (true) or restore (false). Only the author.
CREATE OR REPLACE FUNCTION public.community_archive_post(_post_id uuid, _archive boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.community_is_post_author(_post_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(_archive, true) THEN
    UPDATE public.community_posts SET archived_from = visibility, visibility = 'private', archived_at = now(), updated_at = now()
     WHERE id = _post_id AND archived_at IS NULL;
  ELSE
    UPDATE public.community_posts SET visibility = coalesce(archived_from, 'community'), archived_from = NULL, archived_at = NULL, updated_at = now()
     WHERE id = _post_id AND archived_at IS NOT NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.community_archive_post(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_archive_post(uuid, boolean) TO authenticated;

-- Your archived posts, newest archived first.
CREATE OR REPLACE FUNCTION public.community_my_archived()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(public.community_post_json(p.id, uid) ORDER BY p.archived_at DESC)
      FROM public.community_posts p
     WHERE p.archived_at IS NOT NULL
       AND (p.author_user_id = uid OR p.author_user_id = public.community_main_account(uid))), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.community_my_archived() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_my_archived() TO authenticated;

-- Feed and profile: archived posts are out, for everyone including the author.
CREATE OR REPLACE FUNCTION public.community_feed(_limit integer DEFAULT 10, _before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _before_id uuid DEFAULT NULL::uuid, _author_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       AND p.archived_at IS NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.community_profile(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'author', public.community_author(_user_id),
    'bio', (SELECT cp.bio FROM public.community_profiles cp WHERE cp.user_id = _user_id),
    'is_me', _user_id = uid,
    'posts', (SELECT count(*) FROM public.community_posts p
               WHERE p.author_user_id = _user_id AND p.archived_at IS NULL
                 AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)),
    'archived', CASE WHEN _user_id = uid OR _user_id = public.community_main_account(uid)
                     THEN (SELECT count(*) FROM public.community_posts p WHERE p.author_user_id = _user_id AND p.archived_at IS NOT NULL) END,
    'training_since', (SELECT min(pc.completed_at) FROM public.pl_day_completions pc
                         JOIN public.clients c ON c.id = pc.client_id
                        WHERE c.user_id = _user_id AND pc.completed_at IS NOT NULL));
END;
$function$;

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
    'series_data', n.series_data,
    'edited_at', n.edited_at,
    'archived_at', n.archived_at,
    'archived_from', n.archived_from,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    -- "Hide my weights": loads are removed for everyone but the author.
    'stats', CASE WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
                  THEN public.community_hide_loads(public.community_workout_stats(n.completion_id))
                  ELSE public.community_workout_stats(n.completion_id) END,
    'reactions', coalesce((SELECT jsonb_object_agg(x.emoji, x.c)
                             FROM (SELECT r.emoji, count(*) c FROM public.community_reactions r
                                    WHERE r.post_id = n.id GROUP BY r.emoji) x), '{}'::jsonb),
    'my_reaction', (SELECT r.emoji FROM public.community_reactions r WHERE r.post_id = n.id AND r.user_id = _viewer),
    'reaction_count', (SELECT count(*) FROM public.community_reactions r WHERE r.post_id = n.id),
    -- who gave it 🔥, for "🔥 from Jared, Vicky and 3 others": coaches first, then newest
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
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  WHERE n.id = _post_id
$$;
REVOKE ALL ON FUNCTION public.community_post_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- Re-saving from the share editor: a caption change shows "Edited", and
-- sharing an archived workout again brings it back.
CREATE OR REPLACE FUNCTION public.community_save_post(_completion_id uuid, _caption text DEFAULT NULL::text, _visibility text DEFAULT 'community'::text, _media_action text DEFAULT 'keep'::text, _media_path text DEFAULT NULL::text, _media_thumb_path text DEFAULT NULL::text, _media_type text DEFAULT NULL::text, _media_width integer DEFAULT NULL::integer, _media_height integer DEFAULT NULL::integer, _hide_loads boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    edited_at = CASE WHEN p.caption IS DISTINCT FROM EXCLUDED.caption THEN now() ELSE p.edited_at END,
    archived_at = NULL,
    archived_from = NULL,
    updated_at = now()
  RETURNING p.id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;
