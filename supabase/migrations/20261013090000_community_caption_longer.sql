-- Workout post captions: 280 → 2200 characters (Instagram's limit), so people
-- can actually say something about the session. Coach notes keep their 1200.
-- The app's CAPTION_MAX (src/lib/community.ts) matches.

ALTER TABLE public.community_posts DROP CONSTRAINT IF EXISTS community_posts_caption_check;
ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_caption_check
  CHECK (caption IS NULL OR char_length(caption) <= CASE WHEN kind = 'note' THEN 1200 ELSE 2200 END);

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
  IF v_cap IS NOT NULL AND char_length(v_cap) > 2200 THEN RAISE EXCEPTION 'Caption too long'; END IF;

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

CREATE OR REPLACE FUNCTION public.community_edit_post(_post_id uuid, _caption text, _visibility text, _hide_loads boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cap text := nullif(btrim(coalesce(_caption, '')), '');
  p record;
BEGIN
  IF NOT public.community_is_post_author(_post_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _visibility NOT IN ('community', 'coach', 'private') THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  IF v_cap IS NOT NULL AND char_length(v_cap) > 2200 THEN RAISE EXCEPTION 'Caption too long'; END IF;
  IF _visibility = 'community' AND NOT public.can_view_community() THEN
    RAISE EXCEPTION 'Community is not available on this account' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.community_posts WHERE id = _post_id;
  IF p.kind <> 'workout' THEN RAISE EXCEPTION 'Use the note editor for this post'; END IF;
  UPDATE public.community_posts SET
    caption = v_cap,
    visibility = CASE WHEN p.archived_at IS NOT NULL THEN 'private' ELSE _visibility END,
    archived_from = CASE WHEN p.archived_at IS NOT NULL THEN _visibility ELSE archived_from END,
    hide_loads = coalesce(_hide_loads, hide_loads),
    edited_at = CASE WHEN p.caption IS DISTINCT FROM v_cap THEN now() ELSE edited_at END,
    updated_at = now()
   WHERE id = _post_id;
END;
$function$;
