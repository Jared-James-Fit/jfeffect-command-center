-- Lock-in and finished-workout shares are separate posts.
--
-- Until now a session (pl_day_completions.id) had exactly one post: a lock-in
-- made mid-day "filled in" with numbers on finish, and sharing the finished
-- workout edited that same post. That merged two different moments: Jared
-- McIntyre locked in at 12:01 (one photo + caption), finished at 21:51, shared
-- the finish with a new photo, and the share overwrote the lock-in post (and
-- the client then deleted the lock-in photo as "no longer used").
--
-- Now a session has up to two posts, one per slot:
--   * lock-in slot  (locked_in_at IS NOT NULL) — "I showed up"
--   * finish slot   (locked_in_at IS NULL)     — the finished workout
-- A lock-in on its own still fills in with the numbers when the session is
-- finished (unchanged). Once a finish post exists, the lock-in shows as the
-- lock-in moment only, so the numbers appear once, on the finish post.
-- League points are per day (community_post_xp_sync), so two posts never pay twice.

ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_one_per_completion;
CREATE UNIQUE INDEX IF NOT EXISTS community_posts_one_per_completion_slot
  ON public.community_posts (completion_id, (locked_in_at IS NOT NULL));

-- ── Save: _lock_in picks the slot ─────────────────────────────────────────────
-- NULL (default) = lock-in while the session is open, finish once it's done.
-- Lock-in screens pass true so editing a lock-in after finishing never creates
-- a finish post by accident. A finish post needs a finished session.
DROP FUNCTION IF EXISTS public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean, jsonb);

CREATE OR REPLACE FUNCTION public.community_save_post(
  _completion_id uuid,
  _caption text DEFAULT NULL::text,
  _visibility text DEFAULT 'community'::text,
  _media_action text DEFAULT 'keep'::text,
  _media_path text DEFAULT NULL::text,
  _media_thumb_path text DEFAULT NULL::text,
  _media_type text DEFAULT NULL::text,
  _media_width integer DEFAULT NULL::integer,
  _media_height integer DEFAULT NULL::integer,
  _hide_loads boolean DEFAULT NULL::boolean,
  _extra_media jsonb DEFAULT NULL::jsonb,
  _lock_in boolean DEFAULT NULL::boolean
)
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
  v_lock boolean;
  v_prefix text := uid::text || '/';
  v_extra jsonb;
  v_cover_type text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF _media_action NOT IN ('keep', 'set', 'remove') THEN RAISE EXCEPTION 'Invalid media action'; END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 2200 THEN RAISE EXCEPTION 'Caption too long'; END IF;
  SELECT pc.client_id, pc.completed_at IS NOT NULL INTO v_client, v_done
    FROM public.pl_day_completions pc JOIN public.clients c ON c.id = pc.client_id
   WHERE pc.id = _completion_id AND c.user_id = uid
     AND (pc.completed_at IS NOT NULL OR pc.started_at IS NOT NULL OR pc.in_progress_at IS NOT NULL);
  IF v_client IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility = 'community' AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;
  v_lock := coalesce(_lock_in, false) OR NOT v_done;
  IF _media_action = 'set' THEN
    IF _media_type NOT IN ('image', 'video') OR _media_path IS NULL
       OR left(_media_path, length(v_prefix)) <> v_prefix
       OR (_media_thumb_path IS NOT NULL AND left(_media_thumb_path, length(v_prefix)) <> v_prefix) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;
  IF _extra_media IS NOT NULL AND _media_action <> 'remove' THEN
    IF jsonb_typeof(_extra_media) <> 'array' THEN RAISE EXCEPTION 'Invalid media'; END IF;
    IF jsonb_array_length(_extra_media) > 9 THEN RAISE EXCEPTION 'Up to 10 photos or videos on a post'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'path', x.e->>'path', 'thumb', nullif(x.e->>'thumb', ''), 'type', x.e->>'type',
             'width', CASE WHEN x.e->>'width' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'width')::numeric)::int END,
             'height', CASE WHEN x.e->>'height' ~ '^[0-9]{1,5}(\.[0-9]+)?$' THEN round((x.e->>'height')::numeric)::int END)
           ORDER BY x.i), '[]'::jsonb)
      INTO v_extra
      FROM jsonb_array_elements(_extra_media) WITH ORDINALITY AS x(e, i);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_extra) e
                WHERE e->>'type' IS NULL OR e->>'type' NOT IN ('image', 'video')
                   OR e->>'path' IS NULL OR left(e->>'path', length(v_prefix)) <> v_prefix
                   OR (e->>'thumb' IS NOT NULL AND left(e->>'thumb', length(v_prefix)) <> v_prefix)) THEN
      RAISE EXCEPTION 'Invalid media';
    END IF;
  END IF;
  v_cover_type := CASE _media_action
                    WHEN 'set' THEN _media_type
                    WHEN 'remove' THEN NULL
                    ELSE (SELECT p.media_type FROM public.community_posts p
                           WHERE p.completion_id = _completion_id AND (p.locked_in_at IS NOT NULL) = v_lock) END;
  IF (CASE WHEN v_cover_type = 'video' THEN 1 ELSE 0 END)
     + coalesce((SELECT count(*) FROM jsonb_array_elements(coalesce(v_extra,
          CASE WHEN _media_action = 'remove' THEN '[]'::jsonb
               ELSE (SELECT p.extra_media FROM public.community_posts p
                      WHERE p.completion_id = _completion_id AND (p.locked_in_at IS NOT NULL) = v_lock) END,
          '[]'::jsonb)) e WHERE e->>'type' = 'video'), 0) > 3 THEN
    RAISE EXCEPTION 'Up to 3 videos on a post';
  END IF;
  INSERT INTO public.community_posts AS p (
    author_user_id, client_id, completion_id, caption, visibility,
    media_path, media_thumb_path, media_type, media_width, media_height, locked_in_at, hide_loads, extra_media)
  VALUES (
    uid, v_client, _completion_id, v_cap, _visibility,
    CASE WHEN _media_action = 'set' THEN _media_path END,
    CASE WHEN _media_action = 'set' THEN _media_thumb_path END,
    CASE WHEN _media_action = 'set' THEN _media_type END,
    CASE WHEN _media_action = 'set' THEN _media_width END,
    CASE WHEN _media_action = 'set' THEN _media_height END,
    CASE WHEN v_lock THEN now() ELSE NULL END,
    coalesce(_hide_loads, false),
    coalesce(v_extra, '[]'::jsonb))
  ON CONFLICT (completion_id, (locked_in_at IS NOT NULL)) DO UPDATE SET
    caption = EXCLUDED.caption,
    visibility = EXCLUDED.visibility,
    media_path = CASE _media_action WHEN 'keep' THEN p.media_path ELSE EXCLUDED.media_path END,
    media_thumb_path = CASE _media_action WHEN 'keep' THEN p.media_thumb_path ELSE EXCLUDED.media_thumb_path END,
    media_type = CASE _media_action WHEN 'keep' THEN p.media_type ELSE EXCLUDED.media_type END,
    media_width = CASE _media_action WHEN 'keep' THEN p.media_width ELSE EXCLUDED.media_width END,
    media_height = CASE _media_action WHEN 'keep' THEN p.media_height ELSE EXCLUDED.media_height END,
    extra_media = CASE WHEN _media_action = 'remove' THEN '[]'::jsonb WHEN v_extra IS NOT NULL THEN v_extra ELSE p.extra_media END,
    hide_loads = coalesce(_hide_loads, p.hide_loads),
    edited_at = CASE WHEN p.caption IS DISTINCT FROM EXCLUDED.caption THEN now() ELSE p.edited_at END,
    archived_at = NULL,
    archived_from = NULL,
    updated_at = now()
  RETURNING p.id INTO v_id;
  UPDATE public.community_posts p
     SET media_path = p.extra_media->0->>'path', media_thumb_path = p.extra_media->0->>'thumb',
         media_type = p.extra_media->0->>'type', media_width = (p.extra_media->0->>'width')::int,
         media_height = (p.extra_media->0->>'height')::int, extra_media = p.extra_media - 0
   WHERE p.id = v_id AND p.media_path IS NULL AND jsonb_array_length(p.extra_media) > 0;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean, jsonb, boolean) TO authenticated;

-- ── A lock-in whose session also has a finish post ────────────────────────────
CREATE OR REPLACE FUNCTION public.community_lockin_has_finish(_post_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.community_posts l
      JOIN public.community_posts f
        ON f.completion_id = l.completion_id AND f.locked_in_at IS NULL AND f.id <> l.id
     WHERE l.id = _post_id AND l.locked_in_at IS NOT NULL AND l.completion_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.community_lockin_has_finish(uuid) FROM PUBLIC, anon;

-- ── Feed JSON: such a lock-in is the lock-in moment only (no stats, not live) ─
CREATE OR REPLACE FUNCTION public.community_post_json(_post_id uuid, _viewer uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'extra_media', CASE WHEN jsonb_array_length(n.extra_media) > 0 THEN n.extra_media END,
    'completion_id', n.completion_id,
    'kind', n.kind,
    'series', n.series,
    'quote', n.quote,
    'quote_author', n.quote_author,
    'quote_source', n.quote_source,
    'series_data', CASE WHEN n.series IS NULL OR n.series IN ('wednesday_wins', 'sunday_recap') THEN n.series_data END,
    'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit') THEN n.series_data END,
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
    'mentions', coalesce((SELECT jsonb_agg(public.community_author(m.user_id) || jsonb_build_object('text', m.text) ORDER BY m.pos, m.created_at)
                            FROM public.community_post_mentions m WHERE m.post_id = n.id AND m.removed_at IS NULL), '[]'::jsonb),
    'collaborators', coalesce((SELECT jsonb_agg(public.community_author(x.uid) ORDER BY x.ord)
                                 FROM unnest(public.community_post_collab_ids(n.id)) WITH ORDINALITY AS x(uid, ord)), '[]'::jsonb),
    'poll', public.community_poll_json(n.id, _viewer),
    'edited_at', n.edited_at,
    'archived_at', n.archived_at,
    'archived_from', n.archived_from,
    'locked_in_at', n.locked_in_at,
    'hide_loads', n.hide_loads,
    'live', n.kind = 'workout' AND pc.completed_at IS NULL AND NOT fin.superseded,
    'session_title', CASE WHEN n.kind = 'workout' THEN coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout') END,
    'is_mine', n.author_user_id = public.community_main_account(_viewer),
    'author', public.community_author(n.author_user_id),
    'stats', CASE WHEN fin.superseded THEN NULL
                  WHEN n.hide_loads AND n.author_user_id IS DISTINCT FROM _viewer
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
    'pinned_comment_id', n.pinned_comment_id,
    'comment_preview', public.community_comment_preview(n.id, n.pinned_comment_id),
    'comment_count', (SELECT count(*) FROM public.community_comments c WHERE c.post_id = n.id AND c.hidden_at IS NULL),
    'coach_commented', EXISTS (SELECT 1 FROM public.community_comments c
                                WHERE c.post_id = n.id
                                  AND public.community_is_coach(c.author_user_id)))
  FROM public.community_posts n
  LEFT JOIN public.pl_day_completions pc ON pc.id = n.completion_id
  LEFT JOIN public.pl_days d ON d.id = pc.day_id
  CROSS JOIN LATERAL (SELECT public.community_lockin_has_finish(n.id) AS superseded) fin
  WHERE n.id = _post_id
$function$;

-- ── Post detail: that lock-in doesn't repeat the workout's sets either ────────
CREATE OR REPLACE FUNCTION public.community_post(_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_completion uuid;
  v_hide boolean;
  v_found boolean := false;
BEGIN
  IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT true, p.completion_id, p.hide_loads AND p.author_user_id <> uid INTO v_found, v_completion, v_hide FROM public.community_posts p
   WHERE p.id = _post_id AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id);
  IF NOT coalesce(v_found, false) THEN RAISE EXCEPTION 'Post not found'; END IF;
  IF public.community_lockin_has_finish(_post_id) THEN v_completion := NULL; END IF;
  RETURN public.community_post_json(_post_id, uid)
         || jsonb_build_object('exercises', CASE WHEN v_completion IS NULL THEN '[]'::jsonb WHEN v_hide THEN public.community_hide_exercise_loads(public.community_workout_exercises(v_completion))
                                                ELSE public.community_workout_exercises(v_completion) END);
END;
$function$;

-- ── Share picker: "already shared" means a finish post exists ────────────────
CREATE OR REPLACE FUNCTION public.community_recent_completions(_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(s.x ORDER BY s.at DESC), '[]'::jsonb)
  FROM (
    SELECT pc.completed_at AS at,
           jsonb_build_object(
             'completion_id', pc.id,
             'completed_at', pc.completed_at,
             'title', coalesce(nullif(btrim(d.title), ''), nullif(btrim(d.focus), ''), 'Workout'),
             'duration_min', nullif(pc.actual_duration_min, 0),
             'post_id', p.id,
             'visibility', p.visibility,
             'athlete_name', coalesce(nullif(btrim(c.preferred_name), ''), nullif(btrim(c.first_name), ''),
                                      nullif(split_part(btrim(coalesce(c.full_name, '')), ' ', 1), ''))) AS x
      FROM public.pl_day_completions pc
      JOIN public.clients c ON c.id = pc.client_id
      LEFT JOIN public.pl_days d ON d.id = pc.day_id
      LEFT JOIN public.community_posts p ON p.completion_id = pc.id AND p.locked_in_at IS NULL
     WHERE auth.uid() IS NOT NULL
       AND c.user_id = auth.uid()
       AND pc.completed_at IS NOT NULL
       AND pc.completed_at > now() - interval '30 days'
     ORDER BY pc.completed_at DESC
     LIMIT least(greatest(coalesce(_limit, 8), 1), 20)
  ) s
$function$;
